import { AppError } from '../middleware/errorHandler';

// ---------------------------------------------------------------------------
// Authorization layer 2 — per-record "assigned" scoping
// ---------------------------------------------------------------------------
//
// Layer 1 (lib/permissions.ts) is the coarse role gate: it decides
// whether a role may write a *resource* at all. Layer 2 refines that
// for roles whose write scope is limited to the records they are
// assigned to — today just CONTRIBUTOR. EDITOR / ORG_ADMIN /
// SUPER_ADMIN have org-wide write and are exempt.
//
// A record denotes assignment through any of a small set of
// people-id fields. A JWT's `sub` claim IS the person id (see the
// access-token minting in routes/auth.ts, `sub: person.id`), so we
// compare assignment fields against `user.sub`.
// ---------------------------------------------------------------------------

/** Roles whose write access is scoped to records assigned to them. */
const ASSIGNED_SCOPED_ROLES = new Set(['CONTRIBUTOR']);

/** Record fields that denote assignment to a person (people-store ids). */
const ASSIGNMENT_FIELDS = [
  'ownerId',
  'ownerPersonId',
  'stewardId',
  'assigneeId',
  'responsiblePersonId',
  'createdBy',
  // Authorship anchors for the collaboration bucket: a comment's author
  // (userId) and an attachment's uploader (uploadedBy).
  'userId',
  'uploadedBy',
] as const;

interface MinimalUser {
  sub?: string;
  role?: string;
}

/** True when the role's write scope is limited to assigned records. */
export function isAssignedScopedRole(role: string | undefined): boolean {
  return !!role && ASSIGNED_SCOPED_ROLES.has(role);
}

/**
 * Whether `user` is assigned to `record` via any of the known
 * assignment fields (owner, steward, assignee, responsible person, or
 * creator). Returns false for a missing user/record.
 */
export function isAssignedTo(
  user: MinimalUser | undefined,
  record: Record<string, unknown> | undefined | null,
): boolean {
  if (!user?.sub || !record) return false;
  return ASSIGNMENT_FIELDS.some((f) => {
    const v = record[f];
    return typeof v === 'string' && v === user.sub;
  });
}

/**
 * Layer-2 guard for a mutation on an existing record. Returns an
 * AppError(403) when an assigned-scoped role (CONTRIBUTOR) tries to
 * modify a record they are not assigned to; otherwise `undefined`.
 *
 * Passes through when there is no authenticated user (e.g. a router
 * mounted without `authenticateToken` in a unit test) or the role is
 * not assigned-scoped — layer 1 has already ruled on those.
 */
export function enforceAssignment(
  user: MinimalUser | undefined,
  record: unknown,
): AppError | undefined {
  if (!user || !isAssignedScopedRole(user.role)) return undefined;
  if (isAssignedTo(user, record as Record<string, unknown>)) return undefined;
  return new AppError('You can only modify records assigned to you', 403);
}

/**
 * Owner to stamp on a record at creation time. For an assigned-scoped
 * role that didn't name an explicit owner, default to the creator so
 * they own — and can subsequently edit — what they create. Other
 * roles keep the supplied value (or null).
 */
export function ownerOnCreate(
  user: MinimalUser | undefined,
  suppliedOwnerId: string | null | undefined,
): string | null {
  if (suppliedOwnerId) return suppliedOwnerId;
  if (isAssignedScopedRole(user?.role) && user?.sub) return user.sub;
  return null;
}
