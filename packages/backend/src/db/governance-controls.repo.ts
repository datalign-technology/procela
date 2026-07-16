// GovernanceControl repository — scalar-only per-entity migration.
// A control implements or is subject to a policy; the schema-side
// policyId is intentionally an untyped soft reference so the route's
// "orphan controls on policy delete" behaviour (policyId → '') can
// round-trip.

import type { StoredGovernanceControl } from '../routes/governance-controls';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernanceControlsRepository(store: StoredGovernanceControl[]): Repository<StoredGovernanceControl> {
  return jsonRepository<StoredGovernanceControl>(store, () => saveStore('governanceControls', store));
}

// ── Postgres path ──

type PrismaControlRow = {
  id: string;
  orgId: string;
  policyId: string;
  code: string;
  name: string;
  description: string;
  controlType: string;
  automationMode: string;
  status: string;
  ownerAssignmentId: string | null;
  evidenceRequired: boolean;
  linkedDomainId: string | null;
  linkedSystemId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceControlDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaControlRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaControlRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaControlRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaControlRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaControlRow>;
}

function fromPrisma(r: PrismaControlRow): StoredGovernanceControl {
  return {
    id: r.id,
    orgId: r.orgId,
    policyId: r.policyId,
    code: r.code,
    name: r.name,
    description: r.description,
    controlType: r.controlType as StoredGovernanceControl['controlType'],
    automationMode: r.automationMode as StoredGovernanceControl['automationMode'],
    status: r.status as StoredGovernanceControl['status'],
    ownerAssignmentId: r.ownerAssignmentId,
    evidenceRequired: r.evidenceRequired,
    linkedDomainId: r.linkedDomainId,
    linkedSystemId: r.linkedSystemId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGovernanceControl>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.policyId !== undefined) data.policyId = row.policyId;
  if (row.code !== undefined) data.code = row.code;
  if (row.name !== undefined) data.name = row.name;
  if (row.description !== undefined) data.description = row.description;
  if (row.controlType !== undefined) data.controlType = row.controlType;
  if (row.automationMode !== undefined) data.automationMode = row.automationMode;
  if (row.status !== undefined) data.status = row.status;
  if (row.ownerAssignmentId !== undefined) data.ownerAssignmentId = row.ownerAssignmentId;
  if (row.evidenceRequired !== undefined) data.evidenceRequired = row.evidenceRequired;
  if (row.linkedDomainId !== undefined) data.linkedDomainId = row.linkedDomainId;
  if (row.linkedSystemId !== undefined) data.linkedSystemId = row.linkedSystemId;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaGovernanceControlsRepository(
  clientFactory: () => { governanceControl: PrismaGovernanceControlDelegate } = getPrisma as unknown as () => { governanceControl: PrismaGovernanceControlDelegate },
): Repository<StoredGovernanceControl> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceControl.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceControl.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceControl.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceControl.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.governanceControl.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceControl.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

// ── Factory ──

/**
 * Pick the right GovernanceControl repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getGovernanceControlsRepository(store: StoredGovernanceControl[]): Repository<StoredGovernanceControl> {
  return hasDatabase()
    ? prismaGovernanceControlsRepository()
    : jsonGovernanceControlsRepository(store);
}
