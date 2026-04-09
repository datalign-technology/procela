import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

export interface StoredComment {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  userName: string;
  content: string;
  createdAt: string;
}

export const comments: StoredComment[] = loadStore<StoredComment>('comments');

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/comments — get comments for an entity */
router.get('/', (req: Request, res: Response) => {
  const { entityType, entityId } = req.query;

  if (!entityType || !entityId) {
    res.status(400).json({ success: false, error: 'entityType and entityId query params are required' });
    return;
  }

  const filtered = comments
    .filter((c) => c.entityType === entityType && c.entityId === entityId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ success: true, data: filtered });
});

/** POST /api/v1/comments — create a comment */
router.post('/', (req: Request, res: Response) => {
  const { entityType, entityId, content, userName, orgId } = req.body;

  if (!entityType || !entityId || !content) {
    res.status(400).json({ success: false, error: 'entityType, entityId, and content are required' });
    return;
  }

  const newComment: StoredComment = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    entityType,
    entityId,
    userId: (req as any).user?.sub || null,
    userName: userName || (req as any).user?.name || 'Unknown User',
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };

  comments.push(newComment);
  saveStore('comments', comments);
  logger.info({ entityType, entityId }, 'Created comment');

  res.status(201).json({ success: true, data: newComment });
});

/** DELETE /api/v1/comments/:id — delete a comment */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = comments.findIndex((c) => c.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Comment not found' });
    return;
  }
  comments.splice(idx, 1);
  saveStore('comments', comments);
  logger.info({ id: req.params.id }, 'Deleted comment');
  res.status(204).send();
});

export default router;
