// Auto-issue sync for the DQ engine — the first step of the
// "operationalize governance" track. When a data-quality rule
// enters FAILING or WARNING, a governance issue is created and
// routed to the domain steward (fallback: domain owner, then
// asset owner). When the rule recovers to PASSING, the linked
// issue auto-resolves. Idempotent: repeated runs don't duplicate.

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { syncDataQualityIssueForRule, governanceIssues } = require('../routes/governance-issues');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notifications } = require('../routes/notifications');

describe('syncDataQualityIssueForRule', () => {
  const PREFIX = 'test-dq-issue-';
  const orgId = PREFIX + 'org';
  const stewardId = PREFIX + 'steward';
  const domainId = PREFIX + 'domain';
  const assetId = PREFIX + 'asset';
  const ruleId = PREFIX + 'rule';

  const now = new Date().toISOString();

  before(() => {
    // Seed one domain that owns the asset, with a designated steward,
    // so the auto-assignee is deterministic across runs.
    dataDomains.push({
      id: domainId, orgId, name: 'Test Domain', description: '',
      ownerId: null, stewardIds: [stewardId], dataAssetIds: [assetId],
      status: 'ACTIVE', createdAt: now, updatedAt: now,
    });
    dataAssets.push({
      id: assetId, orgId, name: 'Test Asset', description: '',
      systemId: null, ownerPersonId: null,
      governanceTier: 'BRONZE', healthScore: 50,
      createdAt: now, updatedAt: now,
    });
  });

  after(() => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(dataDomains,     (d: any) => d.id === domainId);
    sweep(dataAssets,      (a: any) => a.id === assetId);
    sweep(governanceIssues, (i: any) => i.linkedRuleId === ruleId);
    sweep(notifications,    (n: any) => n.orgId === orgId);
  });

  beforeEach(() => {
    // Clear only the auto-issues and notifications for this rule
    // between tests so each starts from a clean slate; the domain
    // and asset fixtures persist across the suite.
    for (let i = governanceIssues.length - 1; i >= 0; i--) {
      if (governanceIssues[i].linkedRuleId === ruleId) governanceIssues.splice(i, 1);
    }
    for (let i = notifications.length - 1; i >= 0; i--) {
      if (notifications[i].orgId === orgId) notifications.splice(i, 1);
    }
  });

  it('creates a HIGH-severity issue when the rule enters FAILING', async () => {
    await syncDataQualityIssueForRule({
      id: ruleId, orgId, dataAssetId: assetId,
      name: 'Completeness — customer_id',
      currentScore: 60, threshold: 95, status: 'FAILING',
    });
    const issue = governanceIssues.find((i: any) => i.linkedRuleId === ruleId);
    assert.ok(issue, 'issue should be auto-created');
    assert.strictEqual(issue.severity, 'HIGH');
    assert.strictEqual(issue.status, 'OPEN');
    assert.strictEqual(issue.issueType, 'DATA_QUALITY');
    assert.strictEqual(issue.dataAssetId, assetId);
    assert.strictEqual(issue.domainId, domainId);
    assert.strictEqual(issue.assignedTo, stewardId, 'assignee should be the domain steward');
  });

  it('creates a MEDIUM-severity issue when the rule enters WARNING', async () => {
    await syncDataQualityIssueForRule({
      id: ruleId, orgId, dataAssetId: assetId,
      name: 'Timeliness — last_updated',
      currentScore: 88, threshold: 95, status: 'WARNING',
    });
    const issue = governanceIssues.find((i: any) => i.linkedRuleId === ruleId);
    assert.ok(issue);
    assert.strictEqual(issue.severity, 'MEDIUM');
  });

  it('fires an ACTION notification to the assignee on first creation', async () => {
    await syncDataQualityIssueForRule({
      id: ruleId, orgId, dataAssetId: assetId,
      name: 'Completeness — customer_id',
      currentScore: 60, threshold: 95, status: 'FAILING',
    });
    const n = notifications.find((n: any) => n.userId === stewardId && n.type === 'ACTION');
    assert.ok(n, 'steward should receive an ACTION notification');
    assert.match(n.title, /DQ failing:/);
  });

  it('is idempotent — a second FAILING run does not duplicate the issue', async () => {
    await syncDataQualityIssueForRule({ id: ruleId, orgId, dataAssetId: assetId, name: 'rule', currentScore: 60, threshold: 95, status: 'FAILING' });
    await syncDataQualityIssueForRule({ id: ruleId, orgId, dataAssetId: assetId, name: 'rule', currentScore: 55, threshold: 95, status: 'FAILING' });
    const matches = governanceIssues.filter((i: any) => i.linkedRuleId === ruleId);
    assert.strictEqual(matches.length, 1, 'exactly one issue after two failing runs');
  });

  it('closes the linked issue when the rule recovers to PASSING', async () => {
    // First: create the issue by failing.
    await syncDataQualityIssueForRule({ id: ruleId, orgId, dataAssetId: assetId, name: 'rule', currentScore: 60, threshold: 95, status: 'FAILING' });
    // Then: rule recovers.
    await syncDataQualityIssueForRule({ id: ruleId, orgId, dataAssetId: assetId, name: 'rule', currentScore: 98, threshold: 95, status: 'PASSING' });
    const issue = governanceIssues.find((i: any) => i.linkedRuleId === ruleId);
    assert.ok(issue);
    assert.strictEqual(issue.status, 'RESOLVED');
    assert.ok(issue.resolutionSummary?.includes('recovered'));
    assert.ok(issue.closedAt);
  });

  it('is a no-op when there is no dataAssetId', async () => {
    const before = governanceIssues.length;
    await syncDataQualityIssueForRule({ id: ruleId, orgId, name: 'rule', currentScore: 50, threshold: 95, status: 'FAILING' });
    assert.strictEqual(governanceIssues.length, before, 'no issue when the rule has no target asset');
  });
});
