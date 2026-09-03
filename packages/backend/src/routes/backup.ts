import fs from 'fs';
import { Router, Response } from 'express';
import { wipeAllStores } from '../lib/persistence';
import logger from '../lib/logger';
import { authenticateToken, authorize, AuthenticatedRequest } from '../middleware/auth';
import { auditService, auditLogs } from '../services/audit.service';
import { getVisibleOrgScope } from '../lib/org-scope';
import { restoreAttachmentFile } from './attachments';
import type { Repository } from '../db/repository';

// Import all in-memory stores + their repository factories. The factory wraps
// the same array the route exports, so it reads/writes Postgres in DB mode and
// the array in JSON mode — the export/import below go through the repository,
// never the (stale in Postgres) array directly.
import { processNodes, flowRelationships, processVersions } from './process-catalog';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { organizations } from './organizations';
import { people } from './people';
import { mappings } from './mappings';
import { governanceGroups } from './governance-groups';
import { damaRoles } from './dama-roles';
import { dataDomains } from './data-domains';
import { businessCapabilities } from './business-capabilities';
import { getBusinessCapabilitiesRepository } from '../db/business-capabilities.repo';
import { tags } from './tags';
import { comments } from './comments';
import { governancePolicies } from './governance-policies';
import { attachments } from './attachments';

import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getFlowRelationshipsRepository } from '../db/flow-relationships.repo';
import { getProcessVersionsRepository } from '../db/process-versions.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getOrganizationsRepository } from '../db/organizations.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { getGovernanceGroupsRepository } from '../db/governance-groups.repo';
import { getDamaRolesRepository } from '../db/dama-roles.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getTagsRepository } from '../db/tags.repo';
import { getCommentsRepository } from '../db/comments.repo';
import { getGovernancePoliciesRepository } from '../db/governance-policies.repo';
import { getAttachmentsRepository } from '../db/attachments.repo';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────
// Per-tenant, repository-backed backup.
//
// A backup is scoped to one org subtree (the caller's tenant): the scope org
// plus every descendant org. Every store is read through its repository so the
// export reflects Postgres in DB mode, not the retired in-memory array. Each
// store declares how it maps to an org so the same predicate scopes both the
// export (filter what to write) and the import wipe (filter what to replace).
//
// Two stores are structural / shared identities and are UPSERTED rather than
// wiped, so a restore never severs cross-scope relationships:
//   - organizations: the containers themselves (a delete would cascade).
//   - people: can belong to several orgs at once (orgIds[]); deleting one to
//     replace it would drop its memberships in orgs outside this backup.
// Every other store is REPLACED: existing in-scope rows are deleted, then the
// backup's rows are created.
//
// The registry is ordered parents-before-children so create() satisfies FK
// constraints in Postgres; the wipe walks it in reverse.
// ──────────────────────────────────────────────────────────────────────────

interface ScopeCtx {
  orgIds: Set<string>;   // scope org subtree
  nodeIds: Set<string>;  // process nodes in scope (for flows / versions)
  domainIds: Set<string>; // data domains in scope (for DOMAIN-scoped dama roles)
}

interface StoreDef {
  key: string;
  makeRepo: () => Repository<any>;
  inScope: (row: any, ctx: ScopeCtx) => boolean;
  // 'replace' = delete in-scope rows then load; 'upsert' = never delete, upsert by id.
  mode: 'replace' | 'upsert';
  // Optional create ordering within the store (e.g. comment parents first).
  sortForCreate?: (a: any, b: any) => number;
}

const inByOrgId = (row: any, ctx: ScopeCtx) => !!row.orgId && ctx.orgIds.has(row.orgId);

