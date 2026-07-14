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
    next();
  } catch {
    return next(new AppError('Invalid or expired token', 401));
  }
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
