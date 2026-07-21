import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { organizations } from './organizations';
import { settingsRepo } from '../stores/app-settings';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Branding — per-deployment theming (company name, logo, colors). A single
// config document, stored in `.procela-data/branding.json` via the same
// persistence helper other routes use (we fake it as a 1-element array).
//
// GET /api/v1/branding   — public. The login screen needs it too, so this
//                          route is mounted before the auth middleware.
// PUT /api/v1/branding   — auth'd; any signed-in user can update for now.
//                          Tighten to SUPER_ADMIN / ORG_ADMIN when roles
//                          propagate further through the app.
//
// Logo is stored as either an http(s) URL or a data: URL (base64 inline).
// The latter lets customers upload without a file-server. We cap payload
// size via a route-level json body limit — see index.ts.
// ──────────────────────────────────────────────────────────────────────────

export interface BrandingConfig {
  companyName: string;
  logoUrl: string;
  primaryColor: string;
  primaryHoverColor: string;
  primaryLightColor: string;
  sidebarColor: string;
  sidebarHoverColor: string;
  updatedAt: string;
  updatedBy: string | null;
}

const DEFAULT_BRANDING: BrandingConfig = {
  companyName:        'Procela',
  logoUrl:            '/procela-icon.png',
  primaryColor:       '#1a7a6d',
  primaryHoverColor:  '#15655a',
  primaryLightColor:  '#d1f0eb',
  sidebarColor:       '#0f172a',
  sidebarHoverColor:  '#1e293b',
  updatedAt:          new Date(0).toISOString(),
  updatedBy:          null,
};

// Branding persists through the shared AppSetting table (key "branding") —
// Postgres when DATABASE_URL is set, appSettings.json otherwise. The active
// config is held in-memory (`current`) so the public GET stays synchronous;
// it's hydrated at boot via initBranding() and updated on every write. PR 7.
let current: BrandingConfig = { ...DEFAULT_BRANDING };

async function persist() {
  await settingsRepo.set<BrandingConfig>('branding', current, current.updatedBy);
}

/** Hydrate the in-memory branding config from persistence at boot. */
export async function initBranding(): Promise<void> {
  const stored = await settingsRepo.get<BrandingConfig>('branding');
  if (stored) current = { ...DEFAULT_BRANDING, ...stored };
}

function isHex(s: unknown): s is string {
  return typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
}

function isValidLogo(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (s === '') return true;  // blank = use the default
  if (s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('data:image/')) return true;
  return false;
}

const router = Router();

// GET is public — callers include the login page and every unauthenticated
// bootstrap flow. We redact the `updatedBy` field to avoid leaking user
// identifiers to anonymous clients.
router.get('/', (_req: Request, res: Response) => {
  const { updatedBy: _ub, ...publicFields } = current;
  res.json({ success: true, data: publicFields });
});

// PUT is auth'd. Validates each field before writing.
router.put('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body || {};
  const next: BrandingConfig = { ...current };

  if ('companyName' in body) {
    if (typeof body.companyName !== 'string' || body.companyName.length > 80) {
      res.status(400).json({ success: false, error: 'companyName must be a string up to 80 chars' });
      return;
    }
    next.companyName = body.companyName.trim() || DEFAULT_BRANDING.companyName;
  }

  if ('logoUrl' in body) {
    if (!isValidLogo(body.logoUrl)) {
      res.status(400).json({ success: false, error: 'logoUrl must be a URL, path, or data: URL' });
      return;
    }
    next.logoUrl = (body.logoUrl as string) || DEFAULT_BRANDING.logoUrl;
  }

  const colorFields: Array<keyof BrandingConfig> = [
    'primaryColor', 'primaryHoverColor', 'primaryLightColor',
    'sidebarColor', 'sidebarHoverColor',
  ];
  for (const k of colorFields) {
    if (k in body) {
      if (!isHex(body[k])) {
        res.status(400).json({ success: false, error: `${k} must be a hex color (e.g. #1a7a6d)` });
        return;
      }
      (next as any)[k] = body[k];
    }
  }

  next.updatedAt = new Date().toISOString();
  next.updatedBy = req.user?.email || req.user?.sub || null;

  current = next;
  await persist();
  logger.info({ by: next.updatedBy, company: next.companyName }, 'Branding updated');

  const { updatedBy: _ub, ...publicFields } = current;
  res.json({ success: true, data: publicFields });
});

// ── Per-tenant login branding ─────────────────────────────────────────
// Composes the deployment defaults (above) with the tenant's org-
// specific branding fields so the login screen can render as the
// customer's brand before any sign-in has happened. Public — the
// login page needs it before the user has a token.
//
// Tenant slug resolves from, in order:
//   1. path param       — GET /tenant/:slug
//   2. query param      — GET /tenant?tenant=<slug>
//   3. Host header      — first subdomain label (production wildcard)
//
// Unknown / missing slug → the deployment defaults, marked
// `isTenantBrand: false` so the client can decide whether to show a
// "not your tenant?" affordance.

function resolveTenantSlug(req: Request): string | null {
  const p = (req.params?.slug || '').toString().trim().toLowerCase();
  if (p) return p;
  const q = (req.query?.tenant || '').toString().trim().toLowerCase();
  if (q) return q;
  const host = (req.headers.host || '').split(':')[0];
  if (!host || host === 'localhost' || host === 'procela.io' || host === 'www.procela.io') return null;
  const first = host.split('.')[0];
  if (!first || first === 'www' || first === 'procela') return null;
  return first;
}

function tenantBrandingFor(slug: string | null) {
  const org = slug ? organizations.find((o) => o.tenantSlug === slug) : null;
  return {
    tenantSlug: org?.tenantSlug || null,
    displayName: org?.brandDisplayName || org?.name || current.companyName,
    glyph: org?.brandGlyph || '',
    ssoButtonLabel: org?.ssoButtonLabel || 'Sign in with SSO',
    primaryColor: org?.brandPrimaryColor || current.primaryColor,
    logoUrl: current.logoUrl,
    isTenantBrand: !!org,
  };
}

router.get('/tenant', (req: Request, res: Response) => {
  res.json({ success: true, data: tenantBrandingFor(resolveTenantSlug(req)) });
});
router.get('/tenant/:slug', (req: Request, res: Response) => {
  res.json({ success: true, data: tenantBrandingFor(resolveTenantSlug(req)) });
});

export { resolveTenantSlug, tenantBrandingFor };

// POST /reset — restores defaults. Useful during setup or when a bad colour
// pair makes the UI unusable (which defeats the point of a settings page).
router.post('/reset', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  current = { ...DEFAULT_BRANDING, updatedAt: new Date().toISOString(), updatedBy: req.user?.email || req.user?.sub || null };
  await persist();
  logger.info({ by: current.updatedBy }, 'Branding reset to defaults');
  const { updatedBy: _ub, ...publicFields } = current;
  res.json({ success: true, data: publicFields });
});

export default router;