// Registry in create order (parents first). The wipe reverses it.
const STORES: StoreDef[] = [
  { key: 'organizations', makeRepo: () => getOrganizationsRepository(organizations),
    inScope: (row, ctx) => ctx.orgIds.has(row.id), mode: 'upsert' },
  { key: 'people', makeRepo: () => getPeopleRepository(people),
    inScope: (row, ctx) => Array.isArray(row.orgIds) && row.orgIds.some((id: string) => ctx.orgIds.has(id)), mode: 'upsert' },
  { key: 'systems', makeRepo: () => getSystemsRepository(systems), inScope: inByOrgId, mode: 'replace' },
  // Business capabilities must precede dataDomains: a domain's
  // businessCapabilityId FK requires the capability row to exist first.
  { key: 'businessCapabilities', makeRepo: () => getBusinessCapabilitiesRepository(businessCapabilities), inScope: inByOrgId, mode: 'replace' },
  { key: 'dataDomains', makeRepo: () => getDataDomainsRepository(dataDomains), inScope: inByOrgId, mode: 'replace' },
  { key: 'processNodes', makeRepo: () => getProcessNodesRepository(processNodes), inScope: inByOrgId, mode: 'replace' },
  { key: 'dataAssets', makeRepo: () => getDataAssetsRepository(dataAssets), inScope: inByOrgId, mode: 'replace' },
  { key: 'governanceGroups', makeRepo: () => getGovernanceGroupsRepository(governanceGroups), inScope: inByOrgId, mode: 'replace' },
  { key: 'damaRoles', makeRepo: () => getDamaRolesRepository(damaRoles),
    inScope: (row, ctx) => row.scopeType === 'ORG'
      ? ctx.orgIds.has(row.scopeId)
      : row.scopeType === 'DOMAIN' ? ctx.domainIds.has(row.scopeId) : false,
    mode: 'replace' },
  // Before mappings: a mapping's policyId / attachmentId points at these.
  // Attachment rows are metadata only (filePath, size, mime); the uploaded
  // bytes live on the filesystem / object store and are NOT in a data backup.
  // URL-type attachments are fully captured; FILE-type rows restore their
  // metadata but their content must be moved separately for a cross-host
  // restore.
  { key: 'governancePolicies', makeRepo: () => getGovernancePoliciesRepository(governancePolicies), inScope: inByOrgId, mode: 'replace' },
  { key: 'attachments', makeRepo: () => getAttachmentsRepository(attachments), inScope: inByOrgId, mode: 'replace' },
  { key: 'mappings', makeRepo: () => getMappingsRepository(mappings), inScope: inByOrgId, mode: 'replace' },
  { key: 'flowRelationships', makeRepo: () => getFlowRelationshipsRepository(flowRelationships),
    inScope: (row, ctx) => ctx.nodeIds.has(row.fromNodeId) || ctx.nodeIds.has(row.toNodeId), mode: 'replace' },
  { key: 'processVersions', makeRepo: () => getProcessVersionsRepository(processVersions),
    inScope: (row, ctx) => ctx.nodeIds.has(row.nodeId), mode: 'replace' },
  { key: 'tags', makeRepo: () => getTagsRepository(tags), inScope: inByOrgId, mode: 'replace' },
  { key: 'comments', makeRepo: () => getCommentsRepository(comments), inScope: inByOrgId, mode: 'replace',
    // Parents before replies so a reply's parentId FK resolves on create.
    sortForCreate: (a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) },
];

/** Resolve the scope org subtree: the scope org plus every descendant org. */
async function resolveScopeOrgIds(scopeOrgId: string): Promise<Set<string>> {
  const orgs = await getOrganizationsRepository(organizations).list();
  const ids = new Set<string>([scopeOrgId]);
  const queue = [scopeOrgId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const o of orgs) {
      if (o.parentId === id && !ids.has(o.id)) { ids.add(o.id); queue.push(o.id); }
    }
  }
  return ids;
}

/** Build the scope context (org ids + in-scope node/domain ids) from a set of rows. */
function buildCtx(orgIds: Set<string>, nodes: any[], domains: any[]): ScopeCtx {
  return {
    orgIds,
    nodeIds: new Set(nodes.filter((n) => orgIds.has(n.orgId)).map((n) => n.id)),
    domainIds: new Set(domains.filter((d) => orgIds.has(d.orgId)).map((d) => d.id)),
  };
}

/**
 * GET /api/v1/backup/export?orgId=<scope>
 *
 * Export the caller's tenant (the scope org subtree) as a single JSON file.
 * `orgId` defaults to the caller's own org and is validated against their
 * accessible-org set by the auth middleware.
 */
