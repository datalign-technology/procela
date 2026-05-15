import { Router, Request, Response } from 'express';
import { systems } from './systems';
import { dataAssets, dataAssetBindings } from './data-assets';
import { dataDomains } from './data-domains';
import { processNodes } from './process-catalog';
import { people } from './people';
import { damaRoles } from './dama-roles';
import { connections, connectionSystemLinks } from './connections';
import { mappings } from './mappings';
import { getVisibleOrgScope } from '../lib/org-scope';

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS — cube-style pivot engine.
//
// Users drag entity types into Rows and Columns on the AnalysisPage; this
// endpoint returns the grid of counts plus the underlying fact ids so the
// client can drill into a cell and show matching entities.
//
// Design: build a single in-memory "facts table" each request, then group
// by the row/col dimensions. Each fact references one entity per
// dimension; the pivot counts how many facts attribute to each (row, col)
// pair.
//
// A single domain object (e.g. one Data Asset) typically becomes ONE fact
// with multiple refs — systems, domains, owners, etc. — so the same fact
// shows up across many possible pivots. This avoids defining N² explicit
// (row,col) intersection rules — the relationships fall out of which
// dimensions the fact happens to populate.
// ═══════════════════════════════════════════════════════════════════════════

export type Dim = 'systems' | 'dataAssets' | 'domains' | 'processes' | 'roles' | 'people' | 'connections';

const ALL_DIMS: Dim[] = ['systems', 'dataAssets', 'domains', 'processes', 'roles', 'people', 'connections'];

// Per-dimension labelling — turns an id into something the user can read.
function makeLookups() {
  const sys = new Map(systems.map((s) => [s.id, s.name]));
  const ass = new Map(dataAssets.map((a) => [a.id, a.name]));
  const dom = new Map(dataDomains.map((d) => [d.id, d.name]));
  const proc = new Map(processNodes.map((p) => [p.id, p.name]));
  const ppl = new Map(people.map((p) => [p.id, p.name]));
  const conn = new Map(connections.map((c) => [c.id, c.name]));
  // Roles are special — the "id" is the role type string itself.
  const roleLabel = (t: string) => t;
  return {
    label(dim: Dim, id: string): string {
      switch (dim) {
        case 'systems':     return sys.get(id) || '(unknown system)';
        case 'dataAssets':  return ass.get(id) || '(unknown asset)';
        case 'domains':     return dom.get(id) || '(unknown domain)';
        case 'processes':   return proc.get(id) || '(unknown process)';
        case 'people':      return ppl.get(id) || '(unknown person)';
        case 'connections': return conn.get(id) || '(unknown connection)';
        case 'roles':       return roleLabel(id);
      }
    },
  };
}

interface Fact {
  // Stable id for drill-down; need not be unique across fact sources.
  factId: string;
  // Which fact source produced this row. Useful as a filter ("Owners only").
  factType: 'asset' | 'mapping' | 'role' | 'sys-conn' | 'binding' | 'proc-owner' | 'sys-owner' | 'domain-owner';
  // Reference per dimension. Null/undefined means the fact doesn't
  // attribute to that dimension — pivots with that dimension as a row or
  // column will drop the fact.
  refs: Partial<Record<Dim, string>>;
}

function emit(facts: Fact[], f: Fact): void { facts.push(f); }

