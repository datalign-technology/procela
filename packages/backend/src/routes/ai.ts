import { Router, Request, Response } from 'express';
import { aiService } from '../services/ai.service';
// INDUSTRIES / Industry no longer imported — validation is
// free-form; the enum lives only on the frontend combobox as
// autocomplete hints.
import { loadStore, saveStore, registerStore } from '../lib/persistence';
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
registerStore('aiTemplateCache', aiTemplateCache);

/**
 * POST /api/v1/ai/generate-template
 * Generate an industry-specific (and optionally division-specific)
 * value stream hierarchy.
 *
 * Body: {
 *   industry: string,
 *   refresh?: boolean,
 *   // Optional division / department specialisation. When supplied,
 *   // the AI tailors the template to that sub-org instead of the
 *   // generic industry. Tidewater Electric gets SCADA / outage
 *   // management; Tidewater Water gets treatment plants / wastewater.
 *   orgName?: string,
 *   orgDescription?: string,
 *   orgType?: string,
 * }
 * Query: ?refresh=true (alt way to bypass the cache)
 * Returns: { success: true, data: <generated hierarchy>, cached: boolean, generatedAt: string, specializedFor?: string }
 */
router.post('/generate-template', async (req: Request, res: Response) => {
  try {
    const { industry, orgName, orgDescription, orgType } = req.body;
    const refresh = req.query.refresh === 'true' || req.body.refresh === true;

    // Free-form: any non-empty string is a valid industry. The
    // frontend combobox surfaces the INDUSTRIES enum as an
    // autocomplete list, but users can type long-tail values
    // (Biotech, Insurance Tech, Utilities Electric, …) and expect
    // them to flow through. The AI prompt handles arbitrary
    // industry strings gracefully — no lookup on the enum needed
    // downstream.
    if (typeof industry !== 'string' || !industry.trim()) {
      res.status(400).json({
        success: false,
        error: 'Industry is required. Pick from the list or type a custom value.',
      });
      return;
    }

    // Cache key includes the specialisation org name so each
    // division caches independently. Old industry-only entries
    // (key like "utilities") and new specialised entries (key like
    // "utilities|tidewater electric") coexist without colliding.
    const specialization = typeof orgName === 'string' && orgName.trim()
      ? { orgName: orgName.trim(), orgDescription: typeof orgDescription === 'string' ? orgDescription : undefined, orgType: typeof orgType === 'string' ? orgType : undefined }
      : undefined;
    const industryKey = String(industry).trim().toLowerCase();
    const key = specialization
      ? `${industryKey}|${specialization.orgName.toLowerCase()}`
      : industryKey;

    if (!refresh) {
      const hit = aiTemplateCache.find((c) => c.industry === key);
      if (hit) {
        logger.info({ industry, specialization: specialization?.orgName, cachedAt: hit.generatedAt }, 'Returning cached industry template');
        res.json({ success: true, data: hit.data, cached: true, generatedAt: hit.generatedAt, specializedFor: specialization?.orgName });
        return;
      }
    }

    const template = await aiService.generateIndustryTemplate(industry, specialization);
    const now = new Date().toISOString();
    const labelSuffix = specialization ? ` — ${specialization.orgName}` : '';
    const entry: CachedTemplate = {
      industry: key,
      industryLabel: `${industry}${labelSuffix}`,
      data: template,
      generatedAt: now,
    };
    const existingIdx = aiTemplateCache.findIndex((c) => c.industry === key);
    if (existingIdx >= 0) aiTemplateCache[existingIdx] = entry;
    else aiTemplateCache.push(entry);
    saveStore('aiTemplateCache', aiTemplateCache);
    logger.info({ industry, specialization: specialization?.orgName, refresh }, 'Cached fresh industry template');

    res.json({ success: true, data: template, cached: false, generatedAt: now, specializedFor: specialization?.orgName });
  } catch (err) {
    // Diagnose the common setup failures and surface a message the
    // admin can actually act on. The generic "please try again"
    // was hiding the two most likely causes (no key, bad key) so
    // users had no idea where to look. Full error stays in the log.
    const anyErr = err as { message?: string; status?: number; name?: string };
    const msg = String(anyErr?.message || '');
    const status = anyErr?.status;
    logger.error({ err, status, name: anyErr?.name }, 'Template generation failed');
    let userError: string;
    let httpStatus = 500;
    if (msg.includes('ANTHROPIC_API_KEY') || msg.includes('is not set')) {
      userError = 'AI is not configured on this server. Add ANTHROPIC_API_KEY to your backend .env file and restart the backend.';
      httpStatus = 503;
    } else if (status === 401 || msg.toLowerCase().includes('authentication')) {
      userError = 'The configured Anthropic API key was rejected. Verify ANTHROPIC_API_KEY is a valid key with template-generation access.';
      httpStatus = 503;
    } else if (status === 429 || msg.toLowerCase().includes('rate limit')) {
      userError = 'Anthropic rate limit reached. Wait a minute and try again.';
      httpStatus = 503;
    } else if (status && status >= 500) {
      userError = 'Anthropic API is temporarily unavailable. Try again in a moment.';
      httpStatus = 502;
    } else if (anyErr?.name === 'AiParseError' || msg.includes('parse') || msg.includes('JSON')) {
      userError = 'The AI returned a response that could not be parsed. Try again; if it keeps failing, the configured model may need updating (ANTHROPIC_MODEL).';
      httpStatus = 502;
    } else {
      userError = `Template generation failed: ${msg || 'unknown error'}. Check the backend log for details.`;
    }
    res.status(httpStatus).json({ success: false, error: userError });
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