router.get('/export', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  const scopeOrgId = (typeof req.query.orgId === 'string' && req.query.orgId) || req.user?.orgId;
  if (!scopeOrgId) { res.status(400).json({ success: false, error: 'No org scope: pass ?orgId or authenticate with an org' }); return; }

  const orgIds = await resolveScopeOrgIds(scopeOrgId);

  // Read every store once through its repository.
  const rowsByKey: Record<string, any[]> = {};
  for (const s of STORES) rowsByKey[s.key] = await s.makeRepo().list();
  const ctx = buildCtx(orgIds, rowsByKey.processNodes, rowsByKey.dataDomains);

  const exportData: Record<string, any[]> = {};
  for (const s of STORES) exportData[s.key] = rowsByKey[s.key].filter((r) => s.inScope(r, ctx));

  // Full-fidelity: bundle the bytes of every in-scope uploaded FILE attachment
  // (base64-embedded) so a cross-host restore rebuilds the files, not just the
  // rows that reference them. URL attachments carry no bytes. Rows whose file
  // is missing on disk are skipped (the row still restores; only its content
  // is gone). Per-file size is already capped at upload; total is logged.
  const files: Array<{ attachmentId: string; fileName: string; mimeType: string; size: number; base64: string }> = [];
  let fileBytes = 0;
  for (const a of exportData.attachments || []) {
    if (a?.type !== 'FILE' || !a.filePath) continue;
    try {
      if (!fs.existsSync(a.filePath)) continue;
      const buf = fs.readFileSync(a.filePath);
      files.push({ attachmentId: a.id, fileName: a.fileName || 'file', mimeType: a.mimeType || 'application/octet-stream', size: buf.length, base64: buf.toString('base64') });
      fileBytes += buf.length;
    } catch (err) {
      logger.warn({ attachmentId: a.id, err }, 'Backup export: attachment file unreadable, skipping bytes');
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '2.1',
    scope: { orgId: scopeOrgId, orgIds: [...orgIds] },
    data: exportData,
    files,
  };

  logger.info({ scopeOrgId, fileCount: files.length, fileBytes, counts: Object.fromEntries(Object.entries(exportData).map(([k, v]) => [k, v.length])) }, 'Exported backup');
  res.json(payload);
});

/**
 * POST /api/v1/backup/import
 *
 * Restore a backup into its scope. Replace-mode stores have their in-scope rows
 * deleted and re-created from the file; organizations and people are upserted.
 * The scope comes from the file (v2 records it; v1 is derived from the data),
 * and a non-super-admin may only import into orgs they can access.
 */
router.post('/import', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'), async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body;
  if (!body || !body.data || typeof body.data !== 'object') {
    res.status(400).json({ success: false, error: 'Invalid backup format: missing "data" field' });
    return;
  }
  const data: Record<string, any[]> = body.data;

  // Resolve the import scope. Prefer the recorded scope; otherwise derive it
  // from the org ids present in the file (their own ids + every referenced orgId).
  let orgIds: Set<string>;
  if (body.scope && Array.isArray(body.scope.orgIds) && body.scope.orgIds.length) {
    orgIds = new Set(body.scope.orgIds.map(String));
  } else {
    orgIds = new Set<string>();
    for (const o of data.organizations || []) if (o?.id) orgIds.add(String(o.id));
    for (const key of Object.keys(data)) for (const r of data[key] || []) if (r?.orgId) orgIds.add(String(r.orgId));
  }
  if (orgIds.size === 0) { res.status(400).json({ success: false, error: 'Backup has no resolvable org scope' }); return; }

  // Authorization: a non-super-admin can only import into orgs within their
  // visible scope. Super admins may restore any tenant.
  if (req.user?.role !== 'SUPER_ADMIN') {
    const visible = getVisibleOrgScope(req.user?.orgId) || new Set<string>();
    const outside = [...orgIds].filter((id) => !visible.has(id));
    if (outside.length) { res.status(403).json({ success: false, error: `Not authorized to import into org(s): ${outside.join(', ')}` }); return; }
  }

  // Context for the wipe is computed from EXISTING data (what's in scope now),
  // so replace-mode deletes exactly the rows the backup will re-create.
  const existingNodes = await getProcessNodesRepository(processNodes).list();
  const existingDomains = await getDataDomainsRepository(dataDomains).list();
  const ctx = buildCtx(orgIds, existingNodes, existingDomains);

  const imported: Record<string, number> = {};
  const deleted: Record<string, number> = {};

  // Wipe replace-mode stores first, children before parents (reverse order).
  for (const s of [...STORES].reverse()) {
    if (s.mode !== 'replace') continue;
    const repo = s.makeRepo();
    let removed = 0;
    for (const row of await repo.list()) {
      if (s.inScope(row, ctx)) { if (await repo.delete(row.id)) removed++; }
    }
    deleted[s.key] = removed;
  }

  // Load in create order (parents first) so FKs resolve.
  for (const s of STORES) {
    const incoming = Array.isArray(data[s.key]) ? [...data[s.key]] : [];
    if (s.sortForCreate) incoming.sort(s.sortForCreate);
    const repo = s.makeRepo();
    let count = 0;
    for (const row of incoming) {
      if (!row?.id) continue;
      try {
        const existing = await repo.get(row.id);
        if (existing) await repo.update(row.id, row);
        else await repo.create(row);
        count++;
      } catch (err) {
        logger.warn({ store: s.key, id: row.id, err }, 'Backup import: row skipped');
      }
    }
    imported[s.key] = count;
  }

  // Full-fidelity: restore bundled attachment bytes to disk and point each
  // imported attachment row at its new host path (the exported absolute path
  // belonged to the source host). Type/name/id are re-sanitized on write, so a
  // hostile backup can't drop a file outside the attachments dir or an
  // executable. Only attachments that were actually imported are touched.
  let filesRestored = 0;
  if (Array.isArray(body.files) && body.files.length) {
    const attachRepo = getAttachmentsRepository(attachments);
    for (const f of body.files) {
      if (!f?.attachmentId || typeof f.base64 !== 'string') continue;
      const existing = await attachRepo.get(String(f.attachmentId));
      if (!existing) continue; // its row wasn't in scope / didn't import
      try {
        const buf = Buffer.from(f.base64, 'base64');
        const absPath = restoreAttachmentFile(String(f.attachmentId), String(f.fileName || 'file'), buf);
        if (!absPath) { logger.warn({ attachmentId: f.attachmentId }, 'Backup import: attachment file rejected'); continue; }
        await attachRepo.update(existing.id, { filePath: absPath, fileSize: buf.length, ...(f.mimeType ? { mimeType: String(f.mimeType) } : {}) });
        filesRestored++;
      } catch (err) {
        logger.warn({ attachmentId: f.attachmentId, err }, 'Backup import: attachment restore failed');
      }
    }
  }

  logger.info({ scope: [...orgIds], imported, deleted, filesRestored }, 'Imported backup');
  res.json({ success: true, imported, deleted, filesRestored, scope: { orgIds: [...orgIds] } });
});

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

