// ──────────────────────────────────────────────────────────────────────────
// MCP write model — the persistence side of the write tools.
//
// Like the read model (catalog.ts) this reuses the SAME repositories the REST
// API and the in-app UI write through, so an MCP mutation is indistinguishable
// from an in-app edit at the storage layer (Prisma-backed when DATABASE_URL is
// set, else the JSON store) and can never diverge from in-product behaviour.
// The write tools take these as injected deps (server.ts wires them) so the
// tool logic is unit-testable without a live store.
// ──────────────────────────────────────────────────────────────────────────

import { processNodes, type ProcessNode } from '../routes/process-catalog';
import { dataAssets, type StoredDataAsset } from '../routes/data-assets';
import { systems, type StoredSystem } from '../routes/systems';
import { dataDomains, type StoredDataDomain } from '../routes/data-domains';
import { governanceTasks, type StoredGovernanceTask } from '../routes/governance-tasks';

import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getGovernanceTasksRepository } from '../db/governance-tasks.repo';

import { getCachedOrgList } from '../lib/org-scope';

const nodesRepo = getProcessNodesRepository(processNodes);
const assetsRepo = getDataAssetsRepository(dataAssets);
const systemsRepo = getSystemsRepository(systems);
const domainsRepo = getDataDomainsRepository(dataDomains);
const tasksRepo = getGovernanceTasksRepository(governanceTasks);

export type OwnerEntityType = 'process' | 'asset' | 'system' | 'domain';
export type OrgStatusMode = 'simple' | 'review' | 'advanced';

/** The stored row after an owner change, or null when the id was not found. The
 *  owner field differs by entity (process/domain: `ownerId`; asset/system:
 *  `ownerPersonId`) — this normalizes that, patching the right column. */
export async function updateEntityOwner(
  entityType: OwnerEntityType,
  id: string,
  ownerId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (entityType === 'process') {
    const row = await nodesRepo.update(id, { ownerId, updatedAt: new Date().toISOString() } as Partial<ProcessNode>);
    return row ? { id: row.id, name: row.name } : null;
  }
  if (entityType === 'domain') {
    const row = await domainsRepo.update(id, { ownerId, updatedAt: new Date().toISOString() } as Partial<StoredDataDomain>);
    return row ? { id: row.id, name: row.name } : null;
  }
  if (entityType === 'asset') {
    const row = await assetsRepo.update(id, { ownerPersonId: ownerId, updatedAt: new Date().toISOString() } as Partial<StoredDataAsset>);
    return row ? { id: row.id, name: row.name } : null;
  }
  const row = await systemsRepo.update(id, { ownerPersonId: ownerId, updatedAt: new Date().toISOString() } as Partial<StoredSystem>);
  return row ? { id: row.id, name: row.name } : null;
}

/** Set a process node's lifecycle status. Returns the updated row, or null when
 *  the id was not found. The caller validates the transition first. */
export async function updateNodeStatus(id: string, status: string): Promise<ProcessNode | null> {
  return nodesRepo.update(id, { status, updatedAt: new Date().toISOString() } as Partial<ProcessNode>);
}

/** Persist a new governance task. */
export async function createGovernanceTask(task: StoredGovernanceTask): Promise<StoredGovernanceTask> {
  return tasksRepo.create(task) as Promise<StoredGovernanceTask>;
}

/** The org's configured status workflow mode ('simple' when unset), which picks
 *  the transition state machine set_status validates against — the same source
 *  the REST route uses (`getCachedOrgList().statusMode`). */
export function statusModeOf(orgId: string): OrgStatusMode {
  const org = getCachedOrgList().find((o) => o.id === orgId) as { statusMode?: string } | undefined;
  const mode = org?.statusMode;
  return mode === 'advanced' || mode === 'review' ? mode : 'simple';
}
