import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { getNotificationsRepository } from '../db/notifications.repo';
import { hasDatabase } from '../db/prisma';

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION CENTER
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoredNotification {
  id: string;
  orgId: string;
  userId: string | null;
  type: 'INFO' | 'WARNING' | 'ACTION';
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
}

// ── Persistent store ──

export const notifications: StoredNotification[] = loadStore<StoredNotification>('notifications');
registerStore('notifications', notifications);

const notificationsRepo = getNotificationsRepository(notifications);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Helper: create a notification (used internally by other features) ──
//
// This helper stays synchronous so the many callers across the codebase
// (audit, comments, digest, etc.) can keep calling it inline. In JSON mode it
// pushes + saves. In Postgres mode it persists through the repository as a
// fire-and-forget write (awaiting would force ~14 inline call sites — several
// in non-async loops — to change): notifications are non-critical and
// eventually-consistent, the object is still returned synchronously, and a
// write failure is logged rather than swallowed.

export function createNotification(opts: {
  orgId?: string;
  userId?: string | null;
  type: StoredNotification['type'];
  title: string;
  message: string;
  link: string;
}): StoredNotification {
  const notification: StoredNotification = {
    id: uuid(),
    orgId: opts.orgId || DEV_ORG_ID,
    userId: opts.userId ?? null,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    link: opts.link,
    read: false,
    createdAt: new Date().toISOString(),
  };

  if (hasDatabase()) {
    void notificationsRepo.create(notification).catch((err) =>
      logger.error({ err, id: notification.id }, 'Failed to persist notification'));
  } else {
    notifications.push(notification);
    saveStore('notifications', notifications);
  }
  logger.info({ type: notification.type, title: notification.title }, 'Notification created');

  return notification;
}

// ── Router ──

const router = Router();

/** GET / — list all notifications (support ?unreadOnly=true) */
router.get('/', async (_req: Request, res: Response) => {
  const unreadOnly = _req.query.unreadOnly === 'true';
  const all = await notificationsRepo.list();
  let result = all.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (unreadOnly) {
    result = result.filter((n) => !n.read);
  }
  res.json({ success: true, data: result });
});

/** GET /count — returns { unread: number } */
router.get('/count', async (_req: Request, res: Response) => {
  const all = await notificationsRepo.list();
  const unread = all.filter((n) => !n.read).length;
  res.json({ success: true, data: { unread } });
});

/** PUT /:id/read — mark a single notification as read */
router.put('/:id/read', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const updated = await notificationsRepo.update(id, { read: true });
  if (!updated) {
    res.status(404).json({ success: false, error: 'Notification not found' });
    return;
  }
  res.json({ success: true, data: updated });
});

/** PUT /read-all — mark all notifications as read. In JSON mode this stays a
 *  single bulk array-write + one save; in Postgres mode it issues a repo
 *  update per still-unread row. */
router.put('/read-all', async (_req: Request, res: Response) => {
  if (hasDatabase()) {
    const all = await notificationsRepo.list();
    for (const n of all) {
      if (!n.read) await notificationsRepo.update(n.id, { read: true });
    }
    res.json({ success: true, data: { updated: all.length } });
    return;
  }
  for (const n of notifications) {
    n.read = true;
  }
  saveStore('notifications', notifications);
  res.json({ success: true, data: { updated: notifications.length } });
});

/** DELETE /all — clear every notification. JSON mode splices the array;
 *  Postgres mode deletes each row through the repo. */
router.delete('/all', async (_req: Request, res: Response) => {
  if (hasDatabase()) {
    const all = await notificationsRepo.list();
    for (const n of all) await notificationsRepo.delete(n.id);
    logger.info({ count: all.length }, 'Cleared all notifications');
    res.json({ success: true, deleted: all.length });
    return;
  }
  const count = notifications.length;
  notifications.splice(0, notifications.length);
  saveStore('notifications', notifications);
  logger.info({ count }, 'Cleared all notifications');
  res.json({ success: true, deleted: count });
});

/** DELETE /:id — remove a single notification. */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = await notificationsRepo.delete(String(req.params.id));
  if (!removed) { res.status(404).json({ success: false, error: 'Notification not found' }); return; }
  res.status(204).send();
});

/** POST / — create a notification (can also be used via API) */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, userId, type, title, message, link } = req.body;

  if (!title || !message || !type) {
    res.status(400).json({ success: false, error: 'title, message, and type are required' });
    return;
  }

  const validTypes = ['INFO', 'WARNING', 'ACTION'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    return;
  }

  const notification = createNotification({
    orgId,
    userId: userId || null,
    type,
    title,
    message,
    link: link || '/',
  });

  res.status(201).json({ success: true, data: notification });
});

export default router;
