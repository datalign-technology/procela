import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore, getRegisteredStore } from '../lib/persistence';
import { getReportFoldersRepository } from '../db/report-folders.repo';
import { getReportsRepository } from '../db/reports.repo';
import { auditService } from '../services/audit.service';
import type { AuthenticatedRequest } from '../middleware/auth';
// Type-only import (erased at compile time) — no runtime dependency on the
// reports route, so the import graph stays acyclic (reports → folders).
import type { StoredReport } from './reports';

// ──────────────────────────────────────────────────────────────────────────
// Report folders — organize reports and drive their audience.
//
// A report in a `shared` folder (the built-in "Public" folder, or a user
// folder the owner toggled shared) is visible to the whole org; a report in a
// personal folder — or in no folder ("My Reports") — is private to its owner.
// The access decision lives in routes/reports.ts, which reads these folders.
//
// One system "Public" folder is ensured per org lazily (ensurePublicFolder),
// so it exists for every tenant without a data migration. It is immutable:
// it can't be renamed, un-shared, or deleted.
//
// This module intentionally does NOT import routes/reports.ts — the
// dependency runs one way (reports → folders) to avoid an import cycle. A
// report whose folderId points at a deleted folder is treated as
// uncategorized (private) by the reports route, so deleting a folder needs no
// write-back here.
// ──────────────────────────────────────────────────────────────────────────

export const PUBLIC_FOLDER_NAME = 'Public';

export interface StoredReportFolder {
  id: string;
  orgId: string;
  name: string;
  /** Creator. null for the system Public folder. */
  ownerId: string | null;
  /** 'system' = the built-in Public folder (immutable); 'user' = user-created. */
  kind: 'system' | 'user';
  /** Reports in a shared folder are org-visible. Always true for Public. */
  shared: boolean;
  /** Manual rail order among the org's user folders (drag-to-reorder). The
   *  system Public folder is always pinned first regardless. Absent on folders
   *  created before ordering existed; they sort by name until first reordered. */
  orderIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export const reportFolders: StoredReportFolder[] = loadStore<StoredReportFolder>('reportFolders');
registerStore('reportFolders', reportFolders);

export const reportFoldersRepo = getReportFoldersRepository(reportFolders);

// Per-org in-flight guard. The check-and-create in ensurePublicFolder straddles
// an `await` (the folder list), so two requests that arrive together — e.g. the
// Reports page firing GET /reports and GET /report-folders at once — would each
// see "no Public folder" and each create one, leaving the org with duplicate
// Public folders. Collapsing concurrent callers onto one promise closes that
// window within a process; duplicates from other sources are healed on read
// (below).
const ensureLocks = new Map<string, Promise<StoredReportFolder>>();

/** Find (or lazily create) the org's single system "Public" folder. Idempotent
 *  and concurrency-safe, so every tenant gets exactly one shared bucket without
 *  a data migration — and any duplicate Public folders a past race produced are
 *  folded back into one on the next call. */
export function ensurePublicFolder(orgId: string): Promise<StoredReportFolder> {
  const inflight = ensureLocks.get(orgId);
  if (inflight) return inflight;
  const p = ensurePublicFolderUnlocked(orgId).finally(() => ensureLocks.delete(orgId));
  ensureLocks.set(orgId, p);
  return p;
}

async function ensurePublicFolderUnlocked(orgId: string): Promise<StoredReportFolder> {
  const systems = (await reportFoldersRepo.list({ orgId }))
    .filter((f) => f.kind === 'system')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  if (systems.length === 0) {
    const now = new Date().toISOString();
    const folder: StoredReportFolder = {
      id: uuid(), orgId, name: PUBLIC_FOLDER_NAME, ownerId: null,
      kind: 'system', shared: true, createdAt: now, updatedAt: now,
    };
    return (await reportFoldersRepo.create(folder)) || folder;
  }

  // One canonical Public folder (the earliest); fold any duplicates into it.
  const [canonical, ...extras] = systems;
  if (extras.length > 0) {
    const extraIds = new Set(extras.map((f) => f.id));
    // Repoint reports out of the duplicates BEFORE deleting them, so no report
    // is left with a dangling folderId (which would read as private). Use the
    // live registered reports array (not loadStore, which re-reads from disk)
    // so the mutation lands on the same instance the reports route serves.
    const liveReports = getRegisteredStore<StoredReport>('reports') ?? loadStore<StoredReport>('reports');
    const reportsRepo = getReportsRepository(liveReports);
    const affected = (await reportsRepo.list({ orgId })).filter((r) => r.folderId && extraIds.has(r.folderId));
    for (const r of affected) await reportsRepo.update(r.id, { folderId: canonical.id });
    for (const dup of extras) await reportFoldersRepo.delete(dup.id);
  }
  return canonical;
}

const isAdmin = (req: Request): boolean => {
  const role = (req as AuthenticatedRequest).user?.role;
  return role === 'SUPER_ADMIN' || role === 'ORG_ADMIN';
};
const userId = (req: Request): string | null => (req as AuthenticatedRequest).user?.sub || null;

const router = Router();

/** GET /api/v1/report-folders?orgId=… — folders the caller can see: the
 *  system Public folder, folders they own, and any shared folder. Ensures the
 *  Public folder exists first. */
router.get('/', async (req: Request, res: Response) => {
  const orgId = String(req.query.orgId || '');
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  await ensurePublicFolder(orgId);
  const uid = userId(req);
  const admin = isAdmin(req);
  const data = (await reportFoldersRepo.list({ orgId }))
    .filter((f) => f.kind === 'system' || f.shared || admin || (uid && f.ownerId === uid))
    // System Public pinned first; then user folders by their manual rail order
    // (orderIndex), falling back to name for folders not yet reordered.
    .sort((a, b) => {
      if (a.kind === 'system') return -1;
      if (b.kind === 'system') return 1;
      const ao = a.orderIndex ?? Number.MAX_SAFE_INTEGER;
      const bo = b.orderIndex ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || a.name.localeCompare(b.name);
    });
  res.json({ success: true, data });
});

/** POST /api/v1/report-folders — create a user folder. Body: { orgId, name, shared? }. */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, name, shared } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ success: false, error: 'name is required' }); return; }
  const now = new Date().toISOString();
  // Append after the org's existing user folders in the manual rail order.
  const userFolders = (await reportFoldersRepo.list({ orgId })).filter((f) => f.kind === 'user');
  const nextOrder = userFolders.reduce((max, f) => Math.max(max, (f.orderIndex ?? -1) + 1), userFolders.length);
  const folder: StoredReportFolder = {
    id: uuid(), orgId, name: String(name).trim(), ownerId: userId(req),
    kind: 'user', shared: shared === true, orderIndex: nextOrder, createdAt: now, updatedAt: now,
  };
  const created = await reportFoldersRepo.create(folder);
  auditService.log(orgId, userId(req), 'ReportFolder', folder.id, 'CREATE', null, created);
  res.status(201).json({ success: true, data: created });
});

