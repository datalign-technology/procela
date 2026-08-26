// Connector-side data-quality endpoints. The connector-authenticated (pct_
// token) counterparts that let an on-prem connector run DQ rules inside the
// customer network and push back MEASURED results — aggregate pass/fail
// counts only, never row values.
//
//   GET  /connectors/dq-rules    — the executable rule plan for this
//                                  connector's assets (supported rule types,
//                                  column-targeted).
//   POST /connectors/dq-results  — record the measured results the connector
//                                  computed; each feeds real asset health.
//
// Mounted under /api/v1/connectors so the agent's contract is
// /connectors/dq-* — same prefix and auth model as /connectors/report.

import { Router, Request, Response } from 'express';
import { requireConnectorToken, recordConnectorEvent, type StoredConnector } from './connectors';
import { listConnectorRulePlan, recordConnectorRuleResults, type ConnectorRuleResult } from './data-quality';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

/**
 * GET /api/v1/connectors/dq-rules — the DQ rules this connector should run:
 * supported, typed, column-targeted rules on the assets it discovered. The
 * agent polls this, evaluates each against its local source, and posts the
 * counts back to /dq-results.
 */
router.get('/dq-rules', requireConnectorToken, asyncHandler(async (req: Request, res: Response) => {
  const connector = (req as Request & { connector: StoredConnector }).connector;
  const rules = await listConnectorRulePlan(connector.id);
  await recordConnectorEvent(connector.id, connector.orgId, 'DQ_RULES_FETCHED', { count: rules.length });
  res.json({ success: true, data: { rules } });
}));

/**
 * POST /api/v1/connectors/dq-results — apply measured rule results the
 * connector computed on-prem. Body: { results: [{ ruleId, totalRows,
 * passCount, passRate?, ranAt? }] }. Results for rules that aren't on this
 * connector's own assets are skipped.
 */
router.post('/dq-results', requireConnectorToken, asyncHandler(async (req: Request, res: Response) => {
  const connector = (req as Request & { connector: StoredConnector }).connector;
  const results = (req.body as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    res.status(400).json({ success: false, error: 'body.results must be an array' });
    return;
  }
  const outcome = await recordConnectorRuleResults(
    { id: connector.id, orgId: connector.orgId },
    results as ConnectorRuleResult[],
  );
  await recordConnectorEvent(connector.id, connector.orgId, 'DQ_RESULTS_APPLIED', outcome);
  res.json({ success: true, data: outcome });
}));

export default router;
