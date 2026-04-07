import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit.service';

const router = Router();

/** GET /api/v1/audit — list audit log entries */
router.get('/', (req: Request, res: Response) => {
  const { entityType, entityId, limit } = req.query;
  let entries = auditService.getAll();

  if (entityType && entityId) {
    entries = auditService.getByEntity(entityType as string, entityId as string);
  } else if (entityType) {
    entries = entries.filter((e) => e.entityType === entityType);
  }

  const max = limit ? parseInt(limit as string, 10) : 100;
  entries = entries.slice(-max).reverse(); // most recent first

  res.json({ success: true, data: entries });
});

export default router;
