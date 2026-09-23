import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import { getReportFoldersRepository } from '../db/report-folders.repo';
import { auditService } from '../services/audit.service';
import type { AuthenticatedRequest } from '../middleware/auth';

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
  createdAt: string;
  updatedAt: string;
}

export const reportFolders: StoredReportFolder[] = loadStore<StoredReportFolder>('reportFolders');
registerStore('reportFolders', reportFolders);

export const reportFoldersRepo = getReportFoldersRepository(reportFolders);

/** Find (or lazily create) the org's system "Public" folder. Idempotent, so
 *  every tenant gets exactly one shared bucket without a data migration. */
export async function ensurePublicFolder(orgId: string): Promise<StoredReportFolder> {
  const existing = (await reportFoldersRepo.list({ orgId })).find((f) => f.kind === 'system');
  if (existing) return existing;
  const now = new Date().toISOString();
  const folder: StoredReportFolder = {
    id: uuid(), orgId, name: PUBLIC_FOLDER_NAME, ownerId: null,
    kind: 'system', shared: true, createdAt: now, updatedAt: now,
  };
  return (await reportFoldersRepo.create(folder)) || folder;
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
    .sort((a, b) => (a.kind === 'system' ? -1 : b.kind === 'system' ? 1 : a.name.localeCompare(b.name)));
  res.json({ success: true, data });
});

/** POST /api/v1/report-folders — create a user folder. Body: { orgId, name, shared? }. */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, name, shared } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ success: false, error: 'name is required' }); return; }
  const now = new Date().toISOString();
  const folder: StoredReportFolder = {
    id: uuid(), orgId, name: String(name).trim(), ownerId: userId(req),
    kind: 'user', shared: shared === true, createdAt: now, updatedAt: now,
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
  if (folder.ownerId && uid && folder.ownerId !== uid && !isAdmin(req)) {
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
