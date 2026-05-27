import { Router, Request, Response } from 'express';
import { aiService } from '../services/ai.service';
import { ChatMessage } from '../types';
import logger from '../lib/logger';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { systems } from './systems';
import { mappings } from './mappings';
import { organizations } from './organizations';
import { people } from './people';
import { dataDomains } from './data-domains';

const router = Router();

// ── Org-data snapshot ──
// Builds a compact plain-text summary of one organization's Procela
// catalog so the AI assistant can answer grounded questions ("where
// are our gaps?", "what data supports X?") instead of guessing. Kept
// bounded — long catalogs are truncated so the system prompt stays a
// reasonable size.

const MAX_TREE_LINES = 150;
const MAX_ASSET_LINES = 100;
const MAX_MAPPING_LINES = 120;

export function buildOrgSnapshot(orgId: string): string | undefined {
  if (!orgId) return undefined;

  const org = organizations.find((o) => o.id === orgId);
  const nodes = processNodes.filter((n) => n.orgId === orgId || n.orgIds?.includes(orgId));
  const assets = dataAssets.filter((a) => a.orgId === orgId);
  const sys = systems.filter((s) => s.orgId === orgId);
  const maps = mappings.filter((m) => m.orgId === orgId);
  const ppl = people.filter((p) => p.orgIds?.includes(orgId));
  const domains = dataDomains.filter((d) => d.orgId === orgId);

  if (nodes.length === 0 && assets.length === 0 && sys.length === 0) return undefined;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const personById = new Map(ppl.map((p) => [p.id, p]));
  const systemById = new Map(sys.map((s) => [s.id, s]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const ownerName = (id: string | null | undefined) =>
    id ? (personById.get(id)?.name ?? 'unknown') : null;

  const lines: string[] = [];

  // Process catalog as an indented outline.
  const childrenOf = (pid: string | null) =>
    nodes.filter((n) => n.parentId === pid).sort((a, b) => a.orderIndex - b.orderIndex);
  lines.push('## PROCESS CATALOG');
  let treeLines = 0;
  const walk = (pid: string | null, depth: number) => {
    for (const n of childrenOf(pid)) {
      if (treeLines >= MAX_TREE_LINES) return;
      const indent = '  '.repeat(depth);
      const owner = ownerName(n.ownerId);
      const bits = [
        `${n.level.replace('_', ' ').toLowerCase()}`,
        n.domain === 'GOVERNANCE' ? '[governance]' : null,
        n.status ? `status:${n.status.toLowerCase()}` : null,
        owner ? `owner:${owner}` : 'OWNERLESS',
        n.responsibleRole ? `role:${n.responsibleRole}` : null,
      ].filter(Boolean);
      lines.push(`${indent}- ${n.name} (${bits.join(', ')})`);
      treeLines++;
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  if (treeLines >= MAX_TREE_LINES) lines.push('  …(catalog truncated)');
  if (treeLines === 0) lines.push('  (no processes defined)');

  // Systems.
  lines.push('', '## SYSTEMS');
  if (sys.length === 0) lines.push('  (none defined)');
  for (const s of sys) lines.push(`  - ${s.name}${s.systemType ? ` (${s.systemType})` : ''}`);

  // Data assets with tier + health.
  lines.push('', '## DATA ASSETS');
  if (assets.length === 0) lines.push('  (none defined)');
  assets.slice(0, MAX_ASSET_LINES).forEach((a) => {
    const sysName = a.systemId ? systemById.get(a.systemId)?.name : null;
    lines.push(
      `  - ${a.name} (tier:${a.governanceTier?.toLowerCase() ?? 'bronze'}, `
        + `health:${a.healthScore ?? 0}%${sysName ? `, system:${sysName}` : ''})`,
    );
  });
  if (assets.length > MAX_ASSET_LINES) lines.push(`  …(${assets.length - MAX_ASSET_LINES} more)`);

  // Process ↔ data mappings.
  // Mapping rows can target a Data Asset, a Policy, or an
  // Attachment; the chat-context summary only describes the
  // asset-shaped ones because they're the most useful for "what
  // data does this activity use" questions. Policy and attachment
  // mappings are skipped here.
  const assetMaps = maps.filter((m) => !!m.dataAssetId);
  lines.push('', '## PROCESS COVERAGE (activity → data asset links)');
  if (assetMaps.length === 0) lines.push('  (no data mapped to any activity yet)');
  assetMaps.slice(0, MAX_MAPPING_LINES).forEach((m) => {
    const act = nodeById.get(m.processStepId)?.name ?? 'unknown activity';
    const asset = assetById.get(m.dataAssetId!)?.name ?? 'unknown asset';
    lines.push(`  - "${act}" ${m.linkType ?? 'uses'} "${asset}"`);
  });
  if (assetMaps.length > MAX_MAPPING_LINES) lines.push(`  …(${assetMaps.length - MAX_MAPPING_LINES} more)`);

  // Gaps — the things the user most often asks about.
  const mappedActivityIds = new Set(maps.map((m) => m.processStepId));
  const activities = nodes.filter((n) => n.level === 'ACTIVITY');
  const unmappedActivities = activities.filter((n) => !mappedActivityIds.has(n.id));
  const ownerlessProcesses = nodes.filter(
    (n) => ['VALUE_STREAM', 'PROCESS'].includes(n.level) && !n.ownerId,
  );
  const linkedAssetIds = new Set(assetMaps.map((m) => m.dataAssetId!));
  const ungovernedAssets = assets.filter(
    (a) => a.governanceTier === 'BRONZE' && linkedAssetIds.has(a.id),
  );
  const lowHealthAssets = assets.filter((a) => (a.healthScore ?? 0) < 80);
  const ownerlessDomains = domains.filter((d) => !d.ownerId);
  lines.push('', '## KNOWN GAPS');
  lines.push(`  - Activities with no data mapped (${unmappedActivities.length}): `
    + (unmappedActivities.slice(0, 25).map((n) => n.name).join('; ') || 'none'));
  lines.push(`  - Value streams / processes with no owner (${ownerlessProcesses.length}): `
    + (ownerlessProcesses.slice(0, 25).map((n) => n.name).join('; ') || 'none'));
  lines.push(`  - Mapped data assets still at Bronze/uncertified tier (${ungovernedAssets.length}): `
    + (ungovernedAssets.slice(0, 25).map((a) => a.name).join('; ') || 'none'));
  lines.push(`  - Data assets below 80% health (${lowHealthAssets.length}): `
    + (lowHealthAssets.slice(0, 25).map((a) => `${a.name} ${a.healthScore ?? 0}%`).join('; ') || 'none'));
  lines.push(`  - Data domains with no owner (${ownerlessDomains.length}): `
    + (ownerlessDomains.slice(0, 25).map((d) => d.name).join('; ') || 'none'));

  lines.push('', `## PEOPLE\n  ${ppl.length} people in this organization.`);

  const header = `Snapshot of "${org?.name ?? 'this organization'}"`
    + ` (industry: ${org?.industry || 'unspecified'}).`;
  return `${header}\n\n${lines.join('\n')}`;
}

/**
 * POST /api/v1/chat
 * Multi-turn conversational chat grounded in the organization's data.
 *
 * Body: { messages: [{role, content}...], orgContext?: { orgId, orgName, industry } }
 * Returns: { success: true, data: { reply: string } }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { messages, orgContext } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array of {role, content} objects.',
      });
      return;
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        res.status(400).json({
          success: false,
          error: 'Each message must have a valid role ("user" or "assistant") and content.',
        });
        return;
      }
    }

    const chatMessages: ChatMessage[] = messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    }));

    const orgId: string = orgContext?.orgId ?? '';
    const org = orgId ? organizations.find((o) => o.id === orgId) : undefined;
    const context = {
      orgId,
      orgName: org?.name ?? orgContext?.orgName ?? 'Unknown',
      industry: org?.industry || orgContext?.industry || 'General',
    };

    const snapshot = buildOrgSnapshot(orgId);
    const reply = await aiService.chat(chatMessages, context, snapshot);

    res.json({ success: true, data: { reply } });
  } catch (err) {
    logger.error({ err }, 'Chat request failed');
    res.status(500).json({
      success: false,
      error: 'Failed to process chat request. Please try again.',
    });
  }
});

export default router;
