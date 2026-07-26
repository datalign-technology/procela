import { Router, Request, Response } from 'express';
import { renderMarkdownToPdf } from '../services/markdown-pdf';
import { auditService } from '../services/audit.service';
import { organizations } from './organizations';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { systems } from './systems';
import { mappings } from './mappings';
import { people } from './people';
import { getVisibleOrgScope, getCachedOrgList } from '../lib/org-scope';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { getPeopleRepository } from '../db/people.repo';
import logger from '../lib/logger';

// Repositories — read Postgres when DATABASE_URL is set, else the JSON arrays.
const processNodesRepo = getProcessNodesRepository(processNodes);
const dataAssetsRepo = getDataAssetsRepository(dataAssets);
const systemsRepo = getSystemsRepository(systems);
const mappingsRepo = getMappingsRepository(mappings);
const peopleRepo = getPeopleRepository(people);

// ──────────────────────────────────────────────────────────────────────────
// Exports — server-rendered, downloadable artefacts for compliance and
// executive-review use. The frontend pages render the same data
// interactively; this surface gives you the same view in a format you
// can attach to an audit ticket or email to a CFO.
//
// Today: the executive summary (PDF + raw markdown). Designed to grow
// into the home for any "give me a stable artefact of state X"
// request — domain scorecard, governance audit pack, lineage walkthrough.
//
// Reports render to Markdown first then hand off to
// services/markdown-pdf for layout, so the same source can later flow
// into an email digest without duplicating the data-gathering code.
// ──────────────────────────────────────────────────────────────────────────

const router = Router();

interface ReportContext {
  orgId: string | null;
  orgName: string;
  /** Org ids visible from this scope (self + ancestors + descendants).
   *  All catalog counts roll up to this set so a company-level export
   *  matches what the company-level dashboard shows. */
  scope: Set<string> | null;
}

function buildContext(orgIdQuery: string | undefined): ReportContext {
  const orgId = orgIdQuery || null;
  const scope = orgId ? getVisibleOrgScope(orgId) : null;
  let orgName = 'All Organizations';
  if (orgId) {
    orgName = getCachedOrgList().find((o) => o.id === orgId)?.name || 'Organization';
  }
  return { orgId, orgName, scope };
}

function inScope<T extends { orgId?: string; orgIds?: string[] }>(scope: Set<string> | null, row: T): boolean {
  if (!scope) return true;
  if (row.orgId && scope.has(row.orgId)) return true;
  if (row.orgIds && row.orgIds.some((id) => scope.has(id))) return true;
  return false;
}

/** Build the markdown body of the executive report. Kept pure so it
 *  can be reused for an email digest, an in-app rich-text preview,
 *  or a snapshot fixture without re-deriving the numbers. */
