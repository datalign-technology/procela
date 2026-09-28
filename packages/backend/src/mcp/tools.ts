// ──────────────────────────────────────────────────────────────────────────
// Read-only MCP tools over the Procela governed catalog.
//
// Each tool: (1) asserts the caller's role can read that resource, (2) resolves
// & authorizes the target org (never revealing another tenant's existence),
// (3) writes an audit entry, then (4) returns structured JSON. The catalog
// loader and scope resolver are injected so the tools are unit-testable without
// a live store; server.ts wires the real repo-backed implementations.
// ──────────────────────────────────────────────────────────────────────────

import type { ToolDefinition } from './protocol';
import { jsonResult, McpError, RPC } from './protocol';
import type { Session } from './identity';
import {
  type OrgCatalog, type ResolvedScopeLike, ownerIdOf, computeGaps, ancestorTrail,
  type ProcessNode,
} from './catalog';

const CAP = 50;
function cap<T>(items: T[]): { count: number; truncated: boolean; items: T[] } {
  return { count: items.length, truncated: items.length > CAP, items: items.slice(0, CAP) };
}

export interface ToolDeps {
  session: Session;
  loadCatalog: (orgId: string) => Promise<OrgCatalog>;
  resolveScope: (cat: OrgCatalog) => Promise<ResolvedScopeLike | null>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  const { session } = deps;
  const nodeView = (cat: OrgCatalog, n: ProcessNode) => ({
    id: n.id, name: n.name, level: n.level, status: n.status, owner: cat.nameOf(n.ownerId),
  });

  // Shared preamble: check the read permission, resolve+authorize the org,
  // audit the call, and load the org-scoped catalog.
  async function begin(tool: string, permission: string, args: Record<string, unknown>): Promise<OrgCatalog> {
    session.assertRead(permission);
    const orgId = session.resolveOrg(args.orgId);
    session.assertMcpEnabled(orgId);
    session.audit(orgId, tool, args);
    return deps.loadCatalog(orgId);
  }

  const orgIdProp = { orgId: { type: 'string', description: 'Organization id (company or division). Defaults to your own org.' } };

