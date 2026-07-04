import { Router, Request, Response } from 'express';
import { aiService, getConfiguredModel, setModelOverride } from '../services/ai.service';
// INDUSTRIES / Industry no longer imported — validation is
// free-form; the enum lives only on the frontend combobox as
// autocomplete hints.
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';
import config from '../config';

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

// Persisted admin override for the Anthropic model. Wins over the
// ANTHROPIC_MODEL env var so ops can bump the model from the UI
// (Settings → AI) without redeploying. Reloaded into the service
// module at boot in index.ts; changes here call setModelOverride
// so the running service picks them up immediately.
interface StoredAiSettings { model?: string; updatedAt?: string; updatedBy?: string | null }
const aiSettingsStore: StoredAiSettings[] = loadStore<StoredAiSettings>('aiSettings');
registerStore('aiSettings', aiSettingsStore);
function currentSettings(): StoredAiSettings {
  return aiSettingsStore[0] || {};
}
// Rehydrate the in-memory override from disk. Called once at
// module load; also re-called by the startup ping in index.ts to
// ensure the order is deterministic regardless of import timing.
export function rehydrateAiOverride(): void {
  const s = currentSettings();
  setModelOverride(s.model || null);
}
rehydrateAiOverride();

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
    const anyErr = err as { message?: string; status?: number; name?: string; rawResponse?: string };
    const msg = String(anyErr?.message || '');
    const status = anyErr?.status;
    // Log the raw-ish response on parse failures so a maintainer
    // can see exactly what the model produced. Truncated to 500
    // chars to keep the log line human-readable.
    const rawPreview = typeof anyErr?.rawResponse === 'string'
      ? anyErr.rawResponse.slice(0, 500)
      : undefined;
    logger.error({ err, status, name: anyErr?.name, rawPreview, model: config.anthropicModel }, 'Template generation failed');
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
    } else if (anyErr?.name === 'AiParseError' || msg.includes('parse') || msg.includes('JSON') || msg.includes('Empty response')) {
      userError = `The AI returned no parseable content (model: ${config.anthropicModel}). Most likely the configured model ID is wrong or unavailable to this API key. Update ANTHROPIC_MODEL and restart, or check the backend log — the raw preview is included.`;
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

// ── Model management (Settings → AI) ────────────────────────────────

interface AnthropicModel {
  id: string;
  display_name?: string;
  created_at?: string;
  type?: string;
}

/** GET /api/v1/ai/settings — current model config the UI reads.
 *  `source` tells the admin where the resolved value came from so
 *  they know what to change to override it. */
router.get('/settings', (_req: Request, res: Response) => {
  const s = currentSettings();
  const overrideModel = s.model || null;
  const envModel = process.env.ANTHROPIC_MODEL || null;
  const resolved = getConfiguredModel();
  const source: 'override' | 'env' | 'default' =
    overrideModel ? 'override' : envModel ? 'env' : 'default';
  res.json({
    success: true,
    data: {
      resolvedModel: resolved,
      overrideModel,
      envModel,
      defaultModel: config.anthropicModel,
      source,
      apiKeyConfigured: !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      updatedAt: s.updatedAt || null,
      updatedBy: s.updatedBy || null,
    },
  });
});

/** PUT /api/v1/ai/settings — persist a model override. Sending
 *  `{ model: '' }` or `{ model: null }` clears the override and
 *  falls back to the env var / default. */
router.put('/settings', (req: Request, res: Response) => {
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const updatedBy = (req as { user?: { sub?: string } }).user?.sub || null;
  const now = new Date().toISOString();
  const next: StoredAiSettings = model
    ? { model, updatedAt: now, updatedBy }
    : { updatedAt: now, updatedBy };
  aiSettingsStore.length = 0;
  aiSettingsStore.push(next);
  saveStore('aiSettings', aiSettingsStore);
  setModelOverride(model || null);
  logger.info({ model, updatedBy }, 'AI model override updated');
  res.json({ success: true, data: { resolvedModel: getConfiguredModel() } });
});

/** GET /api/v1/ai/models — list every model the current API key
 *  can access, straight from Anthropic. Used by the Settings UI
 *  as the source of truth (no hardcoded ID lists to drift). */
router.get('/models', async (_req: Request, res: Response) => {
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ success: false, error: 'Anthropic API key is not configured.' });
    return;
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      res.status(upstream.status).json({
        success: false,
        error: `Anthropic returned ${upstream.status}: ${text.slice(0, 300)}`,
      });
      return;
    }
    const payload = await upstream.json() as { data?: AnthropicModel[] };
    const models = Array.isArray(payload?.data) ? payload.data : [];
    res.json({ success: true, data: models });
  } catch (err) {
    logger.error({ err }, 'Failed to list Anthropic models');
    res.status(502).json({ success: false, error: 'Could not reach Anthropic to list models. Check network + API key.' });
  }
});

/** POST /api/v1/ai/test — one-token probe against the currently-
 *  resolved model. Used by the "Test now" button and by the boot
 *  ping in index.ts. Returns { ok, model, message } — never
 *  throws upstream errors, since a red badge is the point. */
router.post('/test', async (_req: Request, res: Response) => {
  const model = getConfiguredModel();
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    res.json({ success: true, data: { ok: false, model, message: 'ANTHROPIC_API_KEY is not set.' } });
    return;
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });
    if (upstream.ok) {
      res.json({ success: true, data: { ok: true, model, message: 'Model reachable.' } });
      return;
    }
    const text = await upstream.text().catch(() => '');
    res.json({
      success: true,
      data: {
        ok: false,
        model,
        message: `Anthropic returned ${upstream.status}: ${text.slice(0, 250)}`,
      },
    });
  } catch (err) {
    const msg = (err as { message?: string })?.message || 'unknown error';
    res.json({ success: true, data: { ok: false, model, message: `Network error: ${msg}` } });
  }
});

export default router;
