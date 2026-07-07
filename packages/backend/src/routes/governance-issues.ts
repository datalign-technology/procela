import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { people } from './people';
import { dataDomains } from './data-domains';
import { dataAssets } from './data-assets';
import { createNotification } from './notifications';
import logger from '../lib/logger';

const ISSUE_TYPES = [
  'METADATA',
  'DATA_QUALITY',
  'CLASSIFICATION',
  'OWNERSHIP',
  'POLICY',
  'ACCESS',
  'LINEAGE',
  'COMPLIANCE',
  'WORKFLOW',
] as const;

const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const ISSUE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'WONT_FIX',
] as const;

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED', 'WONT_FIX']);

// ── Auto-issue sync (called by other subsystems on state change) ──

/**
 * Rule → issue sync. Called by the DQ engine after a rule run so a
 * governance issue tracks the failure through to resolution —
 * closing itself when the rule recovers instead of leaving orphaned
 * tickets.
 *
 * Behaviour:
 *   - Rule now FAILING or WARNING → ensure an OPEN issue exists
 *     linked to the rule. Idempotent: a second run doesn't
 *     duplicate. Assignee is the domain steward → domain owner →
 *     asset owner, in that order. A notification is fired on first
 *     creation.
 *   - Rule now PASSING → close any OPEN linked issue with a
 *     "rule recovered" resolution note. Notifies the assignee.
 *   - NOT_MEASURED / no ruleType / no dataAssetId → no-op.
 *
 * Kept as a plain function (not a router) so the DQ scheduler can
 * import it directly without pulling the whole router graph.
 */
export function syncDataQualityIssueForRule(rule: {
  id: string;
  orgId: string;
  dataAssetId?: string;
  name?: string;
  currentScore?: number;
  threshold?: number;
  status?: string;
  dimension?: string;
}): void {
  if (!rule.dataAssetId) return;
  const status = rule.status;
  const asset = dataAssets.find((a) => a.id === rule.dataAssetId);
  if (!asset) return;

  // Find an existing open issue linked to this rule.
  const existing = governanceIssues.find(
    (i) => i.linkedRuleId === rule.id && !TERMINAL_STATUSES.has(i.status),
  );

  const now = new Date().toISOString();

  if (status === 'PASSING') {
    if (!existing) return;
    existing.status = 'RESOLVED';
    existing.resolutionSummary = `DQ rule recovered — score ${rule.currentScore ?? '?'} meets threshold ${rule.threshold ?? '?'}.`;
    existing.closedAt = now;
    existing.updatedAt = now;
    saveStore('governanceIssues', governanceIssues);
    auditService.log(rule.orgId, null, 'GovernanceIssue', existing.id, 'AUTO_RESOLVED', null, { linkedRuleId: rule.id });
    if (existing.assignedTo) {
      createNotification({
        orgId: rule.orgId,
        userId: existing.assignedTo,
        type: 'INFO',
        title: 'DQ issue auto-resolved',
        message: `${rule.name || 'A DQ rule'} on ${asset.name} recovered.`,
        link: `/governance-issues?id=${existing.id}`,
      });
    }
    return;
  }

  if (status !== 'FAILING' && status !== 'WARNING') return;

  if (existing) {
    // Bump the description with the latest score so the issue detail
    // shows current state without duplicating.
    existing.description = `${rule.name || 'DQ rule'} is ${status.toLowerCase()} on ${asset.name} — score ${rule.currentScore ?? '?'} against threshold ${rule.threshold ?? '?'}.`;
    existing.severity = status === 'FAILING' ? 'HIGH' : 'MEDIUM';
    existing.updatedAt = now;
    saveStore('governanceIssues', governanceIssues);
    return;
  }

  // Pick the assignee. Domain steward > domain owner > asset owner.
  // (Domain-level accountability matches DAMA: steward executes,
  // owner is accountable; asset owner is the operational fallback.)
  const domain = dataDomains.find((d) => d.dataAssetIds?.includes(asset.id));
  let assignedTo: string | null = null;
  if (domain?.stewardIds && domain.stewardIds.length > 0) assignedTo = domain.stewardIds[0];
  else if (domain?.ownerId) assignedTo = domain.ownerId;
  else if (asset.ownerPersonId) assignedTo = asset.ownerPersonId;

  const newIssue: StoredGovernanceIssue = {
    id: uuid(),
    orgId: rule.orgId,
    title: `DQ ${status.toLowerCase()}: ${rule.name || 'rule'} on ${asset.name}`,
    description: `${rule.name || 'DQ rule'} is ${status.toLowerCase()} on ${asset.name} — score ${rule.currentScore ?? '?'} against threshold ${rule.threshold ?? '?'}.`,
    issueType: 'DATA_QUALITY',
    severity: status === 'FAILING' ? 'HIGH' : 'MEDIUM',
    status: 'OPEN',
    domainId: domain?.id || null,
    dataAssetId: asset.id,
    systemId: asset.systemId || null,
    reportedBy: null,
    assignedTo,
    resolutionSummary: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    linkedRuleId: rule.id,
  };
  governanceIssues.push(newIssue);
  saveStore('governanceIssues', governanceIssues);
  auditService.log(rule.orgId, null, 'GovernanceIssue', newIssue.id, 'AUTO_CREATED', null, { linkedRuleId: rule.id, severity: newIssue.severity });
  logger.info({ ruleId: rule.id, issueId: newIssue.id, severity: newIssue.severity }, 'DQ auto-issue created');

  if (assignedTo) {
    createNotification({
      orgId: rule.orgId,
      userId: assignedTo,
      type: 'ACTION',
      title: `DQ ${status.toLowerCase()}: ${asset.name}`,
      message: `${rule.name || 'A DQ rule'} needs attention on ${asset.name}. Score ${rule.currentScore ?? '?'} against threshold ${rule.threshold ?? '?'}.`,
      link: `/governance-issues?id=${newIssue.id}`,
    });
  }
}

