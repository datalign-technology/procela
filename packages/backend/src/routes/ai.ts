import { Router, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { currentUsage } from '../middleware/ai-budget';
import { isEnabled as aiUsageEnabled, getConfiguredLimits } from '../services/ai-usage';
import { aiService, getConfiguredModel, setModelOverride, getActiveProvider, getAiServiceForOrg, probeAiForOrg } from '../services/ai.service';
import { getOrgAiConfigView, setOrgAiConfig, OrgAiConfigError } from '../services/org-ai-config';
import { requirePermission } from '../lib/permissions';
import { isEncryptionConfigured } from '../services/crypto.service';
// INDUSTRIES / Industry no longer imported — validation is
// free-form; the enum lives only on the frontend combobox as
// autocomplete hints.
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { settingsRepo } from '../stores/app-settings';
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
export const aiTemplateCache: CachedTemplate[] = loadStore<CachedTemplate>('aiTemplateCache');
registerStore('aiTemplateCache', aiTemplateCache);

// Persisted admin override for the Anthropic model. Wins over the
// ANTHROPIC_MODEL env var so ops can bump the model from the UI
// (Settings → AI) without redeploying. Reloaded into the service
// module at boot in index.ts; changes here call setModelOverride
// so the running service picks them up immediately.
interface StoredAiSettings { model?: string; updatedAt?: string; updatedBy?: string | null }
// The AI model override persists through the shared AppSetting table (key
// "aiSettings") — Postgres when DATABASE_URL is set, appSettings.json
// otherwise. PR 7.
// Rehydrate the in-memory override from persistence. Called once at
// module load (fire-and-forget) and re-callable from the startup ping.
export async function rehydrateAiOverride(): Promise<void> {
  const s = (await settingsRepo.get<StoredAiSettings>('aiSettings')) ?? {};
  setModelOverride(s.model || null);
}
rehydrateAiOverride().catch((err) => logger.warn({ err }, 'rehydrateAiOverride failed'));

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
  const { industry, orgName, orgDescription, orgType } = req.body;
  const refresh = req.query.refresh === 'true' || req.body.refresh === true;

  // Free-form: any non-empty string is a valid industry. The
  // frontend combobox surfaces the INDUSTRIES enum as an
  // autocomplete list, but users can type long-tail values
  // (Biotech, Insurance Tech, Utilities Electric, …) and expect
  // them to flow through. The AI prompt handles arbitrary
  // industry strings gracefully — no lookup on the enum needed
  // downstream. Validation failures still return a plain JSON 400
  // — SSE only kicks in once we know we're going to stream.
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

  // From here on we speak SSE. Set the headers up front so the
  // client can start reading immediately — no waiting for the AI
  // to respond before the socket becomes writable. flushHeaders()
  // matters: without it Express buffers until the first res.write,
  // so a cache hit fires an event immediately but a fresh call
  // would stall for a second or two before the browser saw
  // anything.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // defeat nginx/CDN buffering
  res.flushHeaders?.();

  const emit = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    if (!refresh) {
      const hit = aiTemplateCache.find((c) => c.industry === key);
      if (hit) {
        logger.info({ industry, specialization: specialization?.orgName, cachedAt: hit.generatedAt }, 'Returning cached industry template');
        // Cache hits still go over SSE for symmetry — the frontend
        // has one code path, and the "done" event carries the
        // same shape whether the payload came from Claude or from
        // disk. `cached: true` lets the UI skip the progress bar
        // animation and jump straight to the review screen.
        emit({ type: 'done', data: hit.data, cached: true, generatedAt: hit.generatedAt, specializedFor: specialization?.orgName });
        res.end();
        return;
      }
    }

    // Stream from Anthropic. Each `progress` event carries the
    // running char count — the frontend divides by an estimated
    // total (~55K chars for a full 5×5×6 hierarchy) to drive a
    // real progress bar. Anything unusually verbose overshoots
    // gracefully — the bar caps at ~95% until the `done` event
    // lands.
    let template: object | null = null;
    const svc = await getAiServiceForOrg((req as AuthenticatedRequest).user?.orgId);
    for await (const evt of svc.generateIndustryTemplateStream(industry, specialization)) {
      if (evt.type === 'progress') {
        emit({ type: 'progress', chars: evt.chars });
      } else if (evt.type === 'done') {
        template = evt.data;
      }
    }
    if (!template) throw new Error('AI stream ended without a done event');

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

    emit({ type: 'done', data: template, cached: false, generatedAt: now, specializedFor: specialization?.orgName });
    res.end();
  } catch (err) {
    // Same diagnosis ladder as the non-streaming version — we lose
    // the ability to set a proper HTTP status here (headers are
    // already flushed) so the user-facing error type rides on the
    // SSE `error` event instead. The frontend surfaces it in the
    // same red-banner slot the fetch failure would have.
    const anyErr = err as { message?: string; status?: number; name?: string; rawResponse?: string };
    const msg = String(anyErr?.message || '');
    const status = anyErr?.status;
    const rawPreview = typeof anyErr?.rawResponse === 'string'
      ? anyErr.rawResponse.slice(0, 500)
      : undefined;
    logger.error({ err, status, name: anyErr?.name, rawPreview, model: config.anthropicModel }, 'Template generation failed');
    let userError: string;
    if (msg.includes('ANTHROPIC_API_KEY') || msg.includes('is not set')) {
      userError = 'AI is not configured on this server. Add ANTHROPIC_API_KEY to your backend .env file and restart the backend.';
    } else if (status === 401 || msg.toLowerCase().includes('authentication')) {
      userError = 'The configured Anthropic API key was rejected. Verify ANTHROPIC_API_KEY is a valid key with template-generation access.';
    } else if (status === 429 || msg.toLowerCase().includes('rate limit')) {
      userError = 'Anthropic rate limit reached. Wait a minute and try again.';
    } else if (status && status >= 500) {
      userError = 'Anthropic API is temporarily unavailable. Try again in a moment.';
    } else if (anyErr?.name === 'AiParseError' || msg.includes('parse') || msg.includes('JSON') || msg.includes('Empty response')) {
      userError = `The AI returned no parseable content (model: ${config.anthropicModel}). Most likely the configured model ID is wrong or unavailable to this API key. Update ANTHROPIC_MODEL and restart, or check the backend log — the raw preview is included.`;
    } else {
      userError = `Template generation failed: ${msg || 'unknown error'}. Check the backend log for details.`;
    }
    emit({ type: 'error', error: userError });
    res.end();
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
router.get('/settings', async (_req: Request, res: Response) => {
  const s = (await settingsRepo.get<StoredAiSettings>('aiSettings')) ?? {};
  const overrideModel = s.model || null;
  const provider = config.aiProvider;
  // Report the ACTIVE provider's model env + credential, so the Settings UI
  // reflects whatever vendor AI_PROVIDER selects rather than always Anthropic.
  const providerInfo: { envModel: string | null; defaultModel: string; credConfigured: boolean } =
    provider === 'openai' || provider === 'azure' || provider === 'azure-openai'
      ? { envModel: process.env.OPENAI_MODEL || null, defaultModel: config.openaiModel, credConfigured: !!(config.openaiApiKey || config.openaiBaseUrl) }
    : provider === 'gemini' || provider === 'google'
      ? { envModel: process.env.GEMINI_MODEL || null, defaultModel: config.geminiModel, credConfigured: !!config.geminiApiKey }
    : provider === 'bedrock' || provider === 'aws'
      ? { envModel: process.env.BEDROCK_MODEL || null, defaultModel: config.bedrockModel, credConfigured: true }
    : { envModel: process.env.ANTHROPIC_MODEL || null, defaultModel: config.anthropicModel, credConfigured: !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY) };
  const source: 'override' | 'env' | 'default' =
    overrideModel ? 'override' : providerInfo.envModel ? 'env' : 'default';
  res.json({
    success: true,
    data: {
      provider,
      resolvedModel: getConfiguredModel(),
      overrideModel,
      envModel: providerInfo.envModel,
      defaultModel: providerInfo.defaultModel,
      source,
      apiKeyConfigured: providerInfo.credConfigured,
      updatedAt: s.updatedAt || null,
      updatedBy: s.updatedBy || null,
    },
  });
});

