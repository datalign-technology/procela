import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { getSavedViewsRepository } from '../db/saved-views.repo';

// ═══════════════════════════════════════════════════════════════════════════════
// SAVED VIEWS
//
// Generic page-specific filter snapshots. Every list page that wants
// "save and recall a filter set" reads and writes through these routes,
// keyed by (orgId, pageKey). The filters payload is treated as opaque
// JSON - each page defines its own shape and round-trips it as-is.
//
// v1 visibility model: all views in an org are visible to everyone in
// that org. A private/shared toggle is out of scope for v1; when it
// lands it can reintroduce a visibility column of its own.
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoredView {
  id: string;
  orgId: string;
  /** Stable identifier for the page these filters belong to, e.g.
   *  "data-assets", "decision-rights". Lower-kebab; defined by each
   *  page on the client side. */
  pageKey: string;
  name: string;
  /** personId of the view's creator, or null in anonymous dev mode. */
  ownerId: string | null;
  /** Display name of the owner at write time, so listing views doesn't
   *  require a per-row people join. */
  ownerName: string | null;
  /** Opaque filter snapshot. The page defines the shape; we just
   *  round-trip it. */
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const savedViews: StoredView[] = loadStore<StoredView>('savedViews');
registerStore('savedViews', savedViews);

const savedViewsRepo = getSavedViewsRepository(savedViews);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/saved-views?orgId=&pageKey= */
router.get('/', async (req: Request, res: Response) => {
  const { orgId, pageKey } = req.query as Record<string, string | undefined>;
  if (!pageKey) {
    res.status(400).json({ success: false, error: 'pageKey is required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const list = savedViews
    .filter((v) => v.orgId === effectiveOrgId && v.pageKey === pageKey)
    // Stable order: newest first so the most recently saved view is at the top.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ success: true, data: list });
});

/** POST /api/v1/saved-views */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, pageKey, name, filters, ownerName } = req.body as {
    orgId?: string; pageKey?: string; name?: string;
    filters?: Record<string, unknown>; ownerName?: string;
  };
  if (!pageKey || !name || !name.trim()) {
    res.status(400).json({ success: false, error: 'pageKey and a non-empty name are required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const ownerId = (req as any).user?.sub || null;

  // Soft uniqueness: a user can't have two views with the same name on
  // the same page. This stops typos producing accidental duplicates.
  const collision = savedViews.find((v) =>
    v.orgId === effectiveOrgId && v.pageKey === pageKey && v.ownerId === ownerId && v.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (collision) {
    res.status(409).json({ success: false, error: 'You already have a view with this name on this page.' });
    return;
  }

  const now = new Date().toISOString();
  const view: StoredView = {
    id: uuid(),
    orgId: effectiveOrgId,
    pageKey,
    name: name.trim(),
    ownerId,
    ownerName: ownerName || (req as any).user?.name || null,
    filters: filters || {},
    createdAt: now,
    updatedAt: now,
  };
  await savedViewsRepo.create(view);
  logger.info({ viewId: view.id, pageKey, ownerId }, 'Saved view created');
  res.status(201).json({ success: true, data: view });
});

/** PATCH /api/v1/saved-views/:id — rename and/or update filters. Only the
 *  owner can modify their view. */
router.patch('/:id', async (req: Request, res: Response) => {
  const v = savedViews.find((v) => v.id === req.params.id);
  if (!v) { res.status(404).json({ success: false, error: 'Saved view not found' }); return; }
  const editorId = (req as any).user?.sub || null;
  if (v.ownerId && editorId && v.ownerId !== editorId) {
    res.status(403).json({ success: false, error: 'Only the owner can modify this view' });
    return;
  }
  const { name, filters } = req.body as { name?: string; filters?: Record<string, unknown> };
  const patch: Partial<StoredView> = {};
  if (name !== undefined) {
    if (!name.trim()) { res.status(400).json({ success: false, error: 'name cannot be empty' }); return; }
    patch.name = name.trim();
  }
  if (filters !== undefined) patch.filters = filters;
  patch.updatedAt = new Date().toISOString();
  const updated = await savedViewsRepo.update(v.id, patch);
  res.json({ success: true, data: updated });
});

/** DELETE /api/v1/saved-views/:id — only the owner can delete. */
router.delete('/:id', async (req: Request, res: Response) => {
  const v = savedViews.find((v) => v.id === req.params.id);
  if (!v) { res.status(404).json({ success: false, error: 'Saved view not found' }); return; }
  const editorId = (req as any).user?.sub || null;
  if (v.ownerId && editorId && v.ownerId !== editorId) {
    res.status(403).json({ success: false, error: 'Only the owner can delete this view' });
    return;
  }
  await savedViewsRepo.delete(v.id);
  res.status(204).send();
});

export default router;
