import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { assertOrgAccess } from '../lib/tenant-scope';
import { AuthenticatedRequest } from '../middleware/auth';
import logger from '../lib/logger';
import { getGovernanceProgramsRepository } from '../db/governance-programs.repo';
import { resolveProgramScope, computeScopeCoverage } from '../lib/governance-scope';
import { processNodes } from './process-catalog';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { dataDomains } from './data-domains';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { dataAssets } from './data-assets';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { mappings } from './mappings';
import { getMappingsRepository } from '../db/mappings.repo';
import { systems } from './systems';
import { getSystemsRepository } from '../db/systems.repo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperatingModel = 'CENTRALIZED' | 'FEDERATED' | 'HYBRID' | '';

export interface StoredGovernanceProgram {
  id: string;
  orgId: string;
  name: string;
  scope: {
    inScope: string;
    outOfScope: string;
    boundaries: string;
    constraints: string;
    // Structured scope: the catalog entities this program governs, referenced
    // by id. Optional + additive — the free-text `inScope` above still stands
    // for anything not yet catalogued. Drives the Foundation page's in-scope
    // coverage read-out. Absent on programs saved before this field existed.
    systemIds?: string[];
    domainIds?: string[];
    valueStreamIds?: string[];
    // Explicit overrides for the edges the anchor cascade gets wrong:
    // `includeIds` force specific entities (any type) into scope, `excludeIds`
    // force them out. Excludes win on conflict. See lib/governance-scope.
    includeIds?: string[];
    excludeIds?: string[];
  };
  principles: {
    vision: string;
    principles: string[];
    decisionRights: string;
    operatingModel: OperatingModel;
  };
  targetStartDate: string | null;
  targetLaunchDate: string | null;
  /** Scope version — a monotonically increasing counter bumped whenever the
   *  *structured* scope changes (anchors or overrides), so coverage / scorecard
   *  snapshots can be compared apples-to-apples across time. `scopeChangedAt`
   *  records when it last moved. Free-text scope edits don't bump it — the
   *  version tracks what's governed, not the prose. */
  scopeVersion?: number;
  scopeChangedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const governancePrograms: StoredGovernanceProgram[] =
  loadStore<StoredGovernanceProgram>('governancePrograms');
registerStore('governancePrograms', governancePrograms);

const governanceProgramsRepo = getGovernanceProgramsRepository(governancePrograms);
// Catalog repos for the scope-coverage read-out (Postgres in DB mode, the
// in-memory arrays in JSON mode).
const scProcessNodesRepo = getProcessNodesRepository(processNodes);
const scDataDomainsRepo = getDataDomainsRepository(dataDomains);
const scDataAssetsRepo = getDataAssetsRepository(dataAssets);
const scMappingsRepo = getMappingsRepository(mappings);
const scSystemsRepo = getSystemsRepository(systems);

/**
 * Read-only accessor for an org's program *scope anchors* (systems / data
 * domains / value streams it governs), or null when the org has no program
 * yet. Consumed by the governance-scope resolver (gap detection today; coverage
 * and the scorecard next) so "what is governed" has one source of truth.
 */
export async function getProgramScopeForOrg(
  orgId: string,
): Promise<{ systemIds: string[]; domainIds: string[]; valueStreamIds: string[]; includeIds: string[]; excludeIds: string[]; version: number; changedAt: string | null } | null> {
  if (!orgId) return null;
  const all = await governanceProgramsRepo.list();
  const p = all.find((x) => x.orgId === orgId);
  if (!p) return null;
  return {
    includeIds: p.scope?.includeIds || [],
    excludeIds: p.scope?.excludeIds || [],
    systemIds: p.scope?.systemIds || [],
    domainIds: p.scope?.domainIds || [],
    valueStreamIds: p.scope?.valueStreamIds || [],
    version: p.scopeVersion || 1,
    changedAt: p.scopeChangedAt || null,
  };
}

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

function buildDefaultProgram(orgId: string): StoredGovernanceProgram {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    orgId,
    name: 'Data Governance Program',
    scope: { inScope: '', outOfScope: '', boundaries: '', constraints: '', systemIds: [], domainIds: [], valueStreamIds: [], includeIds: [], excludeIds: [] },
    principles: { vision: '', principles: [], decisionRights: '', operatingModel: '' },
    targetStartDate: null,
    targetLaunchDate: null,
    scopeVersion: 1,
    scopeChangedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET /api/v1/governance-program?orgId=X
 * Returns the program for the given org. Creates a default program if none
 * exists so the UI always has something to render.
 */
router.get('/', async (req: Request, res: Response) => {
  const orgIdQuery = req.query.orgId as string | undefined;
  const orgId = orgIdQuery || DEV_ORG_ID;

  // Read through the repository so Postgres mode sees seeded/created
  // programs — the in-memory `governancePrograms` array is empty there.
  const all = await governanceProgramsRepo.list();

  // Prefer an exact-match program for this org. Fall back to org-scope
  // filter only if no direct match — programs are per-org.
  let program = all.find((p) => p.orgId === orgId);
  if (!program) {
    const scoped = filterByOrgScope(all, orgId);
    program = scoped[0];
  }

  if (!program) {
    program = buildDefaultProgram(orgId);
    await governanceProgramsRepo.create(program);
    auditService.log(orgId, null, 'GovernanceProgram', program.id, 'CREATE', null, program);
    logger.info({ programId: program.id, orgId }, 'Created default governance program');
  }

  res.json({ success: true, data: program });
});

/** PUT /api/v1/governance-program/:id — update the program */
router.put('/:id', async (req: Request, res: Response) => {
  const program = await governanceProgramsRepo.get(String(req.params.id));
  if (!program) {
    res.status(404).json({ success: false, error: 'Governance program not found' });
    return;
  }

  const before = JSON.parse(JSON.stringify(program));
  const { name, scope, principles, targetStartDate, targetLaunchDate } = req.body || {};

  if (name !== undefined) program.name = String(name);

  if (scope !== undefined && scope && typeof scope === 'object') {
    // Sanitize a reference-id array: only string ids, deduped. Absent key =>
    // keep the stored value (partial saves don't clobber the other refs).
    const idList = (v: unknown, prev: string[] | undefined): string[] =>
      Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string'))) : (prev || []);
    const nextScope = {
      inScope: typeof scope.inScope === 'string' ? scope.inScope : program.scope.inScope,
      outOfScope: typeof scope.outOfScope === 'string' ? scope.outOfScope : program.scope.outOfScope,
      boundaries: typeof scope.boundaries === 'string' ? scope.boundaries : program.scope.boundaries,
      constraints: typeof scope.constraints === 'string' ? scope.constraints : program.scope.constraints,
      systemIds: scope.systemIds !== undefined ? idList(scope.systemIds, program.scope.systemIds) : program.scope.systemIds,
      domainIds: scope.domainIds !== undefined ? idList(scope.domainIds, program.scope.domainIds) : program.scope.domainIds,
      valueStreamIds: scope.valueStreamIds !== undefined ? idList(scope.valueStreamIds, program.scope.valueStreamIds) : program.scope.valueStreamIds,
      includeIds: scope.includeIds !== undefined ? idList(scope.includeIds, program.scope.includeIds) : program.scope.includeIds,
      excludeIds: scope.excludeIds !== undefined ? idList(scope.excludeIds, program.scope.excludeIds) : program.scope.excludeIds,
    };
    // Bump the scope version only when the *structured* scope (the entities the
    // program governs) actually changes — free-text edits don't move it. A
    // stable key over the sorted id lists makes the check order-insensitive.
    const structuralKey = (s: { systemIds?: string[]; domainIds?: string[]; valueStreamIds?: string[]; includeIds?: string[]; excludeIds?: string[] }) =>
      JSON.stringify([s.systemIds, s.domainIds, s.valueStreamIds, s.includeIds, s.excludeIds].map((a) => [...(a || [])].sort()));
    if (structuralKey(nextScope) !== structuralKey(program.scope)) {
      program.scopeVersion = (program.scopeVersion || 1) + 1;
      program.scopeChangedAt = new Date().toISOString();
    }
    program.scope = nextScope;
  }

  if (principles !== undefined && principles && typeof principles === 'object') {
    const nextOperatingModel: OperatingModel =
      principles.operatingModel === 'CENTRALIZED' ||
      principles.operatingModel === 'FEDERATED' ||
      principles.operatingModel === 'HYBRID' ||
      principles.operatingModel === ''
        ? principles.operatingModel
        : program.principles.operatingModel;

    program.principles = {
      vision: typeof principles.vision === 'string' ? principles.vision : program.principles.vision,
      principles: Array.isArray(principles.principles)
        ? principles.principles.filter((x: any) => typeof x === 'string')
        : program.principles.principles,
      decisionRights: typeof principles.decisionRights === 'string'
        ? principles.decisionRights
        : program.principles.decisionRights,
      operatingModel: nextOperatingModel,
    };
  }

  if (targetStartDate !== undefined) {
    program.targetStartDate = targetStartDate ? String(targetStartDate) : null;
  }
  if (targetLaunchDate !== undefined) {
    program.targetLaunchDate = targetLaunchDate ? String(targetLaunchDate) : null;
  }

  program.updatedAt = new Date().toISOString();
  await governanceProgramsRepo.update(program.id, program);

  const actorId = (req as AuthenticatedRequest).user?.sub || null;
  auditService.log(program.orgId, actorId, 'GovernanceProgram', program.id, 'UPDATE', before, program);
  logger.info({ programId: program.id }, 'Updated governance program');

  res.json({ success: true, data: program });
});

/**
 * GET /api/v1/governance-program/scope-coverage?orgId= — how governed the
 * program's in-scope assets are. Resolves the org's scope anchors, then reports
 * the mapped / governed / owned share of the in-scope assets, plus the in-scope
 * entity counts. `applied:false` when the org has no program or an empty scope
 * (nothing to measure yet) — the caller then shows "define scope" rather than a
 * misleading 0%. Registered before `/:id/...` so the literal path wins.
 */
router.get('/scope-coverage', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
  const empty = { applied: false as const, entities: null, coverage: null, backlog: null, version: null };
  if (!orgId) { res.json({ success: true, data: empty }); return; }
  if (!assertOrgAccess(req as AuthenticatedRequest, res, orgId, 'Not found')) return;

  const anchors = await getProgramScopeForOrg(orgId);
  const [allNodes, allDomains, allAssets, allMappings, allSystems] = await Promise.all([
    scProcessNodesRepo.list(), scDataDomainsRepo.list(), scDataAssetsRepo.list(), scMappingsRepo.list(), scSystemsRepo.list(),
  ]);
  const nodes = filterByOrgScope(allNodes, orgId);
  const domains = filterByOrgScope(allDomains, orgId);
  const assets = filterByOrgScope(allAssets, orgId);
  const orgSystems = filterByOrgScope(allSystems, orgId);
  const resolved = resolveProgramScope(anchors, { nodes, domains, assets, systems: orgSystems });
  if (!resolved) { res.json({ success: true, data: empty }); return; }

  const mappedAssetIds = new Set(filterByOrgScope(allMappings, orgId).map((m: any) => m.dataAssetId));
  const coverage = computeScopeCoverage(resolved, { assets: assets as any[], mappedAssetIds });

  // "Connected, but not governed" backlog — catalogued entities that fall
  // outside the resolved scope. The on-ramp to expanding scope, and proof that
  // narrowing scope never silently drops anything: what's excluded is counted,
  // not hidden. Value streams are the top-level process nodes only.
  const orgValueStreams = nodes.filter((n: any) => n.level === 'VALUE_STREAM');
  const backlog = {
    systems: orgSystems.filter((s: any) => !resolved.systemIds.has(s.id)).length,
    dataDomains: domains.filter((d: any) => !resolved.domainIds.has(d.id)).length,
    dataAssets: assets.filter((a: any) => !resolved.assetIds.has(a.id)).length,
    valueStreams: orgValueStreams.filter((n: any) => !resolved.nodeIds.has(n.id)).length,
  };

  res.json({
    success: true,
    data: {
      applied: true,
      entities: {
        systems: resolved.systemIds.size,
        dataDomains: resolved.domainIds.size,
        valueStreamNodes: resolved.nodeIds.size,
        dataAssets: resolved.assetIds.size,
      },
      coverage,
      backlog,
      // The scope version this coverage was measured against, so a reader
      // knows the basis and period-over-period comparisons can flag a scope
      // change between two points.
      version: { number: anchors!.version, changedAt: anchors!.changedAt },
    },
  });
});

/**
 * GET /api/v1/governance-program/scope-membership?orgId= — the resolved
 * in-scope id sets, so a list page can badge each row "in scope / not
 * governed". Same resolution as scope-coverage, but returns the ids (as
 * arrays) rather than counts. `applied:false` (empty arrays) when the org has
 * no program or an empty scope — the caller then shows no badges (everything
 * is "governed" by default, so a badge would be noise). Registered before
 * `/:id/...` so the literal path wins.
 */
router.get('/scope-membership', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
  const empty = { applied: false as const, systemIds: [], domainIds: [], dataAssetIds: [], valueStreamNodeIds: [], version: null };
  if (!orgId) { res.json({ success: true, data: empty }); return; }
  if (!assertOrgAccess(req as AuthenticatedRequest, res, orgId, 'Not found')) return;

  const anchors = await getProgramScopeForOrg(orgId);
  const [allNodes, allDomains, allAssets, allSystems] = await Promise.all([
    scProcessNodesRepo.list(), scDataDomainsRepo.list(), scDataAssetsRepo.list(), scSystemsRepo.list(),
  ]);
  const nodes = filterByOrgScope(allNodes, orgId);
  const domains = filterByOrgScope(allDomains, orgId);
  const assets = filterByOrgScope(allAssets, orgId);
  const orgSystems = filterByOrgScope(allSystems, orgId);
  const resolved = resolveProgramScope(anchors, { nodes, domains, assets, systems: orgSystems });
  if (!resolved) { res.json({ success: true, data: empty }); return; }

  res.json({
    success: true,
    data: {
      applied: true,
      systemIds: [...resolved.systemIds],
      domainIds: [...resolved.domainIds],
      dataAssetIds: [...resolved.assetIds],
      valueStreamNodeIds: [...resolved.nodeIds],
      version: { number: anchors!.version, changedAt: anchors!.changedAt },
    },
  });
});

export default router;
