import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { seedDemoData, type DemoIndustry } from '../services/demo-seed.service';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Admin-only endpoints. Currently just the demo-seed loader; other
// admin-plane operations (org-wide export, cache warm, digest run)
// can accrete here without cluttering their feature routers.
// ──────────────────────────────────────────────────────────────────────────

const router = Router();

function requireSuperAdmin(req: AuthenticatedRequest, res: Response): boolean {
  const role = req.user?.role;
  if (role !== 'SUPER_ADMIN') {
    res.status(403).json({ success: false, error: 'This action requires a SUPER_ADMIN.' });
    return false;
  }
  return true;
}

/**
 * POST /api/v1/admin/demo-seed
 *
 * Idempotently loads a demo Tidewater Utilities fixture into every
 * relevant store. Restricted to SUPER_ADMIN — safety net for a
 * button that mints ~50 rows across a dozen tables. Every row
 * lands with a `demo-` prefixed id; a second call wipes the prior
 * pass first so the endpoint always converges on a known good
 * state.
 */
router.post('/demo-seed', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  // Industry selector: 'utilities' (default) or 'shipbuilding'. Anything
  // else is rejected so a typo doesn't silently seed the default.
  const requested = req.body?.industry;
  const validIndustries: DemoIndustry[] = ['utilities', 'shipbuilding'];
  const industry: DemoIndustry = requested == null ? 'utilities' : requested;
  if (!validIndustries.includes(industry)) {
    res.status(400).json({ success: false, error: `Unknown industry "${requested}". Expected one of: ${validIndustries.join(', ')}.` });
    return;
  }
  try {
    const report = await seedDemoData(industry);
    auditService.log(report.persona.id, req.user?.sub || null, 'Admin', 'demo-seed', 'CREATE', null, report);
    logger.info({ actor: req.user?.email || req.user?.sub, industry, report }, 'Demo seed applied');
    res.json({
      success: true,
      data: report,
      message: `Loaded ${industry === 'shipbuilding' ? 'Meridian Shipbuilding' : 'Tidewater Utilities'} demo — ${report.organizations} orgs, ${report.people} people, ${report.dataAssets} data assets, ${report.processNodes} process nodes, ${report.mappings} mappings. Sign in as ${report.persona.name} to see the demo persona.`,
    });
  } catch (err) {
    logger.error({ err }, 'Demo seed failed');
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Demo seed failed' });
  }
});

export default router;
