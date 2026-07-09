import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { parseCsv } from '../lib/csv';
import { organizations } from './organizations';
import { people } from './people';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Agents — non-human actors (AI models, service accounts, pipelines, bots)
// that can be assigned to organizations much like people. Kept intentionally
// narrower than StoredPerson: no DAMA roles / governance-group memberships
// (those are human-only in this prototype). A human `ownerPersonId` points
// at the person responsible for the agent's behaviour.
// ──────────────────────────────────────────────────────────────────────────

const AGENT_TYPES = ['AI', 'SERVICE_ACCOUNT', 'PIPELINE', 'BOT', 'OTHER'] as const;
const AGENT_STATUSES = ['ACTIVE', 'PAUSED', 'RETIRED'] as const;

export interface StoredAgent {
  id: string;
  orgIds: string[];               // which orgs the agent belongs to
  name: string;
  agentType: typeof AGENT_TYPES[number];
  description: string;
  provider: string;               // e.g. "Anthropic", "Airflow", "Custom"
  status: typeof AGENT_STATUSES[number];
  ownerPersonId: string;          // person responsible (blank = unowned)
  skillIds: string[];             // skills this agent possesses
  // Operating brief used when the agent actually performs a governance
  // activity — becomes the system prompt for the real Claude call. Blank
  // means "use general data-governance best practice".
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export const agents: StoredAgent[] = loadStore<StoredAgent>('agents');
registerStore('agents', agents);

// Backfill skillIds on legacy records that lack the field
{
  let backfilled = 0;
  for (const a of agents) {
    if (!Array.isArray(a.skillIds)) {
      (a as any).skillIds = [];
      backfilled++;
    }
    if (typeof a.instructions !== 'string') {
      (a as any).instructions = '';
      backfilled++;
    }
  }
  if (backfilled > 0) {
    saveStore('agents', agents);
    logger.info({ backfilled }, 'Backfilled skillIds on existing agents');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Responsible-person invariant
//
//   An agent can only carry status = ACTIVE if it has a valid, non-
//   deactivated ownerPersonId. If the owner is removed, cleared, or the
//   underlying person is deleted / deactivated, the agent auto-transitions
//   to PAUSED and a governance issue is opened so the work re-surfaces.
//
//   Two edges enforce this:
//     1. Direct writes to the agent (POST /agents, PUT /agents/:id) —
//        checked below with hasValidOwner().
//     2. Cascades from person-level changes — DELETE /people/:id and
//        POST /people/:id/deactivate call pauseAgentsForMissingOwner()
//        to sweep every agent whose owner just went away.
// ──────────────────────────────────────────────────────────────────────────

function hasValidOwner(ownerPersonId: string | undefined): boolean {
  if (!ownerPersonId) return false;
  const person = people.find((p) => p.id === ownerPersonId);
  if (!person) return false;
  if ((person as any).active === false) return false;
  return true;
}

const OWNERLESS_MSG =
  'An agent cannot be Active without a responsible person. Assign a responsible person, or set the status to Paused.';

export interface AgentPauseResult {
  agentId: string;
  agentName: string;
  issueId: string | null;
}

/**
 * Cascade helper — pauses every ACTIVE agent whose responsible person
 * is the given personId, opens a governance issue for each, and returns
 * a summary the caller can surface (delete response, toast, etc).
 *
 * Called by:
 *   - people DELETE / deactivate handlers
 *   - the agent PUT handler when a user clears ownerPersonId on an
 *     already-active agent (auto-pause with confirmation upstream)
 *
 * Idempotent: an agent that's already PAUSED / RETIRED is skipped.
 * If clearOwnerReference is true, the agent's ownerPersonId is nulled
 * out too (used by the person-delete cascade — the reference would be
 * dangling otherwise).
 */
export function pauseAgentsForMissingOwner(
  personId: string,
  reason: string,
  opts: { clearOwnerReference?: boolean } = {},
): AgentPauseResult[] {
  const paused: AgentPauseResult[] = [];
  const now = new Date().toISOString();
  const affected = agents.filter(
    (a) => a.ownerPersonId === personId && a.status === 'ACTIVE',
  );
  if (affected.length === 0) return paused;

  // Lazy-require the issue + notification wiring to avoid the route
  // import graph loading in circular fashion at boot.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { openAgentOwnershipIssue } = require('./governance-issues') as typeof import('./governance-issues');

  for (const agent of affected) {
    agent.status = 'PAUSED';
    if (opts.clearOwnerReference) agent.ownerPersonId = '';
    agent.updatedAt = now;
    let issueId: string | null = null;
    try {
      issueId = openAgentOwnershipIssue({
        agent,
        reason,
      });
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, 'Failed to open ownership issue on agent auto-pause');
    }
    paused.push({ agentId: agent.id, agentName: agent.name, issueId });
    logger.info({ agentId: agent.id, personId, reason }, 'Agent auto-paused for missing owner');
  }
  saveStore('agents', agents);
  return paused;
}

const router = Router();

/** DELETE /api/v1/agents/all — delete all agents */
router.delete('/all', (_req: Request, res: Response) => {
  const count = agents.length;
  agents.splice(0, agents.length);
  saveStore('agents', agents);
  logger.info({ count }, 'Deleted all agents');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/agents — list, optionally filtered by ?orgId= */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? agents.filter((a) => a.orgIds.includes(orgId as string)) : agents;
  res.json({
    success: true,
    data: filtered,
    agentTypes: AGENT_TYPES,
    agentStatuses: AGENT_STATUSES,
  });
});

/** GET /api/v1/agents/:id */
router.get('/:id', (req: Request, res: Response) => {
  const agent = agents.find((a) => a.id === req.params.id);
  if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
  res.json({ success: true, data: agent });
});

/** POST /api/v1/agents */
router.post('/', (req: Request, res: Response) => {
  const { orgIds, name, agentType, description, provider, status, ownerPersonId, skillIds, instructions } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const assignedOrgIds: string[] = Array.isArray(orgIds) ? orgIds : [];
  if (assignedOrgIds.length === 0) {
    res.status(400).json({ success: false, error: 'At least one organization is required' });
    return;
  }
  for (const oid of assignedOrgIds) {
    if (!organizations.find((o) => o.id === oid)) {
      res.status(400).json({ success: false, error: `Organization "${oid}" not found.` });
      return;
    }
  }
  const resolvedType = AGENT_TYPES.includes(agentType) ? agentType : 'OTHER';
  // Default is PAUSED, not ACTIVE. An agent should only go active on an
  // explicit request from the caller, and only when a responsible person
  // is already wired up. This lines up with the responsible-person
  // invariant and stops CSV imports from bulk-activating everything.
  const requestedStatus = AGENT_STATUSES.includes(status) ? status : 'PAUSED';
  // Invariant: reject explicit ACTIVE without a valid responsible person.
  if (requestedStatus === 'ACTIVE' && !hasValidOwner(ownerPersonId)) {
    res.status(400).json({ success: false, error: OWNERLESS_MSG });
    return;
  }
  const resolvedStatus = requestedStatus;
  const now = new Date().toISOString();
  const agent: StoredAgent = {
    id: uuid(),
    orgIds: assignedOrgIds,
    name,
    agentType: resolvedType,
    description: description || '',
    provider: provider || '',
    status: resolvedStatus,
    ownerPersonId: ownerPersonId || '',
    skillIds: Array.isArray(skillIds) ? skillIds : [],
    instructions: typeof instructions === 'string' ? instructions : '',
    createdAt: now, updatedAt: now,
  };
  agents.push(agent);
  saveStore('agents', agents);
  res.status(201).json({ success: true, data: agent });
});

/** PUT /api/v1/agents/:id */
router.put('/:id', (req: Request, res: Response) => {
  const agent = agents.find((a) => a.id === req.params.id);
  if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
  const { orgIds, name, agentType, description, provider, status, ownerPersonId, skillIds, instructions } = req.body;

  // Case 1: caller explicitly asked for ACTIVE. Reject if the resulting
  // owner would be invalid — a direct API caller shouldn't get a silent
  // downgrade to PAUSED when they meant to activate. The UI blocks this
  // client-side too so this branch only fires on API misuse.
  const explicitlyActivating = status === 'ACTIVE';
  const nextOwner = ownerPersonId !== undefined ? ownerPersonId : agent.ownerPersonId;
  if (explicitlyActivating && !hasValidOwner(nextOwner)) {
    res.status(400).json({ success: false, error: OWNERLESS_MSG });
    return;
  }

  if (name !== undefined) agent.name = name;
  if (description !== undefined) agent.description = description;
  if (provider !== undefined) agent.provider = provider;
  if (ownerPersonId !== undefined) agent.ownerPersonId = ownerPersonId;
  if (skillIds !== undefined) agent.skillIds = Array.isArray(skillIds) ? skillIds : [];
  if (instructions !== undefined) agent.instructions = typeof instructions === 'string' ? instructions : '';
  if (agentType !== undefined && AGENT_TYPES.includes(agentType)) agent.agentType = agentType;
  if (status !== undefined && AGENT_STATUSES.includes(status)) agent.status = status;
  if (orgIds !== undefined) {
    if (!Array.isArray(orgIds) || orgIds.length === 0) {
      res.status(400).json({ success: false, error: 'orgIds must be a non-empty array' });
      return;
    }
    for (const oid of orgIds) {
      if (!organizations.find((o) => o.id === oid)) {
        res.status(400).json({ success: false, error: `Organization "${oid}" not found.` });
        return;
      }
    }
    agent.orgIds = orgIds;
  }

  // Case 2: the write leaves the agent ACTIVE with a missing/invalid
  // owner. The UI shows a confirmation dialog before this reaches us;
  // here we do the safe thing — auto-pause and open a governance issue
  // — and tell the caller what happened via `cascade`.
  let cascade: { autoPaused: true; issueId: string | null } | null = null;
  if (agent.status === 'ACTIVE' && !hasValidOwner(agent.ownerPersonId)) {
    agent.status = 'PAUSED';
    let issueId: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { openAgentOwnershipIssue } = require('./governance-issues') as typeof import('./governance-issues');
      issueId = openAgentOwnershipIssue({
        agent,
        reason: 'Responsible person cleared while agent was active',
      });
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, 'Failed to open ownership issue on agent auto-pause');
    }
    cascade = { autoPaused: true, issueId };
    logger.info({ agentId: agent.id }, 'Agent auto-paused: owner cleared while active');
  }

  agent.updatedAt = new Date().toISOString();
  saveStore('agents', agents);
  res.json({ success: true, data: agent, cascade });
});

