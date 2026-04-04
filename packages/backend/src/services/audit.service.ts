import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuditLogEntry {
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: object | null;
  after?: object | null;
}

export const auditService = {
  /**
   * Write an entry to the audit log.
   */
  async log(
    orgId: string,
    userId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    before: object | null = null,
    after: object | null = null
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        entityType,
        entityId,
        action,
        before: before ?? undefined,
        after: after ?? undefined,
      },
    });
  },
};
