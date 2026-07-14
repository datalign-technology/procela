import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';
import { checkAndRecord, isEnabled, statusFor } from '../services/ai-usage';

// ──────────────────────────────────────────────────────────────────────────
// enforceAiBudget — per-org rate limit for AI endpoints.
//
// Sits after authenticateToken on /api/v1/ai/* and /api/v1/chat/*
// so every AI call is charged against the caller's org. Once the
// org exceeds AI_MAX_CALLS_PER_ORG_PER_HOUR (default 60) or
// AI_MAX_CALLS_PER_ORG_PER_DAY (default 500), further calls return
// 429 with a Retry-After header carrying the seconds until the
// smaller window rolls over.
//
// Disabled unless AI_COST_CONTROLS_ENABLED=1 (default: on in
// production, off elsewhere so dev + tests aren't held back by the
// ceiling).
// ──────────────────────────────────────────────────────────────────────────

export function enforceAiBudget(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!isEnabled()) return next();
  const orgId = req.user?.orgId;
  if (!orgId) {
    // authenticateToken always populates req.user, but guard anyway
    // — no orgId means no budget to charge against; let it through
    // rather than pretending to enforce.
    return next();
  }
  const result = checkAndRecord(orgId);
  if (!result.allowed) {
    const secondsUntilReset = Math.ceil(
      ((result.reason === 'hour' ? result.status.hourResetAtMs : result.status.dayResetAtMs) - Date.now()) / 1000,
    );
    res.setHeader('Retry-After', Math.max(1, secondsUntilReset).toString());
    res.status(429).json({
      success: false,
      error: `AI call limit reached for this organization (${result.reason === 'hour' ? `${result.status.hourLimit}/hr` : `${result.status.dayLimit}/day`}). Retry in ${secondsUntilReset}s.`,
      limit: result.reason,
      status: result.status,
    });
    return;
  }
  next();
}

/** Read-only view helper — returns the caller's org's current usage. */
export function currentUsage(req: AuthenticatedRequest): ReturnType<typeof statusFor> | null {
  const orgId = req.user?.orgId;
  if (!orgId) return null;
  return statusFor(orgId);
}
