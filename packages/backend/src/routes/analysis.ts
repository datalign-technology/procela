import { Router, Request, Response } from 'express';
import { systems } from './systems';
import { dataAssets, dataAssetBindings } from './data-assets';
import { dataDomains } from './data-domains';
import { processNodes } from './process-catalog';
import { people } from './people';
import { damaRoles } from './dama-roles';
import { connections, connectionSystemLinks } from './connections';
import { mappings } from './mappings';
import { getSystemsRepository } from '../db/systems.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getDataAssetBindingsRepository } from '../db/data-asset-bindings.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getDamaRolesRepository } from '../db/dama-roles.repo';
import { getConnectionsRepository } from '../db/connections.repo';
import { getConnectionSystemLinksRepository } from '../db/connection-system-links.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { getVisibleOrgScope } from '../lib/org-scope';

// Repositories — read Postgres when DATABASE_URL is set, else the JSON arrays.
// This analytics route is read-only; each request loads fresh snapshots.
const systemsRepo = getSystemsRepository(systems);
const dataAssetsRepo = getDataAssetsRepository(dataAssets);
const dataAssetBindingsRepo = getDataAssetBindingsRepository(dataAssetBindings);
const dataDomainsRepo = getDataDomainsRepository(dataDomains);
const processNodesRepo = getProcessNodesRepository(processNodes);
const peopleRepo = getPeopleRepository(people);
const damaRolesRepo = getDamaRolesRepository(damaRoles);
const connectionsRepo = getConnectionsRepository(connections);
const connectionSystemLinksRepo = getConnectionSystemLinksRepository(connectionSystemLinks);
const mappingsRepo = getMappingsRepository(mappings);

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

/** Sentinel id used in the pivot key when a fact's reference can't be
 *  resolved to a real entity (e.g. a data asset whose `systemId` points
 *  at a system that's been deleted). Collapsing all unresolved ids in a
 *  dimension to a single key means "(unknown system)" appears at most
 *  once per pivot rather than once per stale id. */
const UNK = '__UNK__';

