import { Router, Request, Response } from 'express';
import config from '../config';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v1/health/config
 * Returns configuration status flags (no secrets exposed).
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    aiConfigured: Boolean(config.anthropicApiKey),
  });
});

export default router;
