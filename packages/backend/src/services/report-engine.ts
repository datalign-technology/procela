/**
 * Report execution engine
 * ────────────────────────────────────────────────────────────────────────
 *
 * Takes a ReportDefinition (the spec a user builds in the Report Builder
 * UI), a target orgId, and returns the result rows. The engine reads
 * straight from the in-memory entity stores and resolves cross-entity
 * joins by following LDM relationships. No SQL, no Prisma — that's
 * Phase 3 (once Postgres lands).
 *
 * Design notes:
 *
 *   - Filters operate on the primary entity's direct fields only in v1.
 *     Filtering on joined fields (e.g. "Owner Name contains Smith") is
 *     trickier — you need to denormalise first — and can wait for v2.
 *   - Projection (columns) does support joined fields, written as
 *     "relationshipId.fieldId" (e.g. "responsiblePerson.name"). Multi-
 *     valued relationships return a comma-joined string.
 *   - Sort and limit are applied last, after projection, so they sort on
 *     the rendered values (handy for joined columns).
 */

import { getEntity, type LdmEntity } from './data-model';
import { people } from '../routes/people';
import { skills } from '../stores/skills';
import { processNodes } from '../routes/process-catalog';
import { dataAssets } from '../routes/data-assets';
import { systems } from '../routes/systems';
import { mappings } from '../routes/mappings';
import { dataDomains } from '../routes/data-domains';
import { damaRoles } from '../routes/dama-roles';
import { organizations } from '../routes/organizations';

export type FilterOp =
  | 'eq' | 'ne'
  | 'in'
  | 'contains'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'isNull' | 'isNotNull';

export interface ReportColumn {
  /** Field id on the primary entity, or "relationshipId.fieldId" for a
   *  joined field. The engine validates this against the LDM. */
  field: string;
  /** Optional display label override for the column header. Falls back
   *  to the LDM field label. */
  label?: string;
}

export interface ReportFilter {
  /** Direct field id on the primary entity. Joined-field filters are
   *  not supported in v1. */
  field: string;
  op: FilterOp;
  /** Value(s) for the op. Strings for most ops; arrays for `in`. */
  value?: string | number | boolean | Array<string | number>;
}

export interface ReportSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ReportDefinition {
  /** LDM entity id (e.g. 'processNodes'). */
  entity: string;
  columns: ReportColumn[];
  filters: ReportFilter[];
  sort?: ReportSort;
  /** Hard cap on rows returned. Defaults to 1000 server-side. */
  limit?: number;
}

export interface ReportRunResult {
  /** Column descriptors in render order: header + the raw field key. */
  columns: Array<{ field: string; label: string }>;
  /** Row values keyed by the column's `field` id. */
  rows: Array<Record<string, unknown>>;
  /** Total matched rows before limit was applied — useful for "of N" labels. */
  totalMatched: number;
}

// ── Store registry ───────────────────────────────────────────────────────
//
// Maps an LDM entity id to the actual in-memory array. Adding a new
// entity to the LDM requires one new line here. Kept as a function (not
// a top-level object) so test fixtures can replace the underlying
// arrays — test/array-by-reference replaces only the contents, not the
// binding.

const STORES: Record<string, () => unknown[]> = {
  processNodes: () => processNodes,
  dataAssets: () => dataAssets,
  systems: () => systems,
  people: () => people,
  organizations: () => organizations,
  mappings: () => mappings,
  dataDomains: () => dataDomains,
  damaRoles: () => damaRoles,
  skills: () => skills,
};

function getStore(entityId: string): unknown[] {
  const fn = STORES[entityId];
  if (!fn) throw new Error(`No store registered for entity '${entityId}'`);
  return fn();
}

// ── Validation ───────────────────────────────────────────────────────────

export interface DefinitionValidationError {
  field?: string;
  message: string;
}

/** Static validation of a ReportDefinition against the LDM. Returns the
 *  list of problems; an empty list means the spec is runnable. */
export function validateDefinition(def: ReportDefinition): DefinitionValidationError[] {
  const errors: DefinitionValidationError[] = [];
  const entity = getEntity(def.entity);
  if (!entity) {
    errors.push({ message: `Unknown entity '${def.entity}'.` });
    return errors;
  }
  if (!def.columns || def.columns.length === 0) {
    errors.push({ message: 'A report needs at least one column.' });
  }
  for (const col of def.columns || []) {
    if (!resolveFieldPath(entity, col.field)) {
      errors.push({ field: col.field, message: `Column '${col.field}' does not exist on ${entity.label}.` });
    }
  }
  for (const f of def.filters || []) {
    const direct = entity.fields.find((x) => x.id === f.field);
    if (!direct) {
      errors.push({ field: f.field, message: `Filter '${f.field}' must be a direct field of ${entity.label}.` });
    }
  }
  if (def.sort) {
    if (!resolveFieldPath(entity, def.sort.field)) {
      errors.push({ field: def.sort.field, message: `Sort field '${def.sort.field}' does not exist on ${entity.label}.` });
    }
  }
  return errors;
}

