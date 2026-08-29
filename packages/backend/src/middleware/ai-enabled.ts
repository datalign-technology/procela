import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

// ──────────────────────────────────────────────────────────────────────────
// requireAiEnabled — hard gate for every AI integration endpoint.
//
// When AI_FEATURES_ENABLED=false (config.aiFeaturesEnabled), the whole AI
// surface is switched off: template generation, data-domain / asset
// suggestions, the sensitivity classifier, the assistant, and governance AI
// agents. The frontend hides these features, but the middleware is the real
// enforcement point — it refuses the calls even if something reaches the API
// directly. Returns 403 with a stable `code` the client can branch on.
//
// It intentionally checks only the explicit flag, not API-key presence, so a
// default deployment behaves exactly as before (AI on; a missing key still
// surfaces its own configuration error at call time).
// ──────────────────────────────────────────────────────────────────────────

export function requireAiEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!config.aiFeaturesEnabled) {
    res.status(403).json({
      success: false,
      error: 'AI features are turned off for this deployment.',
      code: 'AI_DISABLED',
    });
    return;
  }
  next();
}
