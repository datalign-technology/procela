import { Router, Request, Response } from 'express';
import { aiService } from '../services/ai.service';
import { INDUSTRIES, Industry } from '../types';
import logger from '../lib/logger';

const router = Router();

/**
 * POST /api/v1/ai/generate-template
 * Generate an industry-specific value stream hierarchy.
 *
 * Body: { industry: string }
 * Returns: { success: true, data: <generated hierarchy> }
 */
router.post('/generate-template', async (req: Request, res: Response) => {
  try {
    const { industry } = req.body;

    if (!industry || !INDUSTRIES.includes(industry as Industry)) {
      res.status(400).json({
        success: false,
        error: `Invalid industry. Must be one of: ${INDUSTRIES.join(', ')}`,
      });
      return;
    }

    const template = await aiService.generateIndustryTemplate(industry);

    res.json({ success: true, data: template });
  } catch (err) {
    logger.error({ err }, 'Template generation failed');
    res.status(500).json({
      success: false,
      error: 'Failed to generate industry template. Please try again.',
    });
  }
});

export default router;