// Per-dimension labelling — turns an id into something the user can read.
async function makeLookups() {
  const [allSystems, allAssets, allDomains, allNodes, allPeople, allConns] = await Promise.all([
    systemsRepo.list(), dataAssetsRepo.list(), dataDomainsRepo.list(),
    processNodesRepo.list(), peopleRepo.list(), connectionsRepo.list(),
  ]);
  const sys = new Map(allSystems.map((s) => [s.id, s.name]));
  const ass = new Map(allAssets.map((a) => [a.id, a.name]));
  const dom = new Map(allDomains.map((d) => [d.id, d.name]));
  const proc = new Map(allNodes.map((p) => [p.id, p.name]));
  const ppl = new Map(allPeople.map((p) => [p.id, p.name]));
  const conn = new Map(allConns.map((c) => [c.id, c.name]));
  // Roles are special — the "id" is the role type string itself.
  const roleLabel = (t: string) => t;
  /** Map a raw ref to the id that should appear in the pivot key. Real
   *  ids pass through; ids that no longer resolve become the UNK
   *  sentinel so dangling refs group together instead of fanning out
   *  into one row per unresolved id. Roles aren't id-resolved here, so
   *  they always pass through unchanged. */
  const normalize = (dim: Dim, id: string): string => {
    switch (dim) {
      case 'systems':     return sys.has(id) ? id : UNK;
      case 'dataAssets':  return ass.has(id) ? id : UNK;
      case 'domains':     return dom.has(id) ? id : UNK;
      case 'processes':   return proc.has(id) ? id : UNK;
      case 'people':      return ppl.has(id) ? id : UNK;
      case 'connections': return conn.has(id) ? id : UNK;
      case 'roles':       return id;
    }
  };
  return {
    label(dim: Dim, id: string): string {
      if (id === UNK) {
        switch (dim) {
          case 'systems':     return '(unknown system)';
          case 'dataAssets':  return '(unknown asset)';
          case 'domains':     return '(unknown domain)';
          case 'processes':   return '(unknown process)';
          case 'people':      return '(unknown person)';
          case 'connections': return '(unknown connection)';
          case 'roles':       return '(unknown role)';
        }
      }
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
    normalize,
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
async function buildFacts(orgId: string | undefined): Promise<Fact[]> {
  const [allDomains, allAssets, allMappings, allRoles, allSysLinks, allBindings, allNodes, allSystems] = await Promise.all([
    dataDomainsRepo.list(), dataAssetsRepo.list(), mappingsRepo.list(),
    damaRolesRepo.list(), connectionSystemLinksRepo.list(), dataAssetBindingsRepo.list(),
    processNodesRepo.list(), systemsRepo.list(),
  ]);
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
  for (const d of allDomains) {
    if (!inOrg(d)) continue;
    for (const aid of d.dataAssetIds) assetDomain.set(aid, d.id);
  }

  const facts: Fact[] = [];

  // ── Data asset facts ──────────────────────────────────────────────────
  // One fact per (asset, owner|stewardId|nullPerson). Lets the pivot
  // attribute a single asset to multiple owners without double-counting
  // the system or domain in cells where 'people' is not on either axis.
  for (const a of allAssets) {
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
  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  for (const m of allMappings) {
    if (!inOrg(m)) continue;
    if (!m.dataAssetId) continue; // skip policy / attachment-shaped rows
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
  for (const r of allRoles) {
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
  for (const l of allSysLinks) {
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
  for (const b of allBindings) {
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
  for (const p of allNodes) {
    if (!inOrg(p)) continue;
    if (!p.ownerId) continue;
    emit(facts, {
      factId: `proc-owner:${p.id}`,
      factType: 'proc-owner',
      refs: { processes: p.id, people: p.ownerId },
    });
  }

  // ── System owners + deputies ─────────────────────────────────────────
  for (const s of allSystems) {
    if (!inOrg(s)) continue;
    if (s.ownerPersonId) {
      emit(facts, {
        factId: `sys-owner:${s.id}`,
        factType: 'sys-owner',
        refs: { systems: s.id, people: s.ownerPersonId },
      });
    }
    if (s.deputyOwnerId) {
      emit(facts, {
        factId: `sys-deputy:${s.id}`,
        factType: 'sys-owner',
        refs: { systems: s.id, people: s.deputyOwnerId },
      });
    }
  }

  // ── Domain owners + stewards ─────────────────────────────────────────
  for (const d of allDomains) {
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
  // Modern shape: arrays so callers can stack a primary + secondary
  // dimension on each axis (sub-grouping). Single-dim callers can keep
  // sending rowDim/colDim — we coerce. Max 2 dims per axis in v1.
  rowDims?: Dim[];
  colDims?: Dim[];
  rowDim?: Dim;
  colDim?: Dim;
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
const MAX_DIMS_PER_AXIS = 2;

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
//
// Group facts by composite (rowKey1, rowKey2, ..., colKey1, colKey2, ...)
// where each axis carries up to MAX_DIMS_PER_AXIS dimensions. Single-dim
// pivots collapse to the same code path with one-element key arrays.
router.post('/cube', async (req: Request, res: Response) => {
  const body = (req.body || {}) as CubeRequest;
  const { orgId } = body;
  const filters = body.filters || [];
  const maxPerAxis = Math.max(5, Math.min(200, body.maxPerAxis ?? 50));

  // Coerce legacy single-dim shape into the new arrays.
  const rowDims: Dim[] = (body.rowDims && body.rowDims.length > 0)
    ? body.rowDims
    : body.rowDim ? [body.rowDim] : [];
  const colDims: Dim[] = (body.colDims && body.colDims.length > 0)
    ? body.colDims
    : body.colDim ? [body.colDim] : [];

  // ── Validation ──
  if (rowDims.length === 0 || colDims.length === 0) {
    res.status(400).json({ success: false, error: 'At least one row and one column dimension are required' });
    return;
  }
  if (rowDims.length > MAX_DIMS_PER_AXIS || colDims.length > MAX_DIMS_PER_AXIS) {
    res.status(400).json({ success: false, error: `Up to ${MAX_DIMS_PER_AXIS} dimensions per axis.` });
    return;
  }
  for (const d of [...rowDims, ...colDims]) {
    if (!ALL_DIMS.includes(d)) {
      res.status(400).json({ success: false, error: `Unknown dimension: ${d}` });
      return;
    }
  }
  // No duplicates within an axis or across axes — pivoting a dim by
  // itself or against itself isn't meaningful.
  const seen = new Set<Dim>();
  for (const d of [...rowDims, ...colDims]) {
    if (seen.has(d)) {
      res.status(400).json({ success: false, error: `Dimension '${d}' appears more than once.` });
      return;
    }
    seen.add(d);
  }

  const [facts, lookups] = await Promise.all([buildFacts(orgId), makeLookups()]);

  // Apply filters first — narrows the fact table before grouping.
  let filtered = facts;
  if (filters.length > 0) {
    filtered = facts.filter((f) =>
      filters.every((flt) => f.refs[flt.dim] === flt.value),
    );
  }

  // Drop facts that don't populate every dim on either axis. Sub-group
  // by a dim that the fact doesn't attribute to ⇒ the fact has no
  // meaningful position on that axis.
  filtered = filtered.filter((f) =>
    rowDims.every((d) => f.refs[d]) && colDims.every((d) => f.refs[d]),
  );

  // ── Composite key helpers ──
  // Normalize each ref through the lookups so unresolved ids collapse
  // to a single UNK sentinel per dim — otherwise N different dangling
  // ids render N identical "(unknown X)" rows.
  const refsToKey = (f: Fact, dims: Dim[]): string =>
    dims.map((d) => lookups.normalize(d, f.refs[d]!)).join('\x00');
  const keyToPath = (key: string): string[] => key.split('\x00');

  // ── Group ──
  //
  // Cell count is DISTINCT-PAIR semantics: each unique (rowKey,
  // colKey) contributes 1 regardless of how many facts attest it.
  // Before this fix, a Systems × Connections pivot where a single
  // (System, Connection) pair was described by two fact types
  // (the sys-conn link fact AND a data-asset binding fact that
  // joined through to the same system) would count 2 for that
  // one relationship, and the grand total showed a phantom third
  // link that didn't exist. Users read a pivot table as
  // "how many relationships exist between rows and columns" —
  // not "sum of all facts of any type that touch both dimensions"
  // — so distinct-pair is the semantic that matches what people
  // ask.
  //
  // Row / column totals below become "how many columns / rows
  // this axis value participates in" — the standard pivot-table
  // reading. Fact IDs are still collected for drill-down so a
  // user clicking a cell can see every underlying assertion.
  const cells = new Map<string, CubeCell>();
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  for (const f of filtered) {
    const rKey = refsToKey(f, rowDims);
    const cKey = refsToKey(f, colDims);
    rowKeys.add(rKey);
    colKeys.add(cKey);
    const cellKey = `${rKey}\x01${cKey}`;
    let cell = cells.get(cellKey);
    if (!cell) { cell = { count: 0, factIds: [] }; cells.set(cellKey, cell); }
    // Each unique cell counts once — see block comment above.
    cell.count = 1;
    if (cell.factIds.length < MAX_DRILL) cell.factIds.push(f.factId);
  }

  // ── Totals per row / per column ──
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const [k, cell] of cells.entries()) {
    const [rk, ck] = k.split('\x01');
    rowTotals.set(rk, (rowTotals.get(rk) || 0) + cell.count);
    colTotals.set(ck, (colTotals.get(ck) || 0) + cell.count);
  }

  // ── Sort axis values ──
  // Sort by total descending so the heaviest combinations bubble up.
  // Tie-break alphabetically on the first-level label, then second, so
  // sibling sub-rows stay grouped together (the client renders the
  // first-level header as a rowspan-merged cell).
  const labelForPath = (dims: Dim[], path: string[]): string[] =>
    path.map((id, i) => lookups.label(dims[i], id));

  const sortKeys = (keys: Set<string>, dims: Dim[], totals: Map<string, number>): string[] => {
    return Array.from(keys).sort((a, b) => {
      const ta = totals.get(a) || 0;
      const tb = totals.get(b) || 0;
      if (tb !== ta) return tb - ta;
      const la = labelForPath(dims, keyToPath(a));
      const lb = labelForPath(dims, keyToPath(b));
      for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        const cmp = (la[i] || '').localeCompare(lb[i] || '');
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  };

  // For sub-grouping, sort by (first-level total desc, second-level
  // total desc) so sibling sub-rows stick together. Compute per-level
  // totals first.
  const groupedSort = (keys: Set<string>, dims: Dim[]): string[] => {
    if (dims.length <= 1) return sortKeys(keys, dims, dims === rowDims ? rowTotals : colTotals);
    const totals = dims === rowDims ? rowTotals : colTotals;
    // Roll up totals to the first-level key.
    const firstTotals = new Map<string, number>();
    for (const k of keys) {
      const [first] = keyToPath(k);
      firstTotals.set(first, (firstTotals.get(first) || 0) + (totals.get(k) || 0));
    }
    return Array.from(keys).sort((a, b) => {
      const pa = keyToPath(a);
      const pb = keyToPath(b);
      const fa = firstTotals.get(pa[0]) || 0;
      const fb = firstTotals.get(pb[0]) || 0;
      if (fb !== fa) return fb - fa;
      // Same primary group — alpha by first-level label.
      const cmpFirst = lookups.label(dims[0], pa[0]).localeCompare(lookups.label(dims[0], pb[0]));
      if (cmpFirst !== 0) return cmpFirst;
      // Tie-break on second-level total then label.
      const ta = totals.get(a) || 0;
      const tb = totals.get(b) || 0;
      if (tb !== ta) return tb - ta;
      return lookups.label(dims[1], pa[1]).localeCompare(lookups.label(dims[1], pb[1]));
    });
  };

  const rows = groupedSort(rowKeys, rowDims).slice(0, maxPerAxis);
  const cols = groupedSort(colKeys, colDims).slice(0, maxPerAxis);

  // ── Build dense grid ──
  const grid = rows.map((rk) => {
    const path = keyToPath(rk);
    const labels = labelForPath(rowDims, path);
    return {
      rowPath: path,
      rowLabels: labels,
      cells: cols.map((ck) => {
        const cKeyPath = keyToPath(ck);
        const cLabels = labelForPath(colDims, cKeyPath);
        const cell = cells.get(`${rk}\x01${ck}`) || { count: 0, factIds: [] };
        return {
          colPath: cKeyPath,
          colLabels: cLabels,
          count: cell.count,
          factIds: cell.factIds,
        };
      }),
    };
  });

  res.json({
    success: true,
    data: {
      rowDims, colDims,
      // Back-compat: clients reading rowDim/colDim still see the
      // first-level dim so old code degrades gracefully.
      rowDim: rowDims[0], colDim: colDims[0],
      rows: rows.map((rk) => ({
        path: keyToPath(rk),
        labels: labelForPath(rowDims, keyToPath(rk)),
        total: rowTotals.get(rk) || 0,
      })),
      cols: cols.map((ck) => ({
        path: keyToPath(ck),
        labels: labelForPath(colDims, keyToPath(ck)),
        total: colTotals.get(ck) || 0,
      })),
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
router.post('/drill', async (req: Request, res: Response) => {
  const body = (req.body || {}) as { orgId?: string; factIds?: string[] };
  const ids = new Set(body.factIds || []);
  if (ids.size === 0) {
    res.json({ success: true, data: [] });
    return;
  }
  const [facts, lookups] = await Promise.all([buildFacts(body.orgId), makeLookups()]);
  const matched = facts.filter((f) => ids.has(f.factId));

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
