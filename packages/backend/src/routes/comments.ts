import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { people } from './people';
import { createNotification } from './notifications';
import { auditService } from '../services/audit.service';

// ═══════════════════════════════════════════════════════════════════════════════
// COMMENTS
//
// Entity-agnostic comment thread store. Each comment hangs off an
// (entityType, entityId) pair so the same routes serve systems, data
// assets, people, process nodes, and any future surface. Threading is
// one level deep: top-level comments have parentId === null; replies
// have parentId === <top-level comment id>. Reply-to-reply attempts
// collapse onto the original parent so we never nest deeper.
//
// @mentions are parsed from the body at create/edit time and stored as
// a resolved list of personIds (so a future rename of the mentioned
// person doesn't silently break the link). Each newly-added mention
// spawns an in-app notification via the existing notification system.
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoredComment {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  /** Null for top-level comments. Set to a top-level comment id for
   *  replies. Threading is intentionally one level deep. */
  parentId: string | null;
  /** Author's personId (null when the author isn't matched to a known
   *  person, e.g. a synthetic/system comment). Kept as `userId` for
   *  data-shape continuity with the v0 of this store. */
  userId: string | null;
  userName: string;
  content: string;
  /** Resolved personIds extracted from @mentions. */
  mentions: string[];
  createdAt: string;
  updatedAt: string;
  /** Soft delete: when set, the body is blanked in the API response
   *  but the row remains so child replies aren't orphaned in the UI. */
  deletedAt: string | null;
}

export const comments: StoredComment[] = loadStore<StoredComment>('comments');
registerStore('comments', comments);

// One-time migration of v0 comments that lack the new fields. Idempotent;
// runs once per process boot.
let migrated = false;
for (const c of comments) {
  if (c.parentId === undefined) { (c as any).parentId = null; migrated = true; }
  if (c.mentions === undefined) { (c as any).mentions = []; migrated = true; }
  if (c.updatedAt === undefined) { (c as any).updatedAt = c.createdAt; migrated = true; }
  if (c.deletedAt === undefined) { (c as any).deletedAt = null; migrated = true; }
}
if (migrated) saveStore('comments', comments);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Mention parsing ────────────────────────────────────────────────────────
// For each `@` in the body, find the longest person-name suffix from this
// org that anchors at that position and ends at a word boundary. Returns
// deduped personIds.

function parseMentions(body: string, orgId: string): string[] {
  const orgPeople = people.filter((p) => p.orgIds?.includes(orgId));
  const mentioned = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue;
    const after = body.slice(i + 1);
    let bestLen = 0;
    let bestId: string | null = null;
    for (const p of orgPeople) {
      const n = p.name;
      if (after.length >= n.length
          && after.slice(0, n.length).toLowerCase() === n.toLowerCase()
          && (after.length === n.length || /[\s.,!?;:]/.test(after[n.length]))
          && n.length > bestLen) {
        bestLen = n.length;
        bestId = p.id;
      }
    }
    if (bestId) mentioned.add(bestId);
  }
  return Array.from(mentioned);
}

function entityLinkFor(entityType: string, entityId: string): string {
  // Convention across the app is PascalCase (DataAsset, ProcessNode),
  // but be lenient so older camelCase callers still get a working link.
  switch (entityType.toLowerCase()) {
    case 'system':       return `/systems?detail=${entityId}`;
    case 'dataasset':    return `/data-assets?detail=${entityId}`;
    case 'person':       return `/people/${entityId}`;
    case 'processnode':  return `/processes?node=${entityId}`;
    default:             return '/';
  }
}

function dispatchMentionNotifications(
  comment: StoredComment,
  mentionsToNotify: string[],
  entityLabel: string,
): void {
  for (const personId of mentionsToNotify) {
    if (personId === comment.userId) continue;  // never notify on self-mention
    const person = people.find((p) => p.id === personId);
    if (!person) continue;
    createNotification({
      orgId: comment.orgId,
      userId: personId,
      type: 'INFO',
      title: `${comment.userName} mentioned you`,
      message: `${comment.userName} mentioned you in a comment on ${entityLabel}.`,
      link: entityLinkFor(comment.entityType, comment.entityId),
    });
  }
}

const router = Router();

