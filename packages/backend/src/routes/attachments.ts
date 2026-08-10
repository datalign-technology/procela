import { Router, Request, Response, raw } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import { getAttachmentsRepository } from '../db/attachments.repo';
import { AuthenticatedRequest } from '../middleware/auth';
import { enforceAssignment } from '../lib/assignment';

// ── Attachment model ────────────────────────────────────────────────────
//
// An attachment is either a FILE uploaded to the server or a URL link to
// an external document (SharePoint, Confluence, etc.). Both share the
// same metadata shape so the UI can render them uniformly.
// Currently attached to process catalog nodes; extensible to other entities.

export interface StoredAttachment {
  id: string;
  orgId: string;
  entityType: string;        // e.g. 'ProcessNode', 'DataAsset'
  entityId: string;
  type: 'FILE' | 'URL';
  name: string;              // display title
  description: string;
  // File-specific
  fileName?: string;
  filePath?: string;         // absolute path on server
  fileSize?: number;
  mimeType?: string;
  // URL-specific
  url?: string;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const attachments: StoredAttachment[] = loadStore<StoredAttachment>('attachments');
registerStore('attachments', attachments);
const attachmentsRepo = getAttachmentsRepository(attachments);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';
const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const ATTACHMENTS_ROOT = path.join(DATA_DIR, 'attachments');
const MAX_FILE_SIZE_MB = 10;

// Whitelisted mime types — prevents executable uploads
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'application/json',
]);

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

const router = Router();

/** GET /api/v1/attachments?entityId=X&entityType=Y */
router.get('/', async (req: Request, res: Response) => {
  const { entityId, entityType, orgId } = req.query;
  let filtered = await attachmentsRepo.list();
  if (entityId) filtered = filtered.filter((a) => a.entityId === entityId);
  if (entityType) filtered = filtered.filter((a) => a.entityType === entityType);
  if (orgId) filtered = filtered.filter((a) => a.orgId === orgId);
  res.json({ success: true, data: filtered });
});

/**
 * GET /api/v1/attachments/counts?entityType=Y[&orgId=Z][&entityIds=a,b,c]
 *
 * Returns a { [entityId]: count } map in a single round-trip so a caller
 * rendering many entities (e.g. the whole process-catalog tree) can show
 * per-entity attachment counts without one fetch per entity. Optional
 * `entityIds` (comma-separated) narrows the result to those ids; entities
 * with zero attachments are simply absent from the map.
 *
 * Declared before `/:id` so "counts" isn't captured as an id param.
 */
