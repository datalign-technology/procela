import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { getScimGroupsRepository } from '../db/scim-groups.repo';

// ──────────────────────────────────────────────────────────────────────────
// scim-groups — flat group directory used by the SCIM /Groups
// endpoints.
//
// Procela's first-class group concept is governance-groups, which
// carries rich semantics (governance roles, expected memberships,
// org scope). SCIM Groups are membership-only collections — just a
// name + a list of user ids — and the two models don't compose
// cleanly. So this store keeps them separate:
//
//   - SCIM Groups are the IdP's view: "engineering team", "ops on-
//     call", whatever the customer's directory tracks.
//   - Governance Groups stay first-class for the governance program
//     model and aren't synced from the IdP.
//
// Admins who want to drive role / org assignment from SCIM Group
// membership can wire that up later via a mapping table; this commit
// just gets the IdP-facing endpoints working so SCIM Group push
// doesn't fail.
// ──────────────────────────────────────────────────────────────────────────

export interface ScimGroupMember {
  /** Person id (Procela's StoredPerson.id). */
  value: string;
  display?: string;
  type?: 'User' | 'Group';
}

export interface StoredScimGroup {
  id: string;
  displayName: string;
  externalId?: string;
  members: ScimGroupMember[];
  createdAt: string;
  updatedAt: string;
}

// The in-memory array is the JSON-mode backing the repository wraps (and
// the reload-registry target). In Postgres mode the repository talks to
// the scim_groups table and this array is unused. See
// docs/POSTGRES_CUTOVER_PLAN.md (PR 3).
export const scimGroups: StoredScimGroup[] = loadStore<StoredScimGroup>('scim-groups');
registerStore('scim-groups', scimGroups);

const groupsRepo = getScimGroupsRepository(scimGroups);

export async function listGroups(): Promise<StoredScimGroup[]> {
  return groupsRepo.list();
}

export async function findGroup(id: string): Promise<StoredScimGroup | null> {
  return groupsRepo.get(id);
}

export async function findGroupByDisplayName(name: string): Promise<StoredScimGroup | undefined> {
  const all = await groupsRepo.list();
  return all.find((g) => g.displayName.toLowerCase() === name.toLowerCase());
}

export async function createGroup(args: {
  displayName: string;
  externalId?: string;
  members?: ScimGroupMember[];
}): Promise<StoredScimGroup> {
  const now = new Date().toISOString();
  const group: StoredScimGroup = {
    id: uuid(),
    displayName: args.displayName,
    externalId: args.externalId,
    members: args.members || [],
    createdAt: now,
    updatedAt: now,
  };
  await groupsRepo.create(group);
  logger.info({ groupId: group.id, displayName: group.displayName }, 'SCIM group created');
  return group;
}

export async function replaceGroup(id: string, args: {
  displayName?: string;
  externalId?: string;
  members?: ScimGroupMember[];
}): Promise<StoredScimGroup | null> {
  const existing = await groupsRepo.get(id);
  if (!existing) return null;
  const patch: Partial<StoredScimGroup> = { updatedAt: new Date().toISOString() };
  if (args.displayName !== undefined) patch.displayName = args.displayName;
  if (args.externalId !== undefined) patch.externalId = args.externalId;
  if (args.members !== undefined) patch.members = args.members;
  return groupsRepo.update(id, patch);
}

export async function deleteGroup(id: string): Promise<boolean> {
  return groupsRepo.delete(id);
}

export async function addMembers(id: string, members: ScimGroupMember[]): Promise<StoredScimGroup | null> {
  const group = await groupsRepo.get(id);
  if (!group) return null;
  const merged = [...group.members];
  for (const m of members) {
    if (!merged.some((existing) => existing.value === m.value)) {
      merged.push(m);
    }
  }
  return groupsRepo.update(id, { members: merged, updatedAt: new Date().toISOString() });
}

export async function removeMembers(id: string, memberIds: string[]): Promise<StoredScimGroup | null> {
  const group = await groupsRepo.get(id);
  if (!group) return null;
  const filtered = group.members.filter((m) => !memberIds.includes(m.value));
  if (filtered.length === group.members.length) return group; // no change
  return groupsRepo.update(id, { members: filtered, updatedAt: new Date().toISOString() });
}

/** Remove a person from every group they're a member of. Called when
 *  a Person is hard-deleted so we don't leave dangling member refs. */
export async function removeMemberFromAllGroups(personId: string): Promise<void> {
  const all = await groupsRepo.list();
  for (const g of all) {
    const filtered = g.members.filter((m) => m.value !== personId);
    if (filtered.length !== g.members.length) {
      await groupsRepo.update(g.id, { members: filtered, updatedAt: new Date().toISOString() });
    }
  }
}
