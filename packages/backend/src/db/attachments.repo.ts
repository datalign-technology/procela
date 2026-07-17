// Attachments repository — scalar-only shape, entity-agnostic
// (entityType + entityId) join to whatever it hangs off. FILE and URL
// variants share the same row shape; the file-specific columns stay
// nullable so a URL attachment doesn't need placeholders.

import type { StoredAttachment } from '../routes/attachments';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonAttachmentsRepository(store: StoredAttachment[]): Repository<StoredAttachment> {
  return jsonRepository<StoredAttachment>(store, () => saveStore('attachments', store));
}

type PrismaAttachmentRow = {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  type: string;
  name: string;
  description: string | null;
  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  url: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaAttachmentDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaAttachmentRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAttachmentRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAttachmentRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAttachmentRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAttachmentRow>;
}

function fromPrisma(r: PrismaAttachmentRow): StoredAttachment {
  return {
    id: r.id,
    orgId: r.orgId,
    entityType: r.entityType,
    entityId: r.entityId,
    type: r.type as StoredAttachment['type'],
    name: r.name,
    description: r.description ?? '',
    ...(r.fileName ? { fileName: r.fileName } : {}),
    ...(r.filePath ? { filePath: r.filePath } : {}),
    ...(r.fileSize !== null ? { fileSize: r.fileSize } : {}),
    ...(r.mimeType ? { mimeType: r.mimeType } : {}),
    ...(r.url ? { url: r.url } : {}),
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredAttachment>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.entityType !== undefined) d.entityType = row.entityType;
  if (row.entityId !== undefined) d.entityId = row.entityId;
  if (row.type !== undefined) d.type = row.type;
  if (row.name !== undefined) d.name = row.name;
  if (row.description !== undefined) d.description = row.description || null;
  if (row.fileName !== undefined) d.fileName = row.fileName || null;
  if (row.filePath !== undefined) d.filePath = row.filePath || null;
  if (row.fileSize !== undefined) d.fileSize = row.fileSize ?? null;
  if (row.mimeType !== undefined) d.mimeType = row.mimeType || null;
  if (row.url !== undefined) d.url = row.url || null;
  if (row.uploadedBy !== undefined) d.uploadedBy = row.uploadedBy;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAttachmentsRepository(
  clientFactory: () => { attachment: PrismaAttachmentDelegate } = getPrisma as unknown as () => { attachment: PrismaAttachmentDelegate },
): Repository<StoredAttachment> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.attachment.findMany({ where: { orgId: filter.orgId } })
        : await client.attachment.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.attachment.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.attachment.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.attachment.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.attachment.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAttachmentsRepository(store: StoredAttachment[]): Repository<StoredAttachment> {
  return hasDatabase()
    ? prismaAttachmentsRepository()
    : jsonAttachmentsRepository(store);
}
