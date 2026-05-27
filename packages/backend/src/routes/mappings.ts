import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { people } from './people';
import { governancePolicies } from './governance-policies';
import { attachments } from './attachments';

// ── Types ──

// A mapping row connects a process activity to one of three target
// kinds — a Data Asset (operational I/O), a Policy / Governance
// Document (charter, standard, policy that the activity produces
// or consumes), or an Attachment (an uploaded file or URL bound
// to the same activity node). Exactly one of dataAssetId /
// policyId / attachmentId must be set; the others are undefined.
// Existing rows in storage only carry dataAssetId — they keep
// working unchanged.
interface StoredMapping {
  id: string;
  orgId: string;
  processStepId: string;
  dataAssetId?: string;
  policyId?: string;
  attachmentId?: string;
  linkType: string;
  notes: string;
  aiSuggested: boolean;
  userOverridden: boolean;
  criticality?: 'REQUIRED' | 'OPTIONAL';
  dataFormat?: string;
  sla?: string;
  qualityRequirement?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const mappings: StoredMapping[] = loadStore<StoredMapping>('mappings');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const VALID_LINK_TYPES = ['consumes', 'produces', 'transforms', 'references'];

// ── Helpers ──

function findStepInfo(stepId: string) {
  const node = processNodes.find((n) => n.id === stepId);
  if (!node) return null;

  // Build ancestry path
  const path: string[] = [node.name];
  let current = node;
  while (current.parentId) {
    const parent = processNodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    path.unshift(parent.name);
    current = parent;
  }

  return {
    stepId: node.id,
    stepName: node.name,
    level: node.level,
    activityId: node.activityId,
    path: path.join(' > '),
  };
}

function findAssetInfo(assetId: string | undefined) {
  if (!assetId) return null;
  const asset = dataAssets.find((a) => a.id === assetId);
  if (!asset) return null;
  const owner = asset.owner ? people.find((p) => p.id === asset.owner) : null;
  const stewardIds = asset.stewardIds || [];
  const stewardName = stewardIds
    .map((sid) => people.find((p) => p.id === sid)?.name)
    .filter(Boolean)
    .join(', ') || null;
  return {
    assetId: asset.id,
    assetName: asset.name,
    assetDescription: asset.description,
    governanceTier: asset.governanceTier,
    healthScore: asset.healthScore,
    ownerName: owner?.name || null,
    stewardName,
  };
}

function findPolicyInfo(policyId: string | undefined) {
  if (!policyId) return null;
  const policy = governancePolicies.find((p) => p.id === policyId);
  if (!policy) return null;
  return {
    policyId: policy.id,
    policyName: policy.name,
    policyCode: policy.code,
    documentType: policy.documentType,
    status: policy.status,
  };
}

function findAttachmentInfo(attachmentId: string | undefined) {
  if (!attachmentId) return null;
  const att = attachments.find((a) => a.id === attachmentId);
  if (!att) return null;
  return {
    attachmentId: att.id,
    name: att.name,
    type: att.type,
    fileName: att.fileName,
    url: att.url,
    mimeType: att.mimeType,
    fileSize: att.fileSize,
  };
}

function enrichMapping(m: StoredMapping) {
  return {
    ...m,
    stepInfo: findStepInfo(m.processStepId),
    assetInfo: findAssetInfo(m.dataAssetId),
    policyInfo: findPolicyInfo(m.policyId),
    attachmentInfo: findAttachmentInfo(m.attachmentId),
  };
}

const router = Router();

/** DELETE /api/v1/mappings/all — delete all mappings */
router.delete('/all', (_req: Request, res: Response) => {
  const count = mappings.length;
  mappings.splice(0, mappings.length);
  saveStore('mappings', mappings);
  auditService.log(DEV_ORG_ID, null, 'Mapping', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all mappings');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/mappings */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(mappings, orgId as string | undefined);
  const enriched = filtered.map(enrichMapping);
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/mappings/by-step/:stepId */
router.get('/by-step/:stepId', (req: Request, res: Response) => {
  const filtered = mappings.filter((m) => m.processStepId === req.params.stepId);
  res.json({ success: true, data: filtered.map(enrichMapping) });
});

/** GET /api/v1/mappings/by-asset/:assetId */
router.get('/by-asset/:assetId', (req: Request, res: Response) => {
  const filtered = mappings.filter((m) => m.dataAssetId === req.params.assetId);
  res.json({ success: true, data: filtered.map(enrichMapping) });
});

/** POST /api/v1/mappings */
router.post('/', (req: Request, res: Response) => {
  const { processStepId, dataAssetId, policyId, attachmentId, linkType, notes, aiSuggested, orgId,
    criticality, dataFormat, sla, qualityRequirement } = req.body;

  if (!processStepId) {
    res.status(400).json({ success: false, error: 'processStepId is required' });
    return;
  }
  // Exactly one target kind must be provided. Three nullable
  // fields beat one polymorphic "targetType + targetId" because
  // existing rows already speak dataAssetId.
  const targets = [dataAssetId, policyId, attachmentId].filter((t) => typeof t === 'string' && t);
  if (targets.length === 0) {
    res.status(400).json({ success: false, error: 'One of dataAssetId, policyId, or attachmentId is required' });
    return;
  }
  if (targets.length > 1) {
    res.status(400).json({ success: false, error: 'A mapping row can target only one of dataAssetId / policyId / attachmentId, not multiple' });
    return;
  }
  if (linkType && !VALID_LINK_TYPES.includes(linkType)) {
    res.status(400).json({ success: false, error: `linkType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const mapping: StoredMapping = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    processStepId,
    ...(dataAssetId ? { dataAssetId } : {}),
    ...(policyId ? { policyId } : {}),
    ...(attachmentId ? { attachmentId } : {}),
    linkType: linkType || 'references',
    notes: notes || '',
    aiSuggested: aiSuggested === true,
    userOverridden: false,
    ...(criticality ? { criticality } : {}),
    ...(dataFormat ? { dataFormat } : {}),
    ...(sla ? { sla } : {}),
    ...(qualityRequirement ? { qualityRequirement } : {}),
    createdBy: 'dev-user',
    createdAt: now,
    updatedAt: now,
  };
  mappings.push(mapping);
  saveStore('mappings', mappings);
  res.status(201).json({ success: true, data: enrichMapping(mapping) });
});

/** PUT /api/v1/mappings/:id */
router.put('/:id', (req: Request, res: Response) => {
  const mapping = mappings.find((m) => m.id === req.params.id);
  if (!mapping) {
    res.status(404).json({ success: false, error: 'Mapping not found' });
    return;
  }

  const { processStepId, dataAssetId, linkType, notes, aiSuggested, userOverridden,
    criticality, dataFormat, sla, qualityRequirement } = req.body;
  if (processStepId !== undefined) mapping.processStepId = processStepId;
  if (dataAssetId !== undefined) mapping.dataAssetId = dataAssetId;
  if (linkType !== undefined) {
    if (!VALID_LINK_TYPES.includes(linkType)) {
      res.status(400).json({ success: false, error: `linkType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
      return;
    }
    mapping.linkType = linkType;
  }
  if (notes !== undefined) mapping.notes = notes;
  if (aiSuggested !== undefined) mapping.aiSuggested = aiSuggested === true;
  if (userOverridden !== undefined) mapping.userOverridden = userOverridden === true;
  if (criticality !== undefined) mapping.criticality = criticality || undefined;
  if (dataFormat !== undefined) mapping.dataFormat = dataFormat || undefined;
  if (sla !== undefined) mapping.sla = sla || undefined;
  if (qualityRequirement !== undefined) mapping.qualityRequirement = qualityRequirement || undefined;
  mapping.updatedAt = new Date().toISOString();
  saveStore('mappings', mappings);
  res.json({ success: true, data: enrichMapping(mapping) });
});

/** DELETE /api/v1/mappings/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = mappings.findIndex((m) => m.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Mapping not found' });
    return;
  }
  mappings.splice(idx, 1);
  saveStore('mappings', mappings);
  res.status(204).send();
});

export default router;
