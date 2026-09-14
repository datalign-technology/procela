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
  // "Configured" means the ACTIVE provider (AI_PROVIDER) has its credential
  // — so a deployment on OpenAI/Gemini/Bedrock reports correctly, not only
  // one on Anthropic. Bedrock uses the AWS credential chain, so it's treated
  // as configured (validated at call time / by the boot probe instead).
  const p = config.aiProvider;
  const aiConfigured =
    p === 'openai' || p === 'azure' || p === 'azure-openai'
      ? Boolean(config.openaiApiKey || config.openaiBaseUrl)
    : p === 'gemini' || p === 'google'
      ? Boolean(config.geminiApiKey)
    : p === 'bedrock' || p === 'aws'
      ? true
      : Boolean(config.anthropicApiKey);
  res.json({
    aiConfigured,
    aiProvider: p,
    // Master switch for AI integration features. When false the frontend
    // hides every AI surface and the backend refuses the AI endpoints.
    aiFeaturesEnabled: config.aiFeaturesEnabled,
  });
});

export default router;
