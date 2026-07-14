import { Request, Response, NextFunction } from 'express';
import { verify as verifyJwt } from '../services/jwt-signer';
import { AppError } from './errorHandler';
import { TokenPayload } from '../types';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Middleware that extracts and validates the Bearer token from the
 * Authorization header, then attaches the decoded user to the request.
 *
 * Verification goes through services/jwt-signer, which picks RS256
 * or HS256 based on the JWT_* config at boot. Downstream services
 * (an edge proxy, a data-lake gate) can verify the same tokens by
 * fetching the JWKS at /api/v1/auth/jwks.json when RS256 is active.
 *
 * After decoding the JWT this also validates any `orgId` the caller
 * supplied on the request (query, body, or path) against the user's
 * accessible-org set. A non-super-admin who names an org outside
 * their tree gets 403 here rather than reaching a route handler
 * that might have forgotten to check. See enforceOrgScope for the
 * details of what counts as "an org id the caller supplied."
 */
export function authenticateToken(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  try {
    const decoded = verifyJwt<TokenPayload>(token);
    req.user = decoded;
    const scopeErr = enforceOrgScope(req);
    if (scopeErr) return next(scopeErr);
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(new AppError('Invalid or expired token', 401));
  }
}

/**
 * Validate that any `orgId` the caller supplied (as `?orgId=...`,
 * `?scopeOrgId=...`, on the request body, or via the routed `:orgId`
 * path param) is in the authenticated user's accessible-org set.
 *
 * The check pulls user visibility from the people store via
 * routes/people.getVisibleOrgIds — resolved lazily to avoid the
 * middleware ↔ people-route import cycle at boot. SUPER_ADMIN (and
 * the dev-fallback case where the user has no matching people row)
 * gets `visible === null`, which we treat as unrestricted.
 *
 * Returns an AppError on mismatch, or `undefined` when everything
 * the caller supplied is legal. Multi-value inputs (arrays, comma-
 * lists) are handled by validating each value.
 */
function enforceOrgScope(req: AuthenticatedRequest): AppError | undefined {
  const supplied: string[] = [];
  const collect = (v: unknown): void => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      for (const item of v) collect(item);
      return;
    }
    if (typeof v === 'string') supplied.push(v.trim());
  };
  const q = (req.query || {}) as Record<string, unknown>;
  collect(q.orgId);
  collect(q.scopeOrgId);
  const params = (req.params || {}) as Record<string, unknown>;
  collect(params.orgId);
  const body = (req.body || {}) as Record<string, unknown>;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    // Only validate a top-level orgId on the body. Nested references
    // (e.g. a mapping's `orgId`) are validated by the route handler
    // itself where it also checks that the referenced entity is
    // in-scope.
    collect(body.orgId);
  }
  if (supplied.length === 0) return undefined;

  // Lazy require breaks the import cycle: routes/people imports
  // middleware indirectly via other paths at boot.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getVisibleOrgIds } = require('../routes/people') as typeof import('../routes/people');
  const visible = getVisibleOrgIds(req.user);
  if (visible === null) return undefined; // unrestricted
  for (const id of supplied) {
    if (!visible.has(id)) {
      return new AppError(`Not authorized for orgId ${id}`, 403);
    }
  }
  return undefined;
}

/**
 * Middleware factory that restricts access to users whose role is
 * included in the provided list.
 */
export function authorize(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
}
