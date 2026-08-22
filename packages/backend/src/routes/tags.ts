import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { getTagsRepository } from '../db/tags.repo';
import { AuthenticatedRequest } from '../middleware/auth';
import { enforceAssignment } from '../lib/assignment';

export interface StoredTag {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  tag: string;
  // Layer-2 assignment anchor: the person who created this tag. Nullable
  // for tags created without an authenticated author (e.g. imports).
  createdBy: string | null;
  createdAt: string;
}

export const tags: StoredTag[] = loadStore<StoredTag>('tags');
registerStore('tags', tags);

const tagsRepo = getTagsRepository(tags);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/tags — get tags for an entity (by entityType+entityId) or find entities with a tag (by orgId+tag) */
router.get('/', async (req: Request, res: Response) => {
  const { entityType, entityId, orgId, tag } = req.query;
  const all = await tagsRepo.list();

  if (entityType && entityId) {
    const filtered = all.filter(
      (t) => t.entityType === entityType && t.entityId === entityId
    );
    res.json({ success: true, data: filtered });
    return;
  }

  if (orgId && tag) {
    const filtered = all.filter(
      (t) => t.orgId === orgId && t.tag === tag
    );
    res.json({ success: true, data: filtered });
    return;
  }

  // If no specific filters, return all tags (optionally filtered by orgId)
  const filtered = orgId ? all.filter((t) => t.orgId === orgId) : all;
  res.json({ success: true, data: filtered });
});

/** GET /api/v1/tags/all — list all unique tag names */
router.get('/all', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const all = await tagsRepo.list();
  const filtered = orgId ? all.filter((t) => t.orgId === orgId) : all;
  const uniqueTags = [...new Set(filtered.map((t) => t.tag))].sort();
  res.json({ success: true, data: uniqueTags });
});

/** POST /api/v1/tags — create a tag */
router.post('/', async (req: Request, res: Response) => {
  const { entityType, entityId, tag: tagName, orgId } = req.body;

  if (!entityType || !entityId || !tagName) {
    res.status(400).json({ success: false, error: 'entityType, entityId, and tag are required' });
    return;
  }

  // Check for duplicate
  const existing = (await tagsRepo.list()).find(
    (t) => t.entityType === entityType && t.entityId === entityId && t.tag === tagName
  );
  if (existing) {
    res.status(409).json({ success: false, error: 'Tag already exists on this entity' });
    return;
  }

  const newTag: StoredTag = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    entityType,
    entityId,
    tag: tagName.trim(),
    // Layer-2 anchor: record who created the tag so a CONTRIBUTOR can
    // later remove their own (and only their own).
    createdBy: (req as AuthenticatedRequest).user?.sub ?? null,
    createdAt: new Date().toISOString(),
  };

  await tagsRepo.create(newTag);
  logger.info({ entityType, entityId, tag: tagName }, 'Created tag');

  res.status(201).json({ success: true, data: newTag });
});

/** DELETE /api/v1/tags/:id — remove a tag */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = await tagsRepo.get(String(req.params.id));
  if (!removed) {
    res.status(404).json({ success: false, error: 'Tag not found' });
    return;
  }

  // Layer-2: a CONTRIBUTOR may only delete tags they created.
  const delAssignErr = enforceAssignment((req as AuthenticatedRequest).user, removed);
  if (delAssignErr) { res.status(delAssignErr.statusCode).json({ success: false, error: delAssignErr.message }); return; }

  await tagsRepo.delete(removed.id);
  logger.info({ id: removed.id, tag: removed.tag }, 'Deleted tag');
  res.status(204).send();
});

export default router;