/** GET /api/v1/comments?entityType=&entityId=&orgId= */
router.get('/', (req: Request, res: Response) => {
  const { entityType, entityId, orgId } = req.query as Record<string, string | undefined>;
  if (!entityType || !entityId) {
    res.status(400).json({ success: false, error: 'entityType and entityId query params are required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const filtered = comments
    .filter((c) => c.entityType === entityType && c.entityId === entityId && c.orgId === effectiveOrgId)
    // Oldest-first reads more naturally for threaded conversations.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ success: true, data: filtered });
});

/** POST /api/v1/comments */
router.post('/', (req: Request, res: Response) => {
  const { entityType, entityId, content, userName, orgId, parentId, entityLabel } = req.body as {
    entityType?: string; entityId?: string; content?: string;
    userName?: string; orgId?: string; parentId?: string | null;
    entityLabel?: string;
  };

  if (!entityType || !entityId || !content || !content.trim()) {
    res.status(400).json({ success: false, error: 'entityType, entityId, and non-empty content are required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;

  // Threading: replies must point at an existing comment on the same
  // entity. Reply-to-reply collapses onto the original parent so the
  // tree never goes deeper than one level.
  let resolvedParentId: string | null = null;
  if (parentId) {
    const parent = comments.find((c) => c.id === parentId);
    if (!parent) { res.status(400).json({ success: false, error: 'parent comment not found' }); return; }
    if (parent.entityType !== entityType || parent.entityId !== entityId) {
      res.status(400).json({ success: false, error: 'parent comment belongs to a different entity' });
      return;
    }
    resolvedParentId = parent.parentId ?? parent.id;
  }

  const authorPersonId = (req as any).user?.sub || null;
  const author = authorPersonId ? people.find((p) => p.id === authorPersonId) : null;
  const resolvedAuthorName = author?.name || userName || (req as any).user?.name || 'Unknown';

  const now = new Date().toISOString();
  const comment: StoredComment = {
    id: uuid(),
    orgId: effectiveOrgId,
    entityType,
    entityId,
    parentId: resolvedParentId,
    userId: author?.id || authorPersonId,
    userName: resolvedAuthorName,
    content: content.trim(),
    mentions: parseMentions(content, effectiveOrgId),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  comments.push(comment);
  saveStore('comments', comments);
  logger.info(
    { commentId: comment.id, entityType, entityId, mentions: comment.mentions.length, isReply: !!resolvedParentId },
    'Comment created',
  );

  // Comments emit audit events so the per-entity activity feed has a
  // single source of truth - the feed reads from /audit only and never
  // needs to know about the comments store.
  auditService.log(
    effectiveOrgId,
    comment.userId,
    'Comment',
    comment.id,
    'CREATE',
    null,
    { entityType, entityId, parentId: resolvedParentId, snippet: comment.content.slice(0, 120) },
  );

  if (comment.mentions.length > 0) {
    dispatchMentionNotifications(comment, comment.mentions, entityLabel || `${entityType} ${entityId}`);
  }

  res.status(201).json({ success: true, data: comment });
});

/** PATCH /api/v1/comments/:id — edit comment body. Only the author can
 *  edit. Newly-added mentions fire notifications; previously-mentioned
 *  people aren't re-notified. */
router.patch('/:id', (req: Request, res: Response) => {
  const c = comments.find((c) => c.id === req.params.id);
  if (!c) { res.status(404).json({ success: false, error: 'Comment not found' }); return; }
  if (c.deletedAt) { res.status(409).json({ success: false, error: 'Comment is deleted' }); return; }

  const { content, entityLabel } = req.body as { content?: string; entityLabel?: string };
  if (!content || !content.trim()) { res.status(400).json({ success: false, error: 'content cannot be empty' }); return; }

  const editorPersonId = (req as any).user?.sub || null;
  if (c.userId && editorPersonId && c.userId !== editorPersonId) {
    res.status(403).json({ success: false, error: 'Only the author can edit this comment' });
    return;
  }

  const newMentions = parseMentions(content, c.orgId);
  const addedMentions = newMentions.filter((m) => !c.mentions.includes(m));
  c.content = content.trim();
  c.mentions = newMentions;
  c.updatedAt = new Date().toISOString();
  saveStore('comments', comments);

  if (addedMentions.length > 0) {
    dispatchMentionNotifications(c, addedMentions, entityLabel || `${c.entityType} ${c.entityId}`);
  }
  auditService.log(
    c.orgId, c.userId, 'Comment', c.id, 'UPDATE',
    null,
    { entityType: c.entityType, entityId: c.entityId, snippet: c.content.slice(0, 120) },
  );
  res.json({ success: true, data: c });
});

/** DELETE /api/v1/comments/:id — soft delete (keeps thread structure) */
router.delete('/:id', (req: Request, res: Response) => {
  const c = comments.find((c) => c.id === req.params.id);
  if (!c) { res.status(404).json({ success: false, error: 'Comment not found' }); return; }
  c.deletedAt = new Date().toISOString();
  c.content = '';
  c.mentions = [];
  c.updatedAt = c.deletedAt;
  saveStore('comments', comments);
  logger.info({ id: req.params.id }, 'Comment soft-deleted');
  auditService.log(
    c.orgId, c.userId, 'Comment', c.id, 'DELETE',
    { entityType: c.entityType, entityId: c.entityId },
    null,
  );
  res.status(204).send();
});

export default router;
