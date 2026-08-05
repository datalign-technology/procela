// SuggestionDismissal repository — the Phase-3 learning-loop
// ledger. Each row records "user dismissed suggestion (kind,
// targetId) for node (nodeId)" so the scoring services can filter
// it out on subsequent fetches. Immutable in practice (created +
// deleted only), but full CRUD is implemented for consistency.

import type { SuggestionDismissal } from '../routes/process-catalog';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonSuggestionDismissalsRepository(
  store: SuggestionDismissal[],
): Repository<SuggestionDismissal> {
  return jsonRepository<SuggestionDismissal>(store, () =>
    saveStore('suggestionDismissals', store),
  );
}

type PrismaSuggestionDismissalRow = {
  id: string;
  orgId: string;
  nodeId: string;
  kind: string;
  targetId: string;
  dismissedBy: string | null;
  dismissedAt: Date;
};

export interface PrismaSuggestionDismissalDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaSuggestionDismissalRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaSuggestionDismissalRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSuggestionDismissalRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSuggestionDismissalRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSuggestionDismissalRow>;
}

function fromPrisma(r: PrismaSuggestionDismissalRow): SuggestionDismissal {
  return {
    id: r.id,
    orgId: r.orgId,
    nodeId: r.nodeId,
    kind: r.kind as SuggestionDismissal['kind'],
    targetId: r.targetId,
    dismissedBy: r.dismissedBy,
    dismissedAt: r.dismissedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<SuggestionDismissal>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.nodeId !== undefined) d.nodeId = row.nodeId;
  if (row.kind !== undefined) d.kind = row.kind;
  if (row.targetId !== undefined) d.targetId = row.targetId;
  if (row.dismissedBy !== undefined) d.dismissedBy = row.dismissedBy;
  if (row.dismissedAt !== undefined) d.dismissedAt = new Date(row.dismissedAt);
  return d;
}

export function prismaSuggestionDismissalsRepository(
  clientFactory: () => { suggestionDismissal: PrismaSuggestionDismissalDelegate } = getPrisma as unknown as () => { suggestionDismissal: PrismaSuggestionDismissalDelegate },
): Repository<SuggestionDismissal> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.suggestionDismissal.findMany({ where: { orgId: filter.orgId } })
        : await client.suggestionDismissal.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.suggestionDismissal.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.suggestionDismissal.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.suggestionDismissal.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.suggestionDismissal.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getSuggestionDismissalsRepository(
  store: SuggestionDismissal[],
): Repository<SuggestionDismissal> {
  return hasDatabase()
    ? prismaSuggestionDismissalsRepository()
    : jsonSuggestionDismissalsRepository(store);
}
