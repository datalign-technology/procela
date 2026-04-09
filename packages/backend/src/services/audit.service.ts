import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: object | null;
  after: object | null;
  timestamp: string;
}

// Persistent audit log (replace with Prisma when DB is connected)
export const auditLogs: AuditLogEntry[] = loadStore<AuditLogEntry>('auditLogs');

export const auditService = {
  log(
    orgId: string,
    userId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    before: object | null = null,
    after: object | null = null
  ): void {
    const entry: AuditLogEntry = {
      id: uuid(),
      orgId,
      userId,
      entityType,
      entityId,
      action,
      before,
      after,
      timestamp: new Date().toISOString(),
    };
    auditLogs.push(entry);
    saveStore('auditLogs', auditLogs);
    logger.info({ entityType, entityId, action }, `[Audit] ${action} ${entityType}`);
  },

  getAll(orgId?: string): AuditLogEntry[] {
    return orgId ? auditLogs.filter((l) => l.orgId === orgId) : auditLogs;
  },

  getByEntity(entityType: string, entityId: string): AuditLogEntry[] {
    return auditLogs.filter((l) => l.entityType === entityType && l.entityId === entityId);
  },
};
