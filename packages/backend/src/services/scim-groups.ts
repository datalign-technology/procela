import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

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

export const scimGroups: StoredScimGroup[] = loadStore<StoredScimGroup>('scim-groups');

export function findGroup(id: string): StoredScimGroup | undefined {
  return scimGroups.find((g) => g.id === id);
}

export function findGroupByDisplayName(name: string): StoredScimGroup | undefined {
  return scimGroups.find((g) => g.displayName.toLowerCase() === name.toLowerCase());
}

export function createGroup(args: {
  displayName: string;
  externalId?: string;
  members?: ScimGroupMember[];
}): StoredScimGroup {
  const now = new Date().toISOString();
  const group: StoredScimGroup = {
    id: uuid(),
    displayName: args.displayName,
    externalId: args.externalId,
    members: args.members || [],
    createdAt: now,
    updatedAt: now,
  };
  scimGroups.push(group);
  saveStore('scim-groups', scimGroups);
  logger.info({ groupId: group.id, displayName: group.displayName }, 'SCIM group created');
  return group;
}

export function replaceGroup(id: string, args: {
  displayName?: string;
  externalId?: string;
  members?: ScimGroupMember[];
}): StoredScimGroup | null {
  const group = findGroup(id);
  if (!group) return null;
  if (args.displayName !== undefined) group.displayName = args.displayName;
  if (args.externalId !== undefined) group.externalId = args.externalId;
  if (args.members !== undefined) group.members = args.members;
  group.updatedAt = new Date().toISOString();
  saveStore('scim-groups', scimGroups);
  return group;
}

export function deleteGroup(id: string): boolean {
  const idx = scimGroups.findIndex((g) => g.id === id);
  if (idx === -1) return false;
  scimGroups.splice(idx, 1);
  saveStore('scim-groups', scimGroups);
  return true;
}

export function addMembers(id: string, members: ScimGroupMember[]): StoredScimGroup | null {
  const group = findGroup(id);
  if (!group) return null;
  for (const m of members) {
    if (!group.members.some((existing) => existing.value === m.value)) {
      group.members.push(m);
    }
  }
  group.updatedAt = new Date().toISOString();
  saveStore('scim-groups', scimGroups);
  return group;
}

export function removeMembers(id: string, memberIds: string[]): StoredScimGroup | null {
  const group = findGroup(id);
  if (!group) return null;
  const before = group.members.length;
  group.members = group.members.filter((m) => !memberIds.includes(m.value));
  if (group.members.length !== before) {
    group.updatedAt = new Date().toISOString();
    saveStore('scim-groups', scimGroups);
  }
  return group;
}

/** Remove a person from every group they're a member of. Called when
 *  a Person is hard-deleted so we don't leave dangling member refs. */
export function removeMemberFromAllGroups(personId: string): void {
  let changed = false;
  for (const g of scimGroups) {
    const before = g.members.length;
    g.members = g.members.filter((m) => m.value !== personId);
    if (g.members.length !== before) {
      g.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveStore('scim-groups', scimGroups);
}