interface ResolvedField {
  /** Final display label for the column header. */
  label: string;
  /** Reader: given a primary-entity row, returns the rendered value. */
  read: (row: Record<string, unknown>) => unknown;
}

function resolveFieldPath(entity: LdmEntity, fieldPath: string): ResolvedField | null {
  // Direct field, no dot.
  if (!fieldPath.includes('.')) {
    const f = entity.fields.find((x) => x.id === fieldPath);
    if (!f) return null;
    return { label: f.label, read: (row) => row[fieldPath] };
  }
  // Joined field — exactly one dot.
  const [relId, targetFieldId, ...rest] = fieldPath.split('.');
  if (rest.length > 0) return null;
  const rel = entity.relationships.find((r) => r.id === relId);
  if (!rel) return null;
  const target = getEntity(rel.target);
  if (!target) return null;
  const targetField = target.fields.find((x) => x.id === targetFieldId);
  if (!targetField) return null;

  const label = `${rel.label} — ${targetField.label}`;
  const targetStore = () => getStore(rel.target) as Array<Record<string, unknown>>;

  if (rel.cardinality === 'one') {
    return {
      label,
      read: (row) => {
        const fk = row[rel.via];
        if (!fk) return null;
        const hit = targetStore().find((r) => r.id === fk);
        return hit ? hit[targetFieldId] : null;
      },
    };
  }
  return {
    label,
    read: (row) => {
      const fks = (row[rel.via] as string[]) || [];
      if (!Array.isArray(fks) || fks.length === 0) return '';
      const hits = targetStore().filter((r) => fks.includes(r.id as string));
      return hits.map((h) => h[targetFieldId]).filter((v) => v != null).join(', ');
    },
  };
}

// ── Filter evaluation ────────────────────────────────────────────────────

function matches(rowValue: unknown, op: FilterOp, value: ReportFilter['value']): boolean {
  switch (op) {
    case 'eq':           return rowValue === value;
    case 'ne':           return rowValue !== value;
    case 'isNull':       return rowValue == null;
    case 'isNotNull':    return rowValue != null;
    case 'in':           return Array.isArray(value) && (value as unknown[]).includes(rowValue);
    case 'contains':     return typeof rowValue === 'string' && typeof value === 'string'
                                && rowValue.toLowerCase().includes(value.toLowerCase());
    case 'gt':           return typeof rowValue === 'number' && typeof value === 'number' && rowValue > value;
    case 'lt':           return typeof rowValue === 'number' && typeof value === 'number' && rowValue < value;
    case 'gte':          return typeof rowValue === 'number' && typeof value === 'number' && rowValue >= value;
    case 'lte':          return typeof rowValue === 'number' && typeof value === 'number' && rowValue <= value;
    default:             return false;
  }
}

// ── Execution ────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 1000;

export function executeReport(def: ReportDefinition, orgId: string): ReportRunResult {
  const errors = validateDefinition(def);
  if (errors.length > 0) {
    throw new Error(`Invalid report definition: ${errors.map((e) => e.message).join('; ')}`);
  }
  const entity = getEntity(def.entity)!;

  // 1. Source rows for the primary entity, scoped to the org. Entities
  //    that don't have an orgId field (the `people` row carries
  //    `orgIds: string[]` instead, organizations are global) get
  //    handled per-entity here.
  let rows = getStore(def.entity) as Array<Record<string, unknown>>;
  rows = filterByOrg(def.entity, rows, orgId);

  // 2. Apply WHERE filters on direct fields.
  for (const f of def.filters || []) {
    rows = rows.filter((row) => matches(row[f.field], f.op, f.value));
  }
  const totalMatched = rows.length;

  // 3. Project columns. Each column's render value is computed once
  //    per row and stored under its `field` key.
  const resolved = (def.columns || []).map((c) => {
    const r = resolveFieldPath(entity, c.field)!;
    return { field: c.field, label: c.label ?? r.label, read: r.read };
  });
  const projected: Array<Record<string, unknown>> = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of resolved) out[col.field] = col.read(row);
    return out;
  });

  // 4. Sort (after projection so joined columns sort on their rendered values).
  if (def.sort) {
    const dir = def.sort.direction === 'desc' ? -1 : 1;
    const key = def.sort.field;
    projected.sort((a, b) => {
      const av = a[key]; const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  }

  // 5. Limit.
  const limit = Math.min(def.limit ?? DEFAULT_LIMIT, 10_000);
  const finalRows = projected.slice(0, limit);

  return {
    columns: resolved.map(({ field, label }) => ({ field, label })),
    rows: finalRows,
    totalMatched,
  };
}

function filterByOrg(
  entityId: string,
  rows: Array<Record<string, unknown>>,
  orgId: string,
): Array<Record<string, unknown>> {
  if (entityId === 'organizations') {
    // The orgs tree is universally visible; scope by id-or-descendant
    // lookups belong to the org-tree code, not the report engine.
    return rows;
  }
  if (entityId === 'people') {
    return rows.filter((p) => (p.orgIds as string[] | undefined)?.includes(orgId));
  }
  return rows.filter((r) => r.orgId === orgId);
}
