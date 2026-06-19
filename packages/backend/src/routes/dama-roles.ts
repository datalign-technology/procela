import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { agents } from './agents';
import { skills } from './skills';
import { governanceTasks } from './governance-tasks';
import { dataDomains } from './data-domains';

export const DAMA_ROLE_TYPES = [
  // Executive/Strategic
  'CDO',                        // Chief Data Officer
  'DATA_GOVERNANCE_LEAD',       // Data Governance Program Manager
  // Business
  'DATA_OWNER',                 // Business executive accountable for data domain
  'BUSINESS_DATA_STEWARD',      // Defines business rules, data definitions, quality requirements
  'DATA_QUALITY_ANALYST',       // Monitors quality metrics, identifies issues, reports
  // Technical
  'TECHNICAL_DATA_STEWARD',     // Implements business rules technically, manages schemas
  'DATA_CUSTODIAN',             // Infrastructure — storage, security, backup, access control
  'DATA_ARCHITECT',             // Designs data models, integration patterns, standards
  'DATA_ENGINEER',              // Builds pipelines, ETL, data movement
  'DATABASE_ADMINISTRATOR',     // Manages database instances, performance, maintenance
] as const;

// Roles that may be scoped to a specific data domain (in addition to
// being scoped org-wide). These are the DAMA roles whose
// accountability is meaningful per-domain — Data Owner for a single
// domain, a Steward focused on one domain, etc. Org-only roles
// (CDO, Governance Lead, generalist quality analyst, DBA) stay ORG.
const DOMAIN_SCOPABLE_ROLES = new Set<string>([
  'DATA_OWNER',
  'BUSINESS_DATA_STEWARD',
  'TECHNICAL_DATA_STEWARD',
  'DATA_ARCHITECT',
  'DATA_CUSTODIAN',
]);

// Roles where there can be only one holder per scope. Owner-shaped
// roles are single (one Data Owner per domain, one CDO per org);
// steward / custodian / architect roles allow multiple holders.
const SINGLE_HOLDER_ROLES = new Set<string>([
  'CDO',
  'DATA_GOVERNANCE_LEAD',
  'DATA_OWNER',
]);

export interface StoredDamaRole {
  id: string;
  personId: string | null;
  agentId: string | null;
  agentName: string | null;
  roleType: string;                  // one of DAMA_ROLE_TYPES
  scopeType: 'ORG' | 'DOMAIN';       // ORG = enterprise-wide; DOMAIN = scoped to a single data domain
  scopeId: string;                   // orgId when scopeType=ORG; dataDomain.id when scopeType=DOMAIN
  since: string;
  createdAt: string;
}

export const damaRoles: StoredDamaRole[] = loadStore<StoredDamaRole>('damaRoles');
registerStore('damaRoles', damaRoles);

// Backfill agentId/agentName on legacy records
{
  let backfilled = 0;
  for (const r of damaRoles) {
    if (r.agentId === undefined) { (r as any).agentId = null; backfilled++; }
    if (r.agentName === undefined) { (r as any).agentName = null; backfilled++; }
    // Ensure personId is null (not undefined) when absent
    if (r.personId === undefined) { (r as any).personId = null; }
  }
  if (backfilled > 0) {
    saveStore('damaRoles', damaRoles);
    logger.info({ backfilled }, 'Backfilled agentId/agentName on existing DAMA role assignments');
  }
}

// Resolve the orgId that a role assignment belongs to. ORG-scoped
// assignments store the orgId directly in scopeId; DOMAIN-scoped
// assignments need a lookup through the parent domain. Used by the
// list / summary / per-person handlers so an `?orgId=` filter reaches
// both kinds.
function roleOrgId(r: StoredDamaRole): string | null {
  if (r.scopeType === 'ORG') return r.scopeId;
  if (r.scopeType === 'DOMAIN') {
    const d = dataDomains.find((dd) => dd.id === r.scopeId);
    return d ? d.orgId : null;
  }
  return null;
}

const router = Router();

