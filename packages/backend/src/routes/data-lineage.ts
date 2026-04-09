import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { systems } from './systems';
import { dataAssets } from './data-assets';

interface DataLineageLink {
  id: string;
  orgId: string;
  sourceSystemId: string;
  targetSystemId: string;
  dataAssetId: string | null;
  description: string;
  flowType: 'ETL' | 'API' | 'FILE_TRANSFER' | 'REPLICATION' | 'MANUAL' | 'STREAMING';
  frequency: 'REAL_TIME' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_DEMAND';
  status: 'ACTIVE' | 'INACTIVE' | 'DEPRECATED';
  createdAt: string;
  updatedAt: string;
}

export const dataLineageLinks: DataLineageLink[] = loadStore<DataLineageLink>('dataLineageLinks');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const FLOW_TYPES = ['ETL', 'API', 'FILE_TRANSFER', 'REPLICATION', 'MANUAL', 'STREAMING'];
const FREQUENCIES = ['REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND'];

const router = Router();

/** DELETE /api/v1/data-lineage/all — delete all lineage links */
router.delete('/all', (_req: Request, res: Response) => {
  const count = dataLineageLinks.length;
  dataLineageLinks.splice(0, dataLineageLinks.length);
  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data lineage links');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-lineage — list all (support ?orgId= filter), enrich with system names and data asset name */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataLineageLinks.filter((l) => l.orgId === orgId) : dataLineageLinks;

  const enriched = filtered.map((link) => {
    const sourceSystem = systems.find((s) => s.id === link.sourceSystemId);
    const targetSystem = systems.find((s) => s.id === link.targetSystemId);
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      ...link,
      sourceSystemName: sourceSystem?.name || '',
      targetSystemName: targetSystem?.name || '',
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-lineage/by-system/:systemId — get all lineage links involving a system */
router.get('/by-system/:systemId', (req: Request, res: Response) => {
  const { systemId } = req.params;
  const links = dataLineageLinks.filter(
    (l) => l.sourceSystemId === systemId || l.targetSystemId === systemId
  );

  const enriched = links.map((link) => {
    const sourceSystem = systems.find((s) => s.id === link.sourceSystemId);
    const targetSystem = systems.find((s) => s.id === link.targetSystemId);
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      ...link,
      sourceSystemName: sourceSystem?.name || '',
      targetSystemName: targetSystem?.name || '',
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-lineage/visualization — return data formatted for visualization */
router.get('/visualization', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filteredLinks = orgId ? dataLineageLinks.filter((l) => l.orgId === orgId) : dataLineageLinks;

  // Collect unique system IDs from lineage links
  const systemIds = new Set<string>();
  filteredLinks.forEach((link) => {
    systemIds.add(link.sourceSystemId);
    systemIds.add(link.targetSystemId);
  });

  const nodes = systems
    .filter((s) => systemIds.has(s.id))
    .map((s) => {
      const inbound = filteredLinks.filter((l) => l.targetSystemId === s.id).length;
      const outbound = filteredLinks.filter((l) => l.sourceSystemId === s.id).length;
      return {
        id: s.id,
        name: s.name,
        systemType: s.systemType,
        inboundCount: inbound,
        outboundCount: outbound,
      };
    });

  const links = filteredLinks.map((link) => {
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      id: link.id,
      sourceSystemId: link.sourceSystemId,
      targetSystemId: link.targetSystemId,
      flowType: link.flowType,
      frequency: link.frequency,
      status: link.status,
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: { nodes, links } });
});

/** GET /api/v1/data-lineage/:id — single link */
router.get('/:id', (req: Request, res: Response) => {
  const link = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!link) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  res.json({ success: true, data: link });
});

/** POST /api/v1/data-lineage — create */
router.post('/', (req: Request, res: Response) => {
  const { sourceSystemId, targetSystemId, dataAssetId, description, flowType, frequency, status, orgId } = req.body;

  if (!sourceSystemId || !targetSystemId) {
    res.status(400).json({ success: false, error: 'sourceSystemId and targetSystemId are required' });
    return;
  }

  if (sourceSystemId === targetSystemId) {
    res.status(400).json({ success: false, error: 'Source and target systems cannot be the same' });
    return;
  }

  const validFlowType = flowType && FLOW_TYPES.includes(flowType) ? flowType : 'ETL';
  const validFrequency = frequency && FREQUENCIES.includes(frequency) ? frequency : 'ON_DEMAND';
  const validStatus = status && ['ACTIVE', 'INACTIVE', 'DEPRECATED'].includes(status) ? status : 'ACTIVE';

  const now = new Date().toISOString();
  const link: DataLineageLink = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    sourceSystemId,
    targetSystemId,
    dataAssetId: dataAssetId || null,
    description: description || '',
    flowType: validFlowType,
    frequency: validFrequency,
    status: validStatus,
    createdAt: now,
    updatedAt: now,
  };

  dataLineageLinks.push(link);
  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'CREATE', null, link);
  res.status(201).json({ success: true, data: link });
});

/** PUT /api/v1/data-lineage/:id — update */
router.put('/:id', (req: Request, res: Response) => {
  const link = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!link) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }

  const { sourceSystemId, targetSystemId, dataAssetId, description, flowType, frequency, status } = req.body;

  const newSource = sourceSystemId !== undefined ? sourceSystemId : link.sourceSystemId;
  const newTarget = targetSystemId !== undefined ? targetSystemId : link.targetSystemId;
  if (newSource === newTarget) {
    res.status(400).json({ success: false, error: 'Source and target systems cannot be the same' });
    return;
  }

  if (sourceSystemId !== undefined) link.sourceSystemId = sourceSystemId;
  if (targetSystemId !== undefined) link.targetSystemId = targetSystemId;
  if (dataAssetId !== undefined) link.dataAssetId = dataAssetId || null;
  if (description !== undefined) link.description = description;
  if (flowType !== undefined && FLOW_TYPES.includes(flowType)) link.flowType = flowType;
  if (frequency !== undefined && FREQUENCIES.includes(frequency)) link.frequency = frequency;
  if (status !== undefined && ['ACTIVE', 'INACTIVE', 'DEPRECATED'].includes(status)) link.status = status;
  link.updatedAt = new Date().toISOString();

  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'UPDATE', null, link);
  res.json({ success: true, data: link });
});

/** DELETE /api/v1/data-lineage/:id — delete */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataLineageLinks.findIndex((l) => l.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', dataLineageLinks[idx].id, 'DELETE', dataLineageLinks[idx], null);
  dataLineageLinks.splice(idx, 1);
  saveStore('dataLineageLinks', dataLineageLinks);
  res.status(204).send();
});

export default router;