/** PUT /api/v1/ai/settings — persist a model override. Sending
 *  `{ model: '' }` or `{ model: null }` clears the override and
 *  falls back to the env var / default. */
router.put('/settings', async (req: Request, res: Response) => {
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const updatedBy = (req as { user?: { sub?: string } }).user?.sub || null;
  const now = new Date().toISOString();
  const next: StoredAiSettings = model
    ? { model, updatedAt: now, updatedBy }
    : { updatedAt: now, updatedBy };
  await settingsRepo.set<StoredAiSettings>('aiSettings', next, updatedBy);
  setModelOverride(model || null);
  logger.info({ model, updatedBy }, 'AI model override updated');
  res.json({ success: true, data: { resolvedModel: getConfiguredModel() } });
});

/** GET /api/v1/ai/models — list every model the current API key
 *  can access, straight from Anthropic. Used by the Settings UI
 *  as the source of truth (no hardcoded ID lists to drift). */
router.get('/models', async (_req: Request, res: Response) => {
  // Only Anthropic exposes a stable "list models the key can access" endpoint
  // that we mirror as the picker's source of truth. For the other providers
  // there's no universal model-list API, so surface the single configured
  // model — the admin sets the exact id via <PROVIDER>_MODEL / Settings → AI.
  if (config.aiProvider !== 'anthropic') {
    res.json({ success: true, data: [{ id: getConfiguredModel() }] });
    return;
  }
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
 *  resolved model, THROUGH the active provider's adapter, so it validates
 *  whatever vendor AI_PROVIDER selects with one code path. Used by the
 *  "Test now" button and mirrors the boot probe in index.ts. Returns
 *  { ok, provider, model, message } — never throws upstream errors, since a
 *  red badge is the point. */
router.post('/test', async (_req: Request, res: Response) => {
  const model = getConfiguredModel();
  const provider = config.aiProvider;
  try {
    await getActiveProvider().complete({
      model,
      system: '',
      messages: [{ role: 'user', content: 'ok' }],
      maxTokens: 1,
    });
    res.json({ success: true, data: { ok: true, provider, model, message: 'Model reachable.' } });
  } catch (err) {
    const msg = (err as { message?: string })?.message || 'unknown error';
    res.json({ success: true, data: { ok: false, provider, model, message: msg } });
  }
});

// ── Per-tenant AI provider config (multi-vendor, phase 3) ─────────────────
//
// These let each org bring its own vendor + model + key, overriding the
// deployment default. The key is encrypted at rest and never returned — reads
// expose only `apiKeyConfigured`. The deployment default is echoed so the UI
// can show what an org falls back to when it has no config of its own.

/** GET /api/v1/ai/org-config — the caller's org AI config + the deployment
 *  default it falls back to. Readable by any authenticated user (no secrets). */
router.get('/org-config', async (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    res.status(400).json({ success: false, error: 'No organization in context.' });
    return;
  }
  const orgConfig = await getOrgAiConfigView(orgId);
  res.json({
    success: true,
    data: {
      orgConfig,
      // The deployment fallback — what this org uses when its own config is
      // absent or disabled.
      deploymentDefault: { provider: config.aiProvider, model: getConfiguredModel() },
      // Whether at-rest encryption is active — the UI warns when a key would
      // be stored in plaintext.
      encryptionConfigured: isEncryptionConfigured(),
    },
  });
});

/** PUT /api/v1/ai/org-config — set the caller's org AI config. Admin-only
 *  (org:write). Body: { provider?, model?, baseUrl?, region?, apiKey?, enabled? }.
 *  `apiKey: ''`/null clears the stored key; a string is encrypted. The key is
 *  never echoed back. */
router.put('/org-config', requirePermission('org:write'), async (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.user?.orgId;
  if (!orgId) {
    res.status(400).json({ success: false, error: 'No organization in context.' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null | undefined =>
    v === undefined ? undefined : v === null ? null : typeof v === 'string' ? v : undefined;
  try {
    const view = await setOrgAiConfig(
      orgId,
      {
        provider: str(b.provider),
        model: str(b.model),
        baseUrl: str(b.baseUrl),
        region: str(b.region),
        apiKey: str(b.apiKey),
        enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
      },
      req.user?.sub || null,
    );
    logger.info({ orgId, provider: view.provider, updatedBy: req.user?.sub }, 'Org AI config updated');
    res.json({ success: true, data: view });
  } catch (err) {
    if (err instanceof OrgAiConfigError) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

/** POST /api/v1/ai/org-config/test — probe the vendor the caller's org will
 *  actually use (its own config, or the deployment fallback). */
router.post('/org-config/test', async (req: AuthenticatedRequest, res: Response) => {
  const result = await probeAiForOrg(req.user?.orgId);
  res.json({ success: true, data: result });
});

/** GET /api/v1/ai/usage — the caller's org's current per-hour and
 *  per-day AI call counts against the configured ceiling. Cheap
 *  observability so an operator can see "how much AI budget did we
 *  burn today?" without instrumenting the log stream. */
router.get('/usage', (req: AuthenticatedRequest, res: Response) => {
  const status = currentUsage(req);
  const limits = getConfiguredLimits();
  res.json({
    success: true,
    data: {
      enabled: aiUsageEnabled(),
      orgId: req.user?.orgId ?? null,
      status,
      limits,
    },
  });
});

export default router;