// Build the fact table for a given org scope. Each asset produces one
// fact per (system,domain,owner,steward) combination so the pivot can
// count ownership the way users expect.
function buildFacts(orgId: string | undefined): Fact[] {
  const scope = orgId ? getVisibleOrgScope(orgId) : null;
  const inOrg = <T extends { orgId?: string; orgIds?: string[] }>(x: T): boolean => {
    if (!scope) return true;
    if (x.orgId && scope.has(x.orgId)) return true;
    if (Array.isArray(x.orgIds) && x.orgIds.some((id) => scope.has(id))) return true;
    return false;
  };

  // Build a domain-lookup for each asset (data domains hold an array of
  // assetIds, not the other way around).
  const assetDomain = new Map<string, string>();
  for (const d of dataDomains) {
    if (!inOrg(d)) continue;
    for (const aid of d.dataAssetIds) assetDomain.set(aid, d.id);
  }

  const facts: Fact[] = [];

  // ── Data asset facts ──────────────────────────────────────────────────
  // One fact per (asset, owner|stewardId|nullPerson). Lets the pivot
  // attribute a single asset to multiple owners without double-counting
  // the system or domain in cells where 'people' is not on either axis.
  for (const a of dataAssets) {
    if (!inOrg(a)) continue;
    const domainId = assetDomain.get(a.id);
    const peopleRefs = [a.ownerPersonId, ...(a.stewardIds || [])].filter(Boolean) as string[];
    if (peopleRefs.length === 0) peopleRefs.push('');  // emit one fact with no person
    for (const pid of peopleRefs) {
      emit(facts, {
        factId: `asset:${a.id}:${pid || '-'}`,
        factType: 'asset',
        refs: {
          dataAssets: a.id,
          systems: a.systemId || undefined,
          domains: domainId,
          people: pid || undefined,
        },
      });
    }
  }

  // ── Process step ↔ asset mappings ─────────────────────────────────────
  // Each mapping links a process step to an asset; through the asset we
  // also learn the system and (via domain lookup) the domain.
  const assetById = new Map(dataAssets.map((a) => [a.id, a]));
  for (const m of mappings) {
    if (!inOrg(m)) continue;
    const asset = assetById.get(m.dataAssetId);
    emit(facts, {
      factId: `mapping:${m.id}`,
      factType: 'mapping',
      refs: {
        processes: m.processStepId,
        dataAssets: m.dataAssetId,
        systems: asset?.systemId,
        domains: asset ? assetDomain.get(asset.id) : undefined,
      },
    });
  }

  // ── DAMA role assignments ─────────────────────────────────────────────
  // Two refs only — roleType (which doubles as the role id) and the
  // person/agent holding it. Pivots like "Roles × People" run on this.
  for (const r of damaRoles) {
    const subjectId = r.personId || r.agentId || '';
    if (!subjectId) continue;
    emit(facts, {
      factId: `role:${r.id}`,
      factType: 'role',
      refs: {
        roles: r.roleType,
        people: r.personId || undefined,  // agent ids excluded from 'people' axis
      },
    });
  }

  // ── Connection ↔ system links ────────────────────────────────────────
  for (const l of connectionSystemLinks) {
    if (!inOrg(l)) continue;
    emit(facts, {
      factId: `sys-conn:${l.id}`,
      factType: 'sys-conn',
      refs: { connections: l.connectionId, systems: l.systemId },
    });
  }

  // ── Connection-driven asset bindings ─────────────────────────────────
  // Captures (connection, dataAsset, system) — answers "which connections
  // feed which assets in which system?"
  for (const b of dataAssetBindings) {
    if (!inOrg(b)) continue;
    const asset = assetById.get(b.dataAssetId);
    emit(facts, {
      factId: `binding:${b.id}`,
      factType: 'binding',
      refs: {
        dataAssets: b.dataAssetId,
        connections: b.connectionId,
        systems: asset?.systemId,
        domains: asset ? assetDomain.get(asset.id) : undefined,
      },
    });
  }

  // ── Process owners ───────────────────────────────────────────────────
  for (const p of processNodes) {
    if (!inOrg(p)) continue;
    if (!p.ownerId) continue;
    emit(facts, {
      factId: `proc-owner:${p.id}`,
      factType: 'proc-owner',
      refs: { processes: p.id, people: p.ownerId },
    });
  }

  // ── System owners + deputies ─────────────────────────────────────────
  for (const s of systems) {
    if (!inOrg(s)) continue;
    if (s.ownerPersonId) {
      emit(facts, {
        factId: `sys-owner:${s.id}`,
        factType: 'sys-owner',
        refs: { systems: s.id, people: s.ownerPersonId },
      });
    }
    if ((s as any).deputyOwnerPersonId) {
      emit(facts, {
        factId: `sys-deputy:${s.id}`,
        factType: 'sys-owner',
        refs: { systems: s.id, people: (s as any).deputyOwnerPersonId },
      });
    }
  }

  // ── Domain owners + stewards ─────────────────────────────────────────
  for (const d of dataDomains) {
    if (!inOrg(d)) continue;
    if (d.ownerId) {
      emit(facts, {
        factId: `domain-owner:${d.id}:${d.ownerId}`,
        factType: 'domain-owner',
        refs: { domains: d.id, people: d.ownerId },
      });
    }
    for (const sid of d.stewardIds || []) {
      emit(facts, {
        factId: `domain-steward:${d.id}:${sid}`,
        factType: 'domain-owner',
        refs: { domains: d.id, people: sid },
      });
    }
  }

  return facts;
}