/** DELETE /api/v1/agents/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = agents.findIndex((a) => a.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
  agents.splice(idx, 1);
  saveStore('agents', agents);
  res.status(204).send();
});

/**
 * POST /api/v1/agents/import
 *
 * JSON: { orgId, agents: [{ name, agentType?, provider?, description? }, ...] }
 * CSV:  { orgId, csv: "Name,Type,Provider,Description\n..." }
 */
router.post('/import', (req: Request, res: Response) => {
  try {
    const { orgId, agents: agentList, csv } = req.body;
    if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required for import' }); return; }
    const org = organizations.find((o) => o.id === orgId);
    if (!org) { res.status(400).json({ success: false, error: 'Organization not found' }); return; }

    let rows: Array<{ name: string; agentType?: string; provider?: string; description?: string }> = [];
    if (csv && typeof csv === 'string') {
      const parsed = parseCsv(csv);
      if (parsed.length === 0) { res.status(400).json({ success: false, error: 'CSV appears to be empty' }); return; }
      const header = parsed[0].map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const typeIdx = header.indexOf('type');
      const providerIdx = header.indexOf('provider');
      const descIdx = header.indexOf('description');
      if (nameIdx === -1) { res.status(400).json({ success: false, error: 'CSV must have a "Name" column' }); return; }
      for (let i = 1; i < parsed.length; i++) {
        const cols = parsed[i].map((c) => c.trim());
        if (!cols[nameIdx]) continue;
        rows.push({
          name: cols[nameIdx],
          agentType: typeIdx >= 0 ? cols[typeIdx] : undefined,
          provider: providerIdx >= 0 ? cols[providerIdx] : undefined,
          description: descIdx >= 0 ? cols[descIdx] : undefined,
        });
      }
    } else if (Array.isArray(agentList)) {
      rows = agentList;
    } else {
      res.status(400).json({ success: false, error: 'Provide "agents" array or "csv" string' });
      return;
    }

    if (rows.length === 0) { res.status(400).json({ success: false, error: 'No agents to import' }); return; }

    const now = new Date().toISOString();
    const created: StoredAgent[] = [];
    for (const row of rows) {
      if (!row.name) continue;
      const type = row.agentType && AGENT_TYPES.includes(row.agentType.toUpperCase() as any)
        ? row.agentType.toUpperCase() as StoredAgent['agentType']
        : 'OTHER';
      const agent: StoredAgent = {
        id: uuid(),
        orgIds: [orgId],
        name: row.name,
        agentType: type,
        description: row.description || '',
        provider: row.provider || '',
        // Imported without an owner → PAUSED. A steward has to review
        // the row, wire up a responsible person, then activate.
        status: 'PAUSED',
        ownerPersonId: '',
        skillIds: [],
        instructions: '',
        createdAt: now, updatedAt: now,
      };
      agents.push(agent);
      created.push(agent);
    }
    saveStore('agents', agents);
    logger.info({ created: created.length, orgId }, 'Imported agents');
    res.status(201).json({ success: true, data: created, message: `Imported ${created.length} agents` });
  } catch (err) {
    logger.error({ err }, 'Agent import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