/**
 * POST /api/v1/backup/reset-all
 * Body: { confirm: "RESET" }
 *
 * Hard-reset every store on disk AND every registered in-memory
 * array. The closest thing Procela has to a factory reset — the
 * operator gets the same blank slate they'd see after deleting the
 * `.procela-data/` directory and restarting the server.
 *
 * Gates:
 *   - SUPER_ADMIN role only.
 *   - Typed confirmation phrase `RESET` to defend against
 *     muscle-memory triggers. Same defense as the GDPR forget action.
 *
 * Behaviour:
 *   - Every `.procela-data/*.json` file is truncated to `[]`.
 *   - Every registered in-memory store has its array spliced empty.
 *   - The audit log is bootstrapped fresh with a single
 *     ALL_DATA_RESET entry recording the actor + timestamp.
 *   - The frontend should drop the user's local session and route
 *     them back to /login so the onboarding wizard fires on the
 *     next sign-in.
 */
router.post(
  '/reset-all',
  authenticateToken,
  authorize('SUPER_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET') {
      res.status(400).json({
        success: false,
        error: 'Confirmation phrase did not match. Pass { confirm: "RESET" } to proceed.',
      });
      return;
    }

    // Capture actor before we nuke the audit log so the post-reset
    // entry knows who triggered the wipe.
    const actorId = req.user?.sub || null;
    const actorEmail = req.user?.email || null;
    const beforeCounts = { auditLogs: auditLogs.length };

    const summary = await wipeAllStores();

    // The audit log was just nuked too — record a single bootstrap
    // entry so the reset is auditable. auditService.log re-creates
    // the file and starts a fresh hash chain.
    auditService.log(
      DEV_ORG_ID,
      actorId,
      'System',
      'all',
      'ALL_DATA_RESET',
      beforeCounts,
      { actorEmail, ...summary },
    );

    logger.warn(
      { actorId, actorEmail, summary },
      'All data reset via /backup/reset-all',
    );

    res.json({
      success: true,
      data: {
        filesCleared: summary.filesCleared,
        storesReloaded: summary.storesReloaded.length,
        tablesTruncated: summary.tablesTruncated,
        message: 'Every store has been cleared. Your session will be invalidated; sign out and complete the onboarding wizard to set up a new organization.',
      },
    });
  },
);

export default router;