export async function buildExecutiveReportMarkdown(ctx: ReportContext): Promise<string> {
  const [allNodes, allAssets, allSystems, allMappings, allPeople] = await Promise.all([
    processNodesRepo.list(), dataAssetsRepo.list(), systemsRepo.list(), mappingsRepo.list(), peopleRepo.list(),
  ]);
  const visibleNodes = allNodes.filter((n) => inScope(ctx.scope, n));
  const visibleAssets = allAssets.filter((a) => inScope(ctx.scope, a));
  const visibleSystems = allSystems.filter((s) => inScope(ctx.scope, s));
  const activitiesAll = visibleNodes.filter((n) => n.level === 'ACTIVITY');
  const mappedActivityIds = new Set(allMappings.map((m) => m.processStepId));
  const mappedAssetIds = new Set(allMappings.filter((m) => m.dataAssetId).map((m) => m.dataAssetId));
  const orphanAssets = visibleAssets.filter((a) => !mappedAssetIds.has(a.id));
  const tierCounts = visibleAssets.reduce((acc, a) => {
    acc[a.governanceTier] = (acc[a.governanceTier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const ownerless = visibleNodes
    .filter((n) => n.level === 'VALUE_STREAM' || n.level === 'PROCESS' || n.level === 'ACTIVITY')
    .filter((n) => !n.ownerId).length;

  const valueStreams = visibleNodes.filter((n) => n.level === 'VALUE_STREAM').length;
  const processes   = visibleNodes.filter((n) => n.level === 'PROCESS').length;
  const activities  = activitiesAll.length;
  const mappedActivityCount = activitiesAll.filter((a) => mappedActivityIds.has(a.id)).length;
  const unmappedActivities = activities - mappedActivityCount;

  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`# Executive Report`);
  lines.push('');
  lines.push(`**Organization:** ${ctx.orgName}`);
  lines.push(`**Generated:** ${today}`);
  lines.push('');
  lines.push(`## Catalog at a glance`);
  lines.push('');
  lines.push(`- Value streams: **${valueStreams}**`);
  lines.push(`- Processes: **${processes}**`);
  lines.push(`- Activities: **${activities}**`);
  lines.push(`- Systems: **${visibleSystems.length}**`);
  lines.push(`- Data assets: **${visibleAssets.length}**`);
  lines.push(`- Mappings: **${allMappings.length}**`);
  lines.push('');

  lines.push(`## Coverage signals`);
  lines.push('');
  lines.push(`- Activities mapped to at least one data asset: **${mappedActivityCount} of ${activities}**`);
  lines.push(`- Activities with no data mapping yet: **${unmappedActivities}**`);
  lines.push(`- Catalog nodes without an assigned owner (VS / PROCESS / ACTIVITY): **${ownerless}**`);
  lines.push(`- Orphan data assets (no process references them): **${orphanAssets.length}**`);
  lines.push('');

  lines.push(`## Governance tier mix`);
  lines.push('');
  lines.push(`- Gold: **${tierCounts.GOLD || 0}**`);
  lines.push(`- Silver: **${tierCounts.SILVER || 0}**`);
  lines.push(`- Bronze: **${tierCounts.BRONZE || 0}**`);
  lines.push('');

  if (orphanAssets.length > 0) {
    lines.push(`## Top orphan assets`);
    lines.push('');
    lines.push(`These data assets exist in the catalog but no process step references them. Each row is a candidate to either retire or map to a step that uses it.`);
    lines.push('');
    for (const a of orphanAssets.slice(0, 15)) {
      const sysName = a.systemId ? visibleSystems.find((s) => s.id === a.systemId)?.name || '—' : '—';
      lines.push(`- **${a.name}** — system: ${sysName} — tier: ${a.governanceTier}`);
    }
    if (orphanAssets.length > 15) lines.push(`- … and ${orphanAssets.length - 15} more.`);
    lines.push('');
  }

  // Recent activity from the audit log gives reviewers a "what's been
  // changing" signal without diving into the full log.
  const recent = (await auditService.getAll(ctx.orgId || undefined))
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 10);
  if (recent.length > 0) {
    lines.push(`## Recent activity`);
    lines.push('');
    for (const e of recent) {
      const who = e.userId ? allPeople.find((p) => p.id === e.userId)?.name || e.userId : 'system';
      lines.push(`- ${e.timestamp.slice(0, 16).replace('T', ' ')} · **${who}** · ${e.action} ${e.entityType}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** GET /api/v1/exports/executive.pdf — branded PDF of the executive
 *  summary. Replaces the frontend's window.print() escape hatch with a
 *  real artefact you can attach to an email or audit ticket. */
router.get('/executive.pdf', async (req: Request, res: Response) => {
  try {
    const ctx = buildContext(req.query.orgId as string | undefined);
    const markdown = await buildExecutiveReportMarkdown(ctx);
    const buffer = await renderMarkdownToPdf(markdown, {
      title: 'Procela Executive Report',
      subtitle: ctx.orgName,
      footer: `Procela Executive Report  ·  ${ctx.orgName}  ·  ${new Date().toISOString().slice(0, 10)}`,
    });
    const filename = `procela-executive-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to render executive PDF');
    res.status(500).json({ success: false, error: err?.message || 'PDF generation failed.' });
  }
});

/** GET /api/v1/exports/executive.md — same report, as raw markdown.
 *  Useful for snapshot testing and for piping into other tools (Slack,
 *  email, copy-paste into a doc). Same scope semantics. */
router.get('/executive.md', async (req: Request, res: Response) => {
  const ctx = buildContext(req.query.orgId as string | undefined);
  const markdown = await buildExecutiveReportMarkdown(ctx);
  res.type('text/markdown; charset=utf-8');
  res.send(markdown);
});

export default router;