interface StoredGovernanceIssue {
  id: string;
  orgId: string;
  title: string;
  description: string;
  issueType: typeof ISSUE_TYPES[number];
  severity: typeof ISSUE_SEVERITIES[number];
  status: typeof ISSUE_STATUSES[number];
  domainId: string | null;
  dataAssetId: string | null;
  systemId: string | null;
  reportedBy: string | null;
  assignedTo: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** For issues that were auto-created by another system (DQ engine,
   *  policy-review reminder, etc.), the id of the originating record.
   *  Lets the sync helper reopen or close the same issue on later
   *  status changes rather than piling up duplicates. Null for
   *  manually-authored issues. */
  linkedRuleId?: string | null;
}

export const governanceIssues: StoredGovernanceIssue[] = loadStore<StoredGovernanceIssue>('governanceIssues');
registerStore('governanceIssues', governanceIssues);

function enrichIssue(issue: StoredGovernanceIssue): any {
  const reporter = issue.reportedBy ? people.find((p) => p.id === issue.reportedBy) : null;
  const assignee = issue.assignedTo ? people.find((p) => p.id === issue.assignedTo) : null;
  const domain = issue.domainId ? dataDomains.find((d) => d.id === issue.domainId) : null;
  const asset = issue.dataAssetId ? dataAssets.find((a) => a.id === issue.dataAssetId) : null;
  return {
    ...issue,
    reporterName: reporter?.name || null,
    assigneeName: assignee?.name || null,
    domainName: domain?.name || null,
    dataAssetName: asset?.name || null,
  };
}

const router = Router();

/** GET /api/v1/governance-issues/summary */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(governanceIssues, orgId as string | undefined);

  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byIssueType: Record<string, number> = {};

  for (const s of ISSUE_STATUSES) byStatus[s] = 0;
  for (const s of ISSUE_SEVERITIES) bySeverity[s] = 0;
  for (const t of ISSUE_TYPES) byIssueType[t] = 0;

  for (const issue of filtered) {
    byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byIssueType[issue.issueType] = (byIssueType[issue.issueType] || 0) + 1;
  }

  res.json({
    success: true,
    data: { total: filtered.length, byStatus, bySeverity, byIssueType },
  });
});

/** GET /api/v1/governance-issues */
router.get('/', (req: Request, res: Response) => {
  const { orgId, status, severity, issueType, assignedTo, domainId } = req.query;
  let filtered = filterByOrgScope(governanceIssues, orgId as string | undefined);

  if (status) filtered = filtered.filter((i) => i.status === status);
  if (severity) filtered = filtered.filter((i) => i.severity === severity);
  if (issueType) filtered = filtered.filter((i) => i.issueType === issueType);
  if (assignedTo) filtered = filtered.filter((i) => i.assignedTo === assignedTo);
  if (domainId) filtered = filtered.filter((i) => i.domainId === domainId);

  res.json({ success: true, data: filtered.map(enrichIssue) });
});

/** GET /api/v1/governance-issues/:id */
router.get('/:id', (req: Request, res: Response) => {
  const issue = governanceIssues.find((i) => i.id === req.params.id);
  if (!issue) { res.status(404).json({ success: false, error: 'Governance issue not found' }); return; }
  res.json({ success: true, data: enrichIssue(issue) });
});