/** DELETE /api/v1/dama-roles/all — delete all DAMA role assignments */
router.delete('/all', (_req: Request, res: Response) => {
  const count = damaRoles.length;
  damaRoles.splice(0, damaRoles.length);
  saveStore('damaRoles', damaRoles);
  auditService.log('system', null, 'DamaRole', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all DAMA role assignments');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/dama-roles — list all (support ?orgId=, ?personId=, ?agentId= filters). Enrich with person/agent name. */
router.get('/', (req: Request, res: Response) => {
  const { orgId, personId, agentId } = req.query;
  let filtered = [...damaRoles];

  if (orgId) {
    // Include both ORG-scoped assignments for this org AND DOMAIN-
    // scoped assignments whose domain belongs to this org, so the
    // Governance Roles page sees both kinds when filtering by org.
    filtered = filtered.filter((r) => roleOrgId(r) === orgId);
  }
  if (personId) {
    filtered = filtered.filter((r) => r.personId === personId);
  }
  if (agentId) {
    filtered = filtered.filter((r) => r.agentId === agentId);
  }

  const enriched = filtered.map((r) => {
    const person = r.personId ? people.find((p) => p.id === r.personId) : null;
    const agent = r.agentId ? agents.find((a) => a.id === r.agentId) : null;
    return {
      ...r,
      personName: person?.name || (r.personId ? 'Unknown' : null),
      agentName: agent?.name || r.agentName || null,
    };
  });

  res.json({ success: true, data: enriched, roleTypes: DAMA_ROLE_TYPES });
});

/** POST /api/v1/dama-roles — assign a DAMA role (accepts personId OR agentId, not both) */
router.post('/', (req: Request, res: Response) => {
  const { personId, agentId, roleType, scopeType, scopeId } = req.body;

  if (!personId && !agentId) { res.status(400).json({ success: false, error: 'Either personId or agentId is required' }); return; }
  if (personId && agentId) { res.status(400).json({ success: false, error: 'Provide either personId or agentId, not both' }); return; }
  if (!roleType || !(DAMA_ROLE_TYPES as readonly string[]).includes(roleType)) {
    res.status(400).json({ success: false, error: `Invalid roleType. Must be one of: ${DAMA_ROLE_TYPES.join(', ')}` });
    return;
  }
  if (!scopeType || (scopeType !== 'ORG' && scopeType !== 'DOMAIN')) {
    res.status(400).json({ success: false, error: 'scopeType must be ORG or DOMAIN.' });
    return;
  }
  if (!scopeId) { res.status(400).json({ success: false, error: 'scopeId is required' }); return; }

  // Domain-scoped assignments are only allowed for roles that have a
  // per-domain meaning. Reject DOMAIN for org-only roles (CDO,
  // Governance Lead, etc.) so the catalog stays coherent.
  if (scopeType === 'DOMAIN') {
    if (!DOMAIN_SCOPABLE_ROLES.has(roleType)) {
      res.status(400).json({
        success: false,
        error: `Role ${roleType} cannot be scoped to a data domain. Assign it at the organization level.`,
      });
      return;
    }
    const domain = dataDomains.find((d) => d.id === scopeId);
    if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }
  }

  let person: typeof people[number] | undefined;
  let agent: typeof agents[number] | undefined;

  if (personId) {
    person = people.find((p) => p.id === personId);
    if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  }
  if (agentId) {
    agent = agents.find((a) => a.id === agentId);
    if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
  }

  // Prevent duplicate (same person/agent + roleType + scopeId)
  const duplicate = damaRoles.find((r) => {
    if (personId) return r.personId === personId && r.roleType === roleType && r.scopeId === scopeId;
    if (agentId) return r.agentId === agentId && r.roleType === roleType && r.scopeId === scopeId;
    return false;
  });
  if (duplicate) {
    const entityLabel = personId ? 'person' : 'agent';
    res.status(409).json({ success: false, error: `This ${entityLabel} already has this role for the given scope.` });
    return;
  }

  // Single-holder roles allow at most one holder per scope. The
  // Governance Roles UI enforces this client-side, but a stray POST
  // (or AI-driven assignment) could still try to add a second — fail
  // loudly so the caller surfaces the existing holder instead of
  // silently double-booking.
  if (SINGLE_HOLDER_ROLES.has(roleType)) {
    const existing = damaRoles.find((r) => r.roleType === roleType && r.scopeId === scopeId);
    if (existing) {
      res.status(409).json({
        success: false,
        error: `${roleType} already has a holder for this scope. Remove the existing assignment first.`,
      });
      return;
    }
  }

  const now = new Date().toISOString();
  const role: StoredDamaRole = {
    id: uuid(),
    personId: personId || null,
    agentId: agentId || null,
    agentName: agent?.name || null,
    roleType,
    scopeType,
    scopeId,
    since: now,
    createdAt: now,
  };
  damaRoles.push(role);
  saveStore('damaRoles', damaRoles);

  // Auto-generate onboarding tasks for steward roles (people only)
  let onboardingTaskCount = 0;
  if (personId && (roleType === 'BUSINESS_DATA_STEWARD' || roleType === 'TECHNICAL_DATA_STEWARD')) {
    const STEWARD_ONBOARDING_TASKS = [
      { title: 'Review governance policies and standards', description: 'Read and acknowledge the organization\'s data governance policies, data standards, and quality guidelines.', taskType: 'STEWARDSHIP', dueOffset: 7 },
      { title: 'Complete data steward training', description: 'Complete the steward training module covering responsibilities, tools, escalation procedures, and reporting requirements.', taskType: 'STEWARDSHIP', dueOffset: 14 },
      { title: 'Meet with domain owner and team', description: 'Schedule and complete introductory meetings with your data domain owner, governance lead, and fellow stewards.', taskType: 'STEWARDSHIP', dueOffset: 21 },
      { title: 'Document initial data quality assessment', description: 'Perform an initial assessment of data quality in your assigned domain and document findings, priorities, and a 90-day improvement plan.', taskType: 'STEWARDSHIP', dueOffset: 90 },
    ];

    const now = new Date();
    for (const template of STEWARD_ONBOARDING_TASKS) {
      const dueDate = new Date(now.getTime() + template.dueOffset * 24 * 60 * 60 * 1000);
      governanceTasks.push({
        id: uuid(),
        orgId: scopeId,
        title: template.title,
        description: template.description,
        taskType: template.taskType as any,
        status: 'OPEN',
        priority: 'MEDIUM',
        assigneeId: personId,
        dueDate: dueDate.toISOString(),
        linkedObjectType: 'DamaRole',
        linkedObjectId: role.id,
        automationMode: 'HUMAN',
        resolution: null,
        createdBy: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null,
      });
    }
    saveStore('governanceTasks', governanceTasks);
    onboardingTaskCount = STEWARD_ONBOARDING_TASKS.length;
    logger.info({ roleId: role.id, personId, roleType, tasksCreated: onboardingTaskCount }, 'Created steward onboarding tasks');
  }

  const displayName = person?.name || agent?.name || 'Unknown';
  res.status(201).json({
    success: true,
    data: { ...role, personName: person?.name || null, agentName: agent?.name || null },
    onboardingTasks: onboardingTaskCount,
  });
});

/** DELETE /api/v1/dama-roles/:id — remove assignment */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = damaRoles.findIndex((r) => r.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance role assignment not found' }); return; }
  damaRoles.splice(idx, 1);
  saveStore('damaRoles', damaRoles);
  res.status(204).send();
});

/** GET /api/v1/dama-roles/by-person/:personId — all DAMA roles for a person */
router.get('/by-person/:personId', (req: Request, res: Response) => {
  const personId = req.params.personId;
  const person = people.find((p) => p.id === personId);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

  const roles = damaRoles
    .filter((r) => r.personId === personId)
    .map((r) => ({ ...r, personName: person.name }));

  res.json({ success: true, data: roles });
});

/** GET /api/v1/dama-roles/by-agent/:agentId — all DAMA roles for an agent */
router.get('/by-agent/:agentId', (req: Request, res: Response) => {
  const agentId = req.params.agentId;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }

  const roles = damaRoles
    .filter((r) => r.agentId === agentId)
    .map((r) => ({ ...r, agentName: agent.name }));

  res.json({ success: true, data: roles });
});