/** PATCH /api/v1/report-folders/:id — rename or toggle shared. Owner only; the
 *  system Public folder is immutable. */
router.patch('/:id', async (req: Request, res: Response) => {
  const folder = await reportFoldersRepo.get(String(req.params.id));
  if (!folder) { res.status(404).json({ success: false, error: 'Folder not found' }); return; }
  if (folder.kind === 'system') { res.status(403).json({ success: false, error: 'The Public folder cannot be modified' }); return; }
  const uid = userId(req);
  // Content edits (rename / share) are owner-only. Reordering (orderIndex) is a
  // positional change to the shared rail — like the process catalog, it's not
  // owner-gated, so anyone who can see the folder can slot it in the rail.
  const wantsContentEdit = req.body?.name !== undefined || req.body?.shared !== undefined;
  if (wantsContentEdit && folder.ownerId && uid && folder.ownerId !== uid && !isAdmin(req)) {
    res.status(403).json({ success: false, error: 'Only the folder owner can modify it' });
    return;
  }
  const patch: Partial<StoredReportFolder> = { updatedAt: new Date().toISOString() };
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) { res.status(400).json({ success: false, error: 'name cannot be empty' }); return; }
    patch.name = name;
  }
  if (req.body?.shared !== undefined) patch.shared = req.body.shared === true;
  if (req.body?.orderIndex !== undefined) {
    const oi = Number(req.body.orderIndex);
    if (!Number.isFinite(oi)) { res.status(400).json({ success: false, error: 'orderIndex must be a number' }); return; }
    patch.orderIndex = oi;
  }
  const updated = await reportFoldersRepo.update(folder.id, patch);
  auditService.log(folder.orgId, uid, 'ReportFolder', folder.id, 'UPDATE', folder, updated);
  res.json({ success: true, data: updated });
});

/** DELETE /api/v1/report-folders/:id — owner only; Public is undeletable. Its
 *  reports fall back to uncategorized (their dangling folderId reads as null). */
router.delete('/:id', async (req: Request, res: Response) => {
  const folder = await reportFoldersRepo.get(String(req.params.id));
  if (!folder) { res.status(404).json({ success: false, error: 'Folder not found' }); return; }
  if (folder.kind === 'system') { res.status(403).json({ success: false, error: 'The Public folder cannot be deleted' }); return; }
  const uid = userId(req);
  if (folder.ownerId && uid && folder.ownerId !== uid && !isAdmin(req)) {
    res.status(403).json({ success: false, error: 'Only the folder owner can delete it' });
    return;
  }
  await reportFoldersRepo.delete(folder.id);
  auditService.log(folder.orgId, uid, 'ReportFolder', folder.id, 'DELETE', folder, null);
  res.status(204).send();
});

export default router;
