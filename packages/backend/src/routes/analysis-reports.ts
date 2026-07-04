import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS REPORTS — saved configurations for the cube/pivot builder.
//
// Mirrors saved-views but reports are global (no pageKey). The config
// payload is opaque to the server: rowDim, colDim, filters, and any
// future fields (measure, sort order, etc.) round-trip as JSON.
//
// Visibility: every report in an org is visible to everyone in that org.
// Only the owner can modify or delete. (Same model as saved-views.)
// ═══════════════════════════════════════════════════════════════════════════

export interface StoredAnalysisReport {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const analysisReports: StoredAnalysisReport[] =
  loadStore<StoredAnalysisReport>('analysisReports');
registerStore('analysisReports', analysisReports);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/** GET /api/v1/analysis-reports?orgId= */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query as Record<string, string | undefined>;
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const list = analysisReports
    .filter((r) => r.orgId === effectiveOrgId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ success: true, data: list });
});

/** GET /api/v1/analysis-reports/:id */
router.get('/:id', (req: Request, res: Response) => {
  const r = analysisReports.find((r) => r.id === req.params.id);
  if (!r) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  res.json({ success: true, data: r });
});

/** POST /api/v1/analysis-reports */
router.post('/', (req: Request, res: Response) => {
  const { orgId, name, description, config, ownerName } = req.body as {
    orgId?: string; name?: string; description?: string | null;
    config?: Record<string, unknown>; ownerName?: string;
  };
  if (!name || !name.trim()) {
    res.status(400).json({ success: false, error: 'name is required' });
    return;
  }
  if (!config || typeof config !== 'object') {
    res.status(400).json({ success: false, error: 'config object is required' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;
  const ownerId = (req as any).user?.sub || null;

  // Soft uniqueness per (org, owner) — duplicates from typos are the
  // common failure mode; identical names from two different users coexist.
  const collision = analysisReports.find((r) =>
    r.orgId === effectiveOrgId && r.ownerId === ownerId &&
    r.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (collision) {
    res.status(409).json({ success: false, error: 'You already have a report with this name.' });
    return;
  }

  const now = new Date().toISOString();
  const rec: StoredAnalysisReport = {
    id: uuid(),
    orgId: effectiveOrgId,
    name: name.trim(),
    description: description?.trim() || null,
    ownerId,
    ownerName: ownerName || (req as any).user?.name || null,
    config,
    createdAt: now,
    updatedAt: now,
  };
  analysisReports.push(rec);
  saveStore('analysisReports', analysisReports);
  logger.info({ reportId: rec.id, ownerId }, 'Analysis report saved');
  res.status(201).json({ success: true, data: rec });
});

/** PATCH /api/v1/analysis-reports/:id — rename, edit description, update config. */
router.patch('/:id', (req: Request, res: Response) => {
  const r = analysisReports.find((r) => r.id === req.params.id);
  if (!r) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  const editorId = (req as any).user?.sub || null;
  if (r.ownerId && editorId && r.ownerId !== editorId) {
    res.status(403).json({ success: false, error: 'Only the owner can modify this report' });
    return;
  }
  const { name, description, config } = req.body as {
    name?: string; description?: string | null; config?: Record<string, unknown>;
  };
  if (name !== undefined) {
    if (!name.trim()) { res.status(400).json({ success: false, error: 'name cannot be empty' }); return; }
    r.name = name.trim();
  }
  if (description !== undefined) r.description = description?.trim() || null;
  if (config !== undefined) r.config = config;
  r.updatedAt = new Date().toISOString();
  saveStore('analysisReports', analysisReports);
  res.json({ success: true, data: r });
});

/** DELETE /api/v1/analysis-reports/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = analysisReports.findIndex((r) => r.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  const rec = analysisReports[idx];
  const editorId = (req as any).user?.sub || null;
  if (rec.ownerId && editorId && rec.ownerId !== editorId) {
    res.status(403).json({ success: false, error: 'Only the owner can delete this report' });
    return;
  }
  analysisReports.splice(idx, 1);
  saveStore('analysisReports', analysisReports);
  res.status(204).send();
});

export default router;