interface CubeRequest {
  orgId?: string;
  rowDim: Dim;
  colDim: Dim;
  // Filters constrain facts to those that match the given dim/value.
  filters?: Array<{ dim: Dim; value: string }>;
  // Cap so a 500-asset axis doesn't crush the client. Default 50 per axis.
  maxPerAxis?: number;
}

interface CubeCell {
  count: number;
  // Up to MAX_DRILL fact ids per cell so the client can show a
  // representative drill list without trying to JSON-serialize the
  // whole dataset.
  factIds: string[];
}

const MAX_DRILL = 100;

const router = Router();

// GET /api/v1/analysis/dimensions — static metadata the client uses to
// render the draggable dimension tiles. Kept in code (not a config file)
// so the engine stays in lockstep with the fact schema.
router.get('/dimensions', (_req, res) => {
  res.json({
    success: true,
    data: ALL_DIMS.map((id) => ({
      id,
      label: ({
        systems: 'Systems',
        dataAssets: 'Data Assets',
        domains: 'Domains',
        processes: 'Processes',
        roles: 'Roles',
        people: 'People',
        connections: 'Connections',
      } as Record<Dim, string>)[id],
      icon: ({
        systems: '⚙',
        dataAssets: '⬢',
        domains: '⊞',
        processes: '⛁',
        roles: '☼',
        people: '👥',
        connections: '⚡',
      } as Record<Dim, string>)[id],
      description: ({
        systems:     'Systems registered in this org.',
        dataAssets:  'Data assets across all systems.',
        domains:     'Data domains and their owners.',
        processes:   'Process steps and their owners.',
        roles:       'Governance role types (CDO, Steward, ...).',
        people:      'People holding roles or ownerships.',
        connections: 'Source connections feeding systems and assets.',
      } as Record<Dim, string>)[id],
    })),
  });
});

