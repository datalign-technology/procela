import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import config from '../config';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import logger from '../lib/logger';

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

/**
 * POST /api/v1/auth/login
 * Dev-mode login: accepts { email, name } and returns a JWT.
 */
router.post('/login', (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email) {
    res.status(400).json({ success: false, error: 'Email is required' });
    return;
  }

  const payload = {
    sub: uuid(),
    email,
    name: name || email,
    orgId: DEV_ORG_ID,
    role: 'ORG_ADMIN',
  };

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });

  logger.info({ email }, 'Dev login successful');

  res.json({
    success: true,
    data: {
      token,
      user: payload,
    },
  });
});

/**
 * GET /api/v1/auth/me
 * Returns the current user from the JWT token.
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    data: req.user,
  });
});

export default router;
