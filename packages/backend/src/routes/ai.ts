import { Router, Request, Response } from 'express';
import { aiService } from '../services/ai.service';
import { INDUSTRIES, Industry } from '../types';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

const router = Router();

// Cached AI-generated industry templates. The wizard's output is
// indistinguishable run-to-run for a given industry — Claude
// produces minor wording variations but the shape and content are
// stable. Caching saves the 10–30 second AI round-trip and the
// per-call cost, and gives a consistent template across runs so
// two users picking "Utilities" land on the same starting catalog.
//
// Persisted to .procela-data/aiTemplateCache.json so the cache
// survives restarts. Keyed by lower-cased industry name; a
// refresh=true query param or body flag bypasses the cache and
// re-generates fresh. The DELETE endpoints below bust the cache
// when a customer wants a different sample.
interface CachedTemplate {
  /** Lower-cased industry name, used as the cache key. */
  industry: string;
  /** Original casing, used for display. */
  industryLabel: string;
  /** Raw template payload that gets returned by GET — same shape
   *  the wizard already consumes. */
  data: any;
  generatedAt: string;
}
const aiTemplateCache: CachedTemplate[] = loadStore<CachedTemplate>('aiTemplateCache');

/**
 * POST /api/v1/ai/generate-template
 * Generate an industry-specific value stream hierarchy.
 *
 * Body: { industry: string, refresh?: boolean }
 * Query: ?refresh=true (alt way to bypass the cache)
 * Returns: { success: true, data: <generated hierarchy>, cached: boolean, generatedAt: string }
 */
router.post('/generate-template', async (req: Request, res: Response) => {
  try {
    const { industry } = req.body;
    const refresh = req.query.refresh === 'true' || req.body.refresh === true;

    if (!industry || !INDUSTRIES.includes(industry as Industry)) {
      res.status(400).json({
        success: false,
        error: `Invalid industry. Must be one of: ${INDUSTRIES.join(', ')}`,
      });
      return;
    }

    const key = String(industry).trim().toLowerCase();

    if (!refresh) {
      const hit = aiTemplateCache.find((c) => c.industry === key);
      if (hit) {
        logger.info({ industry, cachedAt: hit.generatedAt }, 'Returning cached industry template');
        res.json({ success: true, data: hit.data, cached: true, generatedAt: hit.generatedAt });
        return;
      }
    }

    const template = await aiService.generateIndustryTemplate(industry);
    const now = new Date().toISOString();
    const entry: CachedTemplate = { industry: key, industryLabel: industry, data: template, generatedAt: now };
    const existingIdx = aiTemplateCache.findIndex((c) => c.industry === key);
    if (existingIdx >= 0) aiTemplateCache[existingIdx] = entry;
    else aiTemplateCache.push(entry);
    saveStore('aiTemplateCache', aiTemplateCache);
    logger.info({ industry, refresh }, 'Cached fresh industry template');

    res.json({ success: true, data: template, cached: false, generatedAt: now });
  } catch (err) {
    logger.error({ err }, 'Template generation failed');
    res.status(500).json({
      success: false,
      error: 'Failed to generate industry template. Please try again.',
    });
  }
});

/** GET /api/v1/ai/template-cache — list cached industries. */
router.get('/template-cache', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: aiTemplateCache.map((c) => ({ industry: c.industryLabel, generatedAt: c.generatedAt })),
  });
});

/** DELETE /api/v1/ai/template-cache/:industry — bust one entry. */
router.delete('/template-cache/:industry', (req: Request, res: Response) => {
  const raw = req.params.industry;
  const key = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  const idx = aiTemplateCache.findIndex((c) => c.industry === key);
  if (idx >= 0) {
    aiTemplateCache.splice(idx, 1);
    saveStore('aiTemplateCache', aiTemplateCache);
    logger.info({ industry: key }, 'Cleared industry template cache entry');
  }
  res.json({ success: true });
});

/** DELETE /api/v1/ai/template-cache — bust every entry. */
router.delete('/template-cache', (_req: Request, res: Response) => {
  const cleared = aiTemplateCache.length;
  aiTemplateCache.length = 0;
  saveStore('aiTemplateCache', aiTemplateCache);
  logger.info({ cleared }, 'Cleared entire industry template cache');
  res.json({ success: true, cleared });
});

export default router;
