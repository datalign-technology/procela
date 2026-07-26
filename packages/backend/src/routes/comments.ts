import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { people } from './people';
import { createNotification } from './notifications';
import { auditService } from '../services/audit.service';
import { getCommentsRepository } from '../db/comments.repo';
import { getPeopleRepository } from '../db/people.repo';
import { hasDatabase } from '../db/prisma';

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

const commentsRepo = getCommentsRepository(comments);

// people is a foreign store; build its repo lazily so nothing reads the
// `people` binding at module-init (keeps this module cycle-safe, matching the
// pattern used across the 9b conversions).
let _peopleRepo: ReturnType<typeof getPeopleRepository> | null = null;
const peopleRepo = () => (_peopleRepo ??= getPeopleRepository(people));

// Request-body schemas — Zod at the API boundary. Shape checks fall out
// of the parse so downstream code can use the typed body directly.
const createCommentBodySchema = z.object({
  entityType: z.string().min(1, 'entityType, entityId, and non-empty content are required'),
  entityId: z.string().min(1, 'entityType, entityId, and non-empty content are required'),
  content: z.string().refine((s) => s.trim().length > 0, {
    message: 'entityType, entityId, and non-empty content are required',
  }),
  userName: z.string().optional(),
  orgId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  entityLabel: z.string().optional(),
});
const patchCommentBodySchema = z.object({
  content: z.string().refine((s) => s.trim().length > 0, { message: 'content cannot be empty' }),
  entityLabel: z.string().optional(),
});

// One-time migration of v0 comments that lack the new fields. Idempotent;
// runs once per process boot. JSON mode only — Postgres rows carry the
// canonical column shape already.
if (!hasDatabase()) {
  let migrated = false;
  for (const c of comments) {
    if (c.parentId === undefined) { (c as any).parentId = null; migrated = true; }
    if (c.mentions === undefined) { (c as any).mentions = []; migrated = true; }
    if (c.updatedAt === undefined) { (c as any).updatedAt = c.createdAt; migrated = true; }
    if (c.deletedAt === undefined) { (c as any).deletedAt = null; migrated = true; }
  }
  if (migrated) saveStore('comments', comments);
}

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ── Mention parsing ────────────────────────────────────────────────────────
// For each `@` in the body, find the longest person-name suffix from this
// org that anchors at that position and ends at a word boundary. Returns
// deduped personIds.

function parseMentions(body: string, orgId: string, allPeople: typeof people): string[] {
  const orgPeople = allPeople.filter((p) => p.orgIds?.includes(orgId));
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
  allPeople: typeof people,
): void {
  for (const personId of mentionsToNotify) {
    if (personId === comment.userId) continue;  // never notify on self-mention
    const person = allPeople.find((p) => p.id === personId);
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
router.get('/', async (req: Request, res: Response) => {
  const { entityType, entityId, orgId } = req.query as Record<string, string | undefined>;
  if (!entityType || !entityId) {
    res.status(400).json({ success: false, error: 'entityType and entityId query params are required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const filtered = (await commentsRepo.list())
    .filter((c) => c.entityType === entityType && c.entityId === entityId && c.orgId === effectiveOrgId)
    // Oldest-first reads more naturally for threaded conversations.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ success: true, data: filtered });
});

/** POST /api/v1/comments */
router.post('/', async (req: Request, res: Response) => {
  const parsed = createCommentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ success: false, error: first?.message || 'Invalid request body', details: parsed.error.issues });
    return;
  }
  const { entityType, entityId, content, userName, orgId, parentId, entityLabel } = parsed.data;

  const effectiveOrgId = orgId || DEV_ORG_ID;

  // Threading: replies must point at an existing comment on the same
  // entity. Reply-to-reply collapses onto the original parent so the
  // tree never goes deeper than one level.
  let resolvedParentId: string | null = null;
  if (parentId) {
    const parent = await commentsRepo.get(String(parentId));
    if (!parent) { res.status(400).json({ success: false, error: 'parent comment not found' }); return; }
    if (parent.entityType !== entityType || parent.entityId !== entityId) {
      res.status(400).json({ success: false, error: 'parent comment belongs to a different entity' });
      return;
    }
    resolvedParentId = parent.parentId ?? parent.id;
  }

  const allPeople = await peopleRepo().list();
  const authorPersonId = (req as any).user?.sub || null;
  const author = authorPersonId ? allPeople.find((p) => p.id === authorPersonId) : null;
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
    mentions: parseMentions(content, effectiveOrgId, allPeople),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await commentsRepo.create(comment);
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
    dispatchMentionNotifications(comment, comment.mentions, entityLabel || `${entityType} ${entityId}`, allPeople);
  }

  res.status(201).json({ success: true, data: comment });
});

/** PATCH /api/v1/comments/:id — edit comment body. Only the author can
 *  edit. Newly-added mentions fire notifications; previously-mentioned
 *  people aren't re-notified. */
router.patch('/:id', async (req: Request, res: Response) => {
  const c = await commentsRepo.get(String(req.params.id));
  if (!c) { res.status(404).json({ success: false, error: 'Comment not found' }); return; }
  if (c.deletedAt) { res.status(409).json({ success: false, error: 'Comment is deleted' }); return; }

  const parsed = patchCommentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ success: false, error: first?.message || 'Invalid request body', details: parsed.error.issues });
    return;
  }
  const { content, entityLabel } = parsed.data;

  const editorPersonId = (req as any).user?.sub || null;
  if (c.userId && editorPersonId && c.userId !== editorPersonId) {
    res.status(403).json({ success: false, error: 'Only the author can edit this comment' });
    return;
  }

  const allPeople = await peopleRepo().list();
  const newMentions = parseMentions(content, c.orgId, allPeople);
  const addedMentions = newMentions.filter((m) => !c.mentions.includes(m));
  c.content = content.trim();
  c.mentions = newMentions;
  c.updatedAt = new Date().toISOString();
  await commentsRepo.update(c.id, { content: c.content, mentions: c.mentions, updatedAt: c.updatedAt });

  if (addedMentions.length > 0) {
    dispatchMentionNotifications(c, addedMentions, entityLabel || `${c.entityType} ${c.entityId}`, allPeople);
  }
  auditService.log(
    c.orgId, c.userId, 'Comment', c.id, 'UPDATE',
    null,
    { entityType: c.entityType, entityId: c.entityId, snippet: c.content.slice(0, 120) },
  );
  res.json({ success: true, data: c });
});

/** DELETE /api/v1/comments/:id — soft delete (keeps thread structure) */
router.delete('/:id', async (req: Request, res: Response) => {
  const c = await commentsRepo.get(String(req.params.id));
  if (!c) { res.status(404).json({ success: false, error: 'Comment not found' }); return; }
  c.deletedAt = new Date().toISOString();
  c.content = '';
  c.mentions = [];
  c.updatedAt = c.deletedAt;
  await commentsRepo.update(c.id, { deletedAt: c.deletedAt, content: c.content, mentions: c.mentions, updatedAt: c.updatedAt });
  logger.info({ id: req.params.id }, 'Comment soft-deleted');
  auditService.log(
    c.orgId, c.userId, 'Comment', c.id, 'DELETE',
    { entityType: c.entityType, entityId: c.entityId },
    null,
  );
  res.status(204).send();
});

export default router;