/** POST /api/v1/governance-issues */
router.post('/', (req: Request, res: Response) => {
  const {
    title, orgId, description, issueType, severity, status,
    domainId, dataAssetId, systemId, reportedBy, assignedTo,
    resolutionSummary,
  } = req.body;

  if (!title) { res.status(400).json({ success: false, error: 'Title is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  if (issueType && !ISSUE_TYPES.includes(issueType as any)) {
    res.status(400).json({ success: false, error: `Invalid issueType. Must be one of: ${ISSUE_TYPES.join(', ')}` });
    return;
  }
  if (severity && !ISSUE_SEVERITIES.includes(severity as any)) {
    res.status(400).json({ success: false, error: `Invalid severity. Must be one of: ${ISSUE_SEVERITIES.join(', ')}` });
    return;
  }
  if (status && !ISSUE_STATUSES.includes(status as any)) {
    res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${ISSUE_STATUSES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const resolvedStatus = status || 'OPEN';
  const issue: StoredGovernanceIssue = {
    id: uuid(),
    orgId,
    title,
    description: description || '',
    issueType: issueType || 'METADATA',
    severity: severity || 'MEDIUM',
    status: resolvedStatus,
    domainId: domainId || null,
    dataAssetId: dataAssetId || null,
    systemId: systemId || null,
    reportedBy: reportedBy || null,
    assignedTo: assignedTo || null,
    resolutionSummary: resolutionSummary || null,
    createdAt: now,
    updatedAt: now,
    closedAt: TERMINAL_STATUSES.has(resolvedStatus) ? now : null,
  };

  governanceIssues.push(issue);
  saveStore('governanceIssues', governanceIssues);
  auditService.log(issue.orgId, null, 'GovernanceIssue', issue.id, 'CREATE', null, issue);
  logger.info({ issueId: issue.id, title: issue.title, issueType: issue.issueType }, 'Created governance issue');
  res.status(201).json({ success: true, data: enrichIssue(issue) });
});

/** PUT /api/v1/governance-issues/:id */
router.put('/:id', (req: Request, res: Response) => {
  const issue = governanceIssues.find((i) => i.id === req.params.id);
  if (!issue) { res.status(404).json({ success: false, error: 'Governance issue not found' }); return; }

  const before = { ...issue };
  const {
    title, description, issueType, severity, status,
    domainId, dataAssetId, systemId, assignedTo,
    resolutionSummary,
  } = req.body;

  if (issueType !== undefined) {
    if (!ISSUE_TYPES.includes(issueType as any)) {
      res.status(400).json({ success: false, error: `Invalid issueType. Must be one of: ${ISSUE_TYPES.join(', ')}` });
      return;
    }
    issue.issueType = issueType;
  }
  if (severity !== undefined) {
    if (!ISSUE_SEVERITIES.includes(severity as any)) {
      res.status(400).json({ success: false, error: `Invalid severity. Must be one of: ${ISSUE_SEVERITIES.join(', ')}` });
      return;
    }
    issue.severity = severity;
  }
  if (status !== undefined) {
    if (!ISSUE_STATUSES.includes(status as any)) {
      res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${ISSUE_STATUSES.join(', ')}` });
      return;
    }
  }

  if (title !== undefined) issue.title = title;
  if (description !== undefined) issue.description = description;
  if (domainId !== undefined) issue.domainId = domainId;
  if (dataAssetId !== undefined) issue.dataAssetId = dataAssetId;
  if (systemId !== undefined) issue.systemId = systemId;
  if (assignedTo !== undefined) issue.assignedTo = assignedTo;
  if (resolutionSummary !== undefined) issue.resolutionSummary = resolutionSummary;

  // Apply status last so closedAt logic runs correctly
  if (status !== undefined) {
    issue.status = status;
    if (TERMINAL_STATUSES.has(status) && !issue.closedAt) {
      issue.closedAt = new Date().toISOString();
    }
  }

  issue.updatedAt = new Date().toISOString();
  saveStore('governanceIssues', governanceIssues);
  auditService.log(issue.orgId, null, 'GovernanceIssue', issue.id, 'UPDATE', before, issue);
  logger.info({ issueId: issue.id, title: issue.title }, 'Updated governance issue');
  res.json({ success: true, data: enrichIssue(issue) });
});

/** DELETE /api/v1/governance-issues/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = governanceIssues.findIndex((i) => i.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Governance issue not found' }); return; }
  const removed = governanceIssues[idx];
  auditService.log(removed.orgId, null, 'GovernanceIssue', removed.id, 'DELETE', removed, null);
  governanceIssues.splice(idx, 1);
  saveStore('governanceIssues', governanceIssues);
  logger.info({ issueId: removed.id, title: removed.title }, 'Deleted governance issue');
  res.status(204).send();
});

export default router;