  return [
    {
      name: 'list_value_streams',
      description: 'List the process hierarchy (value stream → process → sub-process → activity) with each node\'s status and accountable owner, for an organization.',
      inputSchema: { type: 'object', properties: { ...orgIdProp } },
      handler: async (args) => {
        const cat = await begin('list_value_streams', 'process:read', args);
        const build = (parentId: string | null): unknown[] =>
          cat.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)
            .map((n) => ({ ...nodeView(cat, n), children: build(n.id) }));
        return jsonResult({ orgId: cat.orgId, valueStreams: build(null) });
      },
    },
    {
      name: 'find_processes_using_asset',
      description: 'Reverse lookup: which process activities (and their parent process / value stream) depend on a given data asset. Identify the asset by id or by name.',
      inputSchema: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: 'Exact data-asset id.' },
          assetName: { type: 'string', description: 'Data-asset name (exact, case-insensitive) if the id is unknown.' },
          ...orgIdProp,
        },
      },
      handler: async (args) => {
        const cat = await begin('find_processes_using_asset', 'data-asset:read', args);
        const byId = str(args.assetId);
        const byName = str(args.assetName)?.toLowerCase();
        const asset = byId ? cat.assets.find((a) => a.id === byId)
          : byName ? cat.assets.find((a) => a.name.toLowerCase() === byName)
            : undefined;
        if (!asset) throw new McpError('No matching data asset in this organization.', RPC.INVALID_PARAMS);
        const nodesById = new Map(cat.nodes.map((n) => [n.id, n]));
        const usedBy = cat.mappings.filter((m) => m.dataAssetId === asset.id)
          .map((m) => nodesById.get(m.processStepId))
          .filter((n): n is ProcessNode => !!n)
          .map((n) => ({ activity: nodeView(cat, n), path: ancestorTrail(cat, n.id) }));
        return jsonResult({ asset: { id: asset.id, name: asset.name, tier: asset.governanceTier }, usedBy: cap(usedBy) });
      },
    },
    {
      name: 'get_owner',
      description: 'Get the accountable owner (and stewards, where applicable) of a process, data asset, system, or data domain.',
      inputSchema: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['process', 'asset', 'system', 'domain'], description: 'What kind of entity the id names.' },
          entityId: { type: 'string', description: 'The entity id.' },
          ...orgIdProp,
        },
        required: ['entityType', 'entityId'],
      },
      handler: async (args) => {
        const entityType = str(args.entityType) as 'process' | 'asset' | 'system' | 'domain' | undefined;
        const entityId = str(args.entityId);
        if (!entityType || !entityId) throw new McpError('entityType and entityId are required.', RPC.INVALID_PARAMS);
        const perm = entityType === 'system' ? 'system:read' : entityType === 'process' ? 'process:read' : 'data-asset:read';
        const cat = await begin('get_owner', perm, args);
        const pool = entityType === 'process' ? cat.nodes
          : entityType === 'asset' ? cat.assets
            : entityType === 'system' ? cat.systems
              : cat.domains;
        const entity = (pool as Array<{ id: string; name: string }>).find((e) => e.id === entityId);
        if (!entity) throw new McpError('No such entity in this organization.', RPC.INVALID_PARAMS);
        const ownerId = ownerIdOf(entityType, entity as never);
        const stewardIds = entityType === 'asset' ? (entity as { stewardIds?: string[] }).stewardIds
          : entityType === 'domain' ? (entity as { stewardIds?: string[] }).stewardIds : undefined;
        return jsonResult({
          entityType, id: entity.id, name: entity.name,
          owner: ownerId ? { id: ownerId, name: cat.nameOf(ownerId) } : null,
          stewards: (stewardIds ?? []).map((id) => ({ id, name: cat.nameOf(id) })),
        });
      },
    },
    {
      name: 'list_gaps',
      description: 'List governance gaps for an organization: activities with no data mapped, value streams / processes with no owner, ungoverned (Bronze) assets that support a process, low-health assets, orphan assets (catalogued but unused), and domains with no owner.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['unmappedActivities', 'ownerlessProcesses', 'ungovernedCriticalAssets', 'lowHealthAssets', 'orphanAssets', 'ownerlessDomains'], description: 'Return just one gap kind. Omit for all.' },
          ...orgIdProp,
        },
      },
      handler: async (args) => {
        const cat = await begin('list_gaps', 'process:read', args);
        const gaps = computeGaps(cat);
        const named = (arr: Array<{ id: string; name: string }>) => cap(arr.map((e) => ({ id: e.id, name: e.name })));
        const all = {
          unmappedActivities: named(gaps.unmappedActivities),
          ownerlessProcesses: named(gaps.ownerlessProcesses),
          ungovernedCriticalAssets: named(gaps.ungovernedCriticalAssets),
          lowHealthAssets: named(gaps.lowHealthAssets),
          orphanAssets: named(gaps.orphanAssets),
          ownerlessDomains: named(gaps.ownerlessDomains),
        };
        const kind = str(args.kind);
        return jsonResult(kind && kind in all ? { orgId: cat.orgId, [kind]: (all as Record<string, unknown>)[kind] } : { orgId: cat.orgId, ...all });
      },
    },
    {
      name: 'asset_health',
      description: 'Governance tier and measured data-quality health for a data asset. Health is null when no quality rule measures it yet (never a fabricated score).',
      inputSchema: { type: 'object', properties: { assetId: { type: 'string' }, ...orgIdProp }, required: ['assetId'] },
      handler: async (args) => {
        const cat = await begin('asset_health', 'data-asset:read', args);
        const assetId = str(args.assetId);
        const asset = assetId ? cat.assets.find((a) => a.id === assetId) : undefined;
        if (!asset) throw new McpError('No such data asset in this organization.', RPC.INVALID_PARAMS);
        const h = cat.healthOf(asset);
        return jsonResult({
          id: asset.id, name: asset.name, tier: asset.governanceTier,
          health: h.measured ? h.score : null, measured: h.measured,
          note: h.measured ? undefined : 'No data-quality rule measures this asset yet.',
        });
      },
    },
    {
      name: 'governance_scope',
      description: 'What the governance program governs (in scope) vs what is merely connected / catalogued (not governed), for an organization. When no scope is defined, the whole catalog is governed.',
      inputSchema: {
        type: 'object',
        properties: { view: { type: 'string', enum: ['governed', 'ungoverned', 'both'], description: 'Default both.' }, ...orgIdProp },
      },
      handler: async (args) => {
        const cat = await begin('governance_scope', 'process:read', args);
        const scope = await deps.resolveScope(cat);
        const vsAll = cat.nodes.filter((n) => n.level === 'VALUE_STREAM');
        if (!scope) {
          return jsonResult({
            orgId: cat.orgId, scopeDefined: false,
            note: 'No program scope defined — every catalogued entity is governed by default.',
            governed: { valueStreams: vsAll.length, assets: cat.assets.length, systems: cat.systems.length, domains: cat.domains.length },
          });
        }
        const inSet = (set: Set<string>) => (e: { id: string }) => set.has(e.id);
        const governed = {
          valueStreams: cap(vsAll.filter(inSet(scope.nodeIds)).map((e) => ({ id: e.id, name: e.name }))),
          assets: cap(cat.assets.filter(inSet(scope.assetIds)).map((e) => ({ id: e.id, name: e.name }))),
          systems: cap(cat.systems.filter(inSet(scope.systemIds)).map((e) => ({ id: e.id, name: e.name }))),
          domains: cap(cat.domains.filter(inSet(scope.domainIds)).map((e) => ({ id: e.id, name: e.name }))),
        };
        const notIn = (set: Set<string>) => (e: { id: string }) => !set.has(e.id);
        const ungoverned = {
          valueStreams: cap(vsAll.filter(notIn(scope.nodeIds)).map((e) => ({ id: e.id, name: e.name }))),
          assets: cap(cat.assets.filter(notIn(scope.assetIds)).map((e) => ({ id: e.id, name: e.name }))),
          systems: cap(cat.systems.filter(notIn(scope.systemIds)).map((e) => ({ id: e.id, name: e.name }))),
          domains: cap(cat.domains.filter(notIn(scope.domainIds)).map((e) => ({ id: e.id, name: e.name }))),
        };
        const view = str(args.view) ?? 'both';
        return jsonResult({
          orgId: cat.orgId, scopeDefined: true,
          ...(view !== 'ungoverned' ? { governed } : {}),
          ...(view !== 'governed' ? { connectedNotGoverned: ungoverned } : {}),
        });
      },
    },
    {
      name: 'search_catalog',
      description: 'Search the governed catalog by name across value streams / processes, data assets, systems, and data domains.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring to match against names.' },
          types: { type: 'array', items: { type: 'string', enum: ['process', 'asset', 'system', 'domain'] }, description: 'Limit to these entity types. Omit for all.' },
          ...orgIdProp,
        },
        required: ['query'],
      },
      handler: async (args) => {
        session.assertRead('process:read');
        session.assertRead('data-asset:read');
        const orgId = session.resolveOrg(args.orgId);
        session.assertMcpEnabled(orgId);
        session.audit(orgId, 'search_catalog', args);
        const cat = await deps.loadCatalog(orgId);
        const q = str(args.query)?.toLowerCase();
        if (!q) throw new McpError('query is required.', RPC.INVALID_PARAMS);
        const types = Array.isArray(args.types) ? new Set(args.types.filter((t): t is string => typeof t === 'string')) : null;
        const want = (t: string) => !types || types.has(t);
        const match = <T extends { id: string; name: string }>(arr: T[], type: string) =>
          want(type) ? arr.filter((e) => e.name.toLowerCase().includes(q)).map((e) => ({ type, id: e.id, name: e.name })) : [];
        const hits = [
          ...match(cat.nodes.filter((n) => n.level === 'VALUE_STREAM' || n.level === 'PROCESS'), 'process'),
          ...match(cat.assets, 'asset'),
          ...match(cat.systems, 'system'),
          ...match(cat.domains, 'domain'),
        ];
        return jsonResult({ orgId, query: q, results: cap(hits) });
      },
    },
  ];
}
