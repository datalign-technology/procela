import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';

export interface StoredTag {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  tag: string;
  createdAt: string;
}

export const tags: StoredTag[] = loadStore<StoredTag>('tags');
registerStore('tags', tags);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/tags — get tags for an entity (by entityType+entityId) or find entities with a tag (by orgId+tag) */
router.get('/', (req: Request, res: Response) => {
  const { entityType, entityId, orgId, tag } = req.query;

  if (entityType && entityId) {
    const filtered = tags.filter(
      (t) => t.entityType === entityType && t.entityId === entityId
    );
    res.json({ success: true, data: filtered });
    return;
  }

  if (orgId && tag) {
    const filtered = tags.filter(
      (t) => t.orgId === orgId && t.tag === tag
    );
    res.json({ success: true, data: filtered });
    return;
  }

  // If no specific filters, return all tags (optionally filtered by orgId)
  const filtered = orgId ? tags.filter((t) => t.orgId === orgId) : tags;
  res.json({ success: true, data: filtered });
});

/** GET /api/v1/tags/all — list all unique tag names */
router.get('/all', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? tags.filter((t) => t.orgId === orgId) : tags;
  const uniqueTags = [...new Set(filtered.map((t) => t.tag))].sort();
  res.json({ success: true, data: uniqueTags });
});

/** POST /api/v1/tags — create a tag */
router.post('/', (req: Request, res: Response) => {
  const { entityType, entityId, tag: tagName, orgId } = req.body;

  if (!entityType || !entityId || !tagName) {
    res.status(400).json({ success: false, error: 'entityType, entityId, and tag are required' });
    return;
  }

  // Check for duplicate
  const existing = tags.find(
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
    createdAt: new Date().toISOString(),
  };

  tags.push(newTag);
  saveStore('tags', tags);
  logger.info({ entityType, entityId, tag: tagName }, 'Created tag');

  res.status(201).json({ success: true, data: newTag });
});

/** DELETE /api/v1/tags/:id — remove a tag */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = tags.findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Tag not found' });
    return;
  }
  const removed = tags.splice(idx, 1)[0];
  saveStore('tags', tags);
  logger.info({ id: removed.id, tag: removed.tag }, 'Deleted tag');
  res.status(204).send();
});

export default router;
