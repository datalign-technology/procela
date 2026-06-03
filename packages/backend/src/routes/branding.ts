import { Router, Request, Response } from 'express';
import { loadStore, saveStore } from '../lib/persistence';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
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

// Persisted as a single-element array to reuse the loadStore/saveStore
// helpers. `brandingRef.current` is always the active config.
const initial = loadStore<BrandingConfig>('branding');
let current: BrandingConfig = initial.length > 0 ? { ...DEFAULT_BRANDING, ...initial[0] } : { ...DEFAULT_BRANDING };

function persist() {
  saveStore('branding', [current]);
}

// Export for the autosave bundle in index.ts so the file gets periodically
// flushed alongside every other store (redundant with the explicit persist()
// above, but keeps the shutdown-flush behaviour uniform).
export const brandingStoreArray: BrandingConfig[] = [current];

function syncRef() {
  brandingStoreArray.length = 0;
  brandingStoreArray.push(current);
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
router.put('/', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
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
  syncRef();
  persist();
  logger.info({ by: next.updatedBy, company: next.companyName }, 'Branding updated');

  const { updatedBy: _ub, ...publicFields } = current;
  res.json({ success: true, data: publicFields });
});

// POST /reset — restores defaults. Useful during setup or when a bad colour
// pair makes the UI unusable (which defeats the point of a settings page).
router.post('/reset', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  current = { ...DEFAULT_BRANDING, updatedAt: new Date().toISOString(), updatedBy: req.user?.email || req.user?.sub || null };
  syncRef();
  persist();
  logger.info({ by: current.updatedBy }, 'Branding reset to defaults');
  const { updatedBy: _ub, ...publicFields } = current;
  res.json({ success: true, data: publicFields });
});

export default router;
