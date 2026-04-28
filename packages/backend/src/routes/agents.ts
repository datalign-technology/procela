import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { organizations } from './organizations';
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
  createdAt: string;
  updatedAt: string;
}

export const agents: StoredAgent[] = loadStore<StoredAgent>('agents');

// Backfill skillIds on legacy records that lack the field
{
  let backfilled = 0;
  for (const a of agents) {
    if (!Array.isArray(a.skillIds)) {
      (a as any).skillIds = [];
      backfilled++;
    }
  }
  if (backfilled > 0) {
    saveStore('agents', agents);
    logger.info({ backfilled }, 'Backfilled skillIds on existing agents');
  }
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
  const { orgIds, name, agentType, description, provider, status, ownerPersonId, skillIds } = req.body;
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
  const resolvedStatus = AGENT_STATUSES.includes(status) ? status : 'ACTIVE';
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
  const { orgIds, name, agentType, description, provider, status, ownerPersonId, skillIds } = req.body;
  if (name !== undefined) agent.name = name;
  if (description !== undefined) agent.description = description;
  if (provider !== undefined) agent.provider = provider;
  if (ownerPersonId !== undefined) agent.ownerPersonId = ownerPersonId;
  if (skillIds !== undefined) agent.skillIds = Array.isArray(skillIds) ? skillIds : [];
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
  agent.updatedAt = new Date().toISOString();
  saveStore('agents', agents);
  res.json({ success: true, data: agent });
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
      const lines = csv.trim().split('\n');
      const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const typeIdx = header.indexOf('type');
      const providerIdx = header.indexOf('provider');
      const descIdx = header.indexOf('description');
      if (nameIdx === -1) { res.status(400).json({ success: false, error: 'CSV must have a "Name" column' }); return; }
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
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
        status: 'ACTIVE',
        ownerPersonId: '',
        skillIds: [],
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