// POST /api/v1/analysis/cube — main pivot endpoint.
router.post('/cube', (req: Request, res: Response) => {
  const body = (req.body || {}) as CubeRequest;
  const { rowDim, colDim, orgId } = body;
  const filters = body.filters || [];
  const maxPerAxis = Math.max(5, Math.min(200, body.maxPerAxis ?? 50));

  if (!rowDim || !colDim) {
    res.status(400).json({ success: false, error: 'rowDim and colDim are required' });
    return;
  }
  if (!ALL_DIMS.includes(rowDim) || !ALL_DIMS.includes(colDim)) {
    res.status(400).json({ success: false, error: 'rowDim/colDim must be one of: ' + ALL_DIMS.join(', ') });
    return;
  }
  if (rowDim === colDim) {
    res.status(400).json({ success: false, error: 'rowDim and colDim must differ' });
    return;
  }

  const facts = buildFacts(orgId);
  const lookups = makeLookups();

  // Apply filters first — narrows the fact table before grouping.
  let filtered = facts;
  if (filters.length > 0) {
    filtered = facts.filter((f) =>
      filters.every((flt) => f.refs[flt.dim] === flt.value),
    );
  }

  // Keep only facts that populate both axes.
  filtered = filtered.filter((f) => f.refs[rowDim] && f.refs[colDim]);

  // Group by (rowKey, colKey)
  const cells = new Map<string, CubeCell>();
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  for (const f of filtered) {
    const r = f.refs[rowDim]!;
    const c = f.refs[colDim]!;
    rowKeys.add(r);
    colKeys.add(c);
    const key = `${r}\x00${c}`;
    let cell = cells.get(key);
    if (!cell) { cell = { count: 0, factIds: [] }; cells.set(key, cell); }
    cell.count++;
    if (cell.factIds.length < MAX_DRILL) cell.factIds.push(f.factId);
  }

  // Build labelled axis arrays. Sort by descending row/col totals so the
  // heaviest rows surface to the top; ties broken alphabetically.
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const [key, cell] of cells.entries()) {
    const [r, c] = key.split('\x00');
    rowTotals.set(r, (rowTotals.get(r) || 0) + cell.count);
    colTotals.set(c, (colTotals.get(c) || 0) + cell.count);
  }
  const sortFn = (totals: Map<string, number>) => (a: string, b: string) => {
    const ta = totals.get(a) || 0;
    const tb = totals.get(b) || 0;
    if (tb !== ta) return tb - ta;
    return lookups.label(rowDim, a).localeCompare(lookups.label(rowDim, b));
  };
  const rows = Array.from(rowKeys).sort(sortFn(rowTotals)).slice(0, maxPerAxis);
  const cols = Array.from(colKeys).sort(sortFn(colTotals)).slice(0, maxPerAxis);

  // Materialize the dense grid the client renders. Sparse cells become
  // { count: 0, factIds: [] }.
  const grid: Array<{ rowId: string; rowLabel: string; cells: Array<{ colId: string; colLabel: string; count: number; factIds: string[] }> }> = [];
  for (const r of rows) {
    grid.push({
      rowId: r,
      rowLabel: lookups.label(rowDim, r),
      cells: cols.map((c) => {
        const cell = cells.get(`${r}\x00${c}`) || { count: 0, factIds: [] };
        return { colId: c, colLabel: lookups.label(colDim, c), count: cell.count, factIds: cell.factIds };
      }),
    });
  }

  res.json({
    success: true,
    data: {
      rowDim,
      colDim,
      rows: rows.map((r) => ({ id: r, label: lookups.label(rowDim, r), total: rowTotals.get(r) || 0 })),
      cols: cols.map((c) => ({ id: c, label: lookups.label(colDim, c), total: colTotals.get(c) || 0 })),
      grid,
      // Diagnostics so the UI can show "showing 50 of 187 rows" hints.
      truncated: { rows: rowKeys.size > maxPerAxis, cols: colKeys.size > maxPerAxis },
      totalRows: rowKeys.size,
      totalCols: colKeys.size,
      totalFacts: filtered.length,
    },
  });
});

// POST /api/v1/analysis/drill — resolve a list of fact ids into the
// underlying entity records so the drill-down panel can render names,
// owners, status, etc. The client passes the factIds the cube returned.
router.post('/drill', (req: Request, res: Response) => {
  const body = (req.body || {}) as { orgId?: string; factIds?: string[] };
  const ids = new Set(body.factIds || []);
  if (ids.size === 0) {
    res.json({ success: true, data: [] });
    return;
  }
  const facts = buildFacts(body.orgId);
  const matched = facts.filter((f) => ids.has(f.factId));
  const lookups = makeLookups();

  const enriched = matched.map((f) => ({
    factId: f.factId,
    factType: f.factType,
    refs: Object.fromEntries(
      (Object.entries(f.refs) as Array<[Dim, string | undefined]>)
        .filter(([, v]) => !!v)
        .map(([dim, id]) => [dim, { id, label: lookups.label(dim, id as string) }]),
    ),
  }));

  res.json({ success: true, data: enriched });
});

export default router;