/** GET /api/v1/dama-roles/skill-match — analyze skill coverage for a candidate (person or agent) against a role's expected skills */
router.get('/skill-match', (req: Request, res: Response) => {
  const { roleType, candidateType, candidateId, orgId } = req.query;

  if (!roleType || !candidateType || !candidateId) {
    res.status(400).json({ success: false, error: 'roleType, candidateType, and candidateId are required' });
    return;
  }

  // Get candidate's skills
  let candidateSkillIds: string[] = [];
  let candidateName = '';
  if (candidateType === 'person') {
    const person = people.find((p) => p.id === candidateId);
    if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
    candidateName = person.name;
    candidateSkillIds = (person as any).skillIds || [];
  } else if (candidateType === 'agent') {
    const agent = agents.find((a) => a.id === candidateId);
    if (!agent) { res.status(404).json({ success: false, error: 'Agent not found' }); return; }
    candidateName = agent.name;
    candidateSkillIds = agent.skillIds || [];
  } else {
    res.status(400).json({ success: false, error: 'candidateType must be "person" or "agent"' });
    return;
  }

  // Define expected skill categories for each role type
  const ROLE_SKILL_CATEGORIES: Record<string, string[]> = {
    CDO: ['GOVERNANCE', 'COMMUNICATION', 'ANALYTICS'],
    DATA_GOVERNANCE_LEAD: ['GOVERNANCE', 'COMMUNICATION'],
    DATA_OWNER: ['GOVERNANCE', 'COMMUNICATION'],
    BUSINESS_DATA_STEWARD: ['DATA_QUALITY', 'GOVERNANCE', 'METADATA'],
    TECHNICAL_DATA_STEWARD: ['DATA_QUALITY', 'METADATA', 'INTEGRATION'],
    DATA_QUALITY_ANALYST: ['DATA_QUALITY', 'ANALYTICS'],
    DATA_ARCHITECT: ['ARCHITECTURE', 'METADATA', 'INTEGRATION'],
    DATA_CUSTODIAN: ['SECURITY', 'ARCHITECTURE'],
    DATA_ENGINEER: ['INTEGRATION', 'ARCHITECTURE', 'DATA_QUALITY'],
    DATABASE_ADMINISTRATOR: ['ARCHITECTURE', 'SECURITY'],
  };

  const expectedCategories = ROLE_SKILL_CATEGORIES[roleType as string] || ['GOVERNANCE'];

  // Get all skills for the org that match the expected categories
  const orgSkills = orgId ? skills.filter((s) => s.orgId === orgId) : skills;
  const expectedSkillIds = orgSkills
    .filter((s) => expectedCategories.includes(s.category))
    .map((s) => s.id);

  const candidateSet = new Set(candidateSkillIds);
  const matched = expectedSkillIds.filter((id) => candidateSet.has(id));
  const missing = expectedSkillIds.filter((id) => !candidateSet.has(id));
  const coverage = expectedSkillIds.length > 0
    ? Math.round((matched.length / expectedSkillIds.length) * 100)
    : 100;

  // Enrich with skill names
  const skillNameById: Record<string, string> = {};
  for (const s of orgSkills) skillNameById[s.id] = s.name;

  res.json({
    success: true,
    data: {
      roleType,
      candidateType,
      candidateId,
      candidateName,
      matched: matched.map((id) => ({ id, name: skillNameById[id] || id })),
      missing: missing.map((id) => ({ id, name: skillNameById[id] || id })),
      coverage,
      totalExpected: expectedSkillIds.length,
    },
  });
});

/** GET /api/v1/dama-roles/summary — counts by role type. Accepts
 *  ?orgId= to match the same filter the list endpoint uses so the
 *  summary cards and the table below them show consistent numbers. */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  let filtered = [...damaRoles];
  if (orgId) {
    filtered = filtered.filter((r) => roleOrgId(r) === orgId);
  }
  const counts: Record<string, number> = {};
  for (const rt of DAMA_ROLE_TYPES) {
    counts[rt] = filtered.filter((r) => r.roleType === rt).length;
  }
  res.json({ success: true, data: counts, total: filtered.length });
});

export default router;