router.get('/counts', async (req: Request, res: Response) => {
  const { entityType, entityIds, orgId } = req.query;
  const all = await attachmentsRepo.list();
  const idFilter = typeof entityIds === 'string' && entityIds.length > 0
    ? new Set(entityIds.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const counts: Record<string, number> = {};
  for (const a of all) {
    if (entityType && a.entityType !== entityType) continue;
    if (orgId && a.orgId !== orgId) continue;
    if (idFilter && !idFilter.has(a.entityId)) continue;
    counts[a.entityId] = (counts[a.entityId] || 0) + 1;
  }
  res.json({ success: true, data: counts });
});

/** GET /api/v1/attachments/:id — get metadata */
router.get('/:id', async (req: Request, res: Response) => {
  const a = await attachmentsRepo.get(req.params.id as string);
  if (!a) { res.status(404).json({ success: false, error: 'Attachment not found' }); return; }
  res.json({ success: true, data: a });
});

/** GET /api/v1/attachments/:id/download — stream the file */
router.get('/:id/download', async (req: Request, res: Response) => {
  const a = await attachmentsRepo.get(req.params.id as string);
  if (!a) { res.status(404).json({ success: false, error: 'Attachment not found' }); return; }
  if (a.type !== 'FILE' || !a.filePath) {
    res.status(400).json({ success: false, error: 'Attachment is not a file' });
    return;
  }
  if (!fs.existsSync(a.filePath)) {
    res.status(404).json({ success: false, error: 'File no longer exists on disk' });
    return;
  }
  res.setHeader('Content-Type', a.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${a.fileName || 'file'}"`);
  const stream = fs.createReadStream(a.filePath);
  stream.pipe(res);
});

/**
 * POST /api/v1/attachments/url — create a URL-type attachment
 */
router.post('/url', async (req: Request, res: Response) => {
  const { entityType, entityId, name, description, url, orgId } = req.body;
  if (!entityType || !entityId || !name || !url) {
    res.status(400).json({ success: false, error: 'entityType, entityId, name, and url are required' });
    return;
  }
  // Validate URL format
  try { new URL(url); } catch {
    res.status(400).json({ success: false, error: 'Invalid URL' });
    return;
  }

  const now = new Date().toISOString();
  const attachment: StoredAttachment = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    entityType,
    entityId,
    type: 'URL',
    name,
    description: description || '',
    url,
    uploadedBy: (req as any).user?.sub || null,
    createdAt: now,
    updatedAt: now,
  };
  await attachmentsRepo.create(attachment);
  auditService.log(attachment.orgId, attachment.uploadedBy, 'Attachment', attachment.id, 'CREATE', null, attachment);
  res.status(201).json({ success: true, data: attachment });
});

/**
 * POST /api/v1/attachments/upload?entityType=X&entityId=Y&filename=Z&name=W
 * Raw binary body. Returns the created attachment record.
 */
router.post(
  '/upload',
  raw({ type: '*/*', limit: `${MAX_FILE_SIZE_MB}mb` }),
  async (req: Request, res: Response) => {
    const { entityType, entityId, filename, name, description, orgId } = req.query;

    if (!entityType || !entityId) {
      res.status(400).json({ success: false, error: 'entityType and entityId query params are required' });
      return;
    }

    const rawName = typeof filename === 'string' ? filename : '';
    const safeName = path.basename(rawName).replace(/[^\w.\-]+/g, '_');
    if (!safeName) {
      res.status(400).json({ success: false, error: 'filename query parameter is required' });
      return;
    }

    const body = req.body;
    if (!body || !(body instanceof Buffer) || body.length === 0) {
      res.status(400).json({ success: false, error: 'Empty upload body' });
      return;
    }

    const mimeType = guessMimeType(safeName);
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      res.status(400).json({
        success: false,
        error: `File type '${mimeType}' not allowed. Allowed: PDF, Word, Excel, PowerPoint, TXT, CSV, MD, images (PNG/JPG/GIF/SVG/WebP), JSON.`,
      });
      return;
    }

    const attachmentId = uuid();
    const attachmentDir = path.join(ATTACHMENTS_ROOT, attachmentId);
    fs.mkdirSync(attachmentDir, { recursive: true });
    const absPath = path.join(attachmentDir, safeName);
    fs.writeFileSync(absPath, body);

    const now = new Date().toISOString();
    const attachment: StoredAttachment = {
      id: attachmentId,
      orgId: (orgId as string) || DEV_ORG_ID,
      entityType: entityType as string,
      entityId: entityId as string,
      type: 'FILE',
      name: (typeof name === 'string' && name) || safeName,
      description: (typeof description === 'string' && description) || '',
      fileName: safeName,
      filePath: absPath,
      fileSize: body.length,
      mimeType,
      uploadedBy: (req as any).user?.sub || null,
      createdAt: now,
      updatedAt: now,
    };
    await attachmentsRepo.create(attachment);
    auditService.log(attachment.orgId, attachment.uploadedBy, 'Attachment', attachment.id, 'CREATE', null, attachment);
    logger.info({ attachmentId, entityType, entityId, fileSize: body.length }, 'Attachment uploaded');
    res.status(201).json({ success: true, data: attachment });
  },
);

/** PUT /api/v1/attachments/:id — update name/description */
router.put('/:id', async (req: Request, res: Response) => {
  const a = attachments.find((x) => x.id === req.params.id);
  if (!a) { res.status(404).json({ success: false, error: 'Attachment not found' }); return; }

  // Layer-2: a CONTRIBUTOR may only edit attachments they uploaded.
  const putAssignErr = enforceAssignment((req as AuthenticatedRequest).user, a);
  if (putAssignErr) { res.status(putAssignErr.statusCode).json({ success: false, error: putAssignErr.message }); return; }

  const { name, description } = req.body;
  const patch: Partial<StoredAttachment> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  const updated = await attachmentsRepo.update(a.id, patch);
  res.json({ success: true, data: updated });
});

/** DELETE /api/v1/attachments/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = attachments.find((a) => a.id === req.params.id);
  if (!removed) { res.status(404).json({ success: false, error: 'Attachment not found' }); return; }

  // Layer-2: a CONTRIBUTOR may only delete attachments they uploaded.
  const delAssignErr = enforceAssignment((req as AuthenticatedRequest).user, removed);
  if (delAssignErr) { res.status(delAssignErr.statusCode).json({ success: false, error: delAssignErr.message }); return; }

  if (removed.type === 'FILE' && removed.filePath) {
    const dir = path.dirname(removed.filePath);
    if (dir.startsWith(ATTACHMENTS_ROOT) && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  await attachmentsRepo.delete(removed.id);
  auditService.log(removed.orgId, null, 'Attachment', removed.id, 'DELETE', removed, null);
  res.status(204).send();
});

export default router;
