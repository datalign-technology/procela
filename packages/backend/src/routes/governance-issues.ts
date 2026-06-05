import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { people } from './people';
import { dataDomains } from './data-domains';
import { dataAssets } from './data-assets';
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
