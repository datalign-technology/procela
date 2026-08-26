import { Request, Response, NextFunction } from 'express';
import config from '../config';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Record an unexpected error in the tamper-evident audit log with full request
 * context — method, path, the acting user, status, and the error's name /
 * message / stack — so a failure is reviewable and exportable alongside every
 * other change, not just in an ephemeral stdout line.
 *
 * Best-effort: a failure here must never mask the original error or the
 * response. Routine 4xx operational errors (validation, not-found) are logged
 * but NOT audited, to keep the trail signal-dense.
 */
function recordErrorAudit(req: Request, err: Error, statusCode: number): void {
  try {
    const user = (req as Request & { user?: { id?: string; orgId?: string } }).user;
    auditService.log(
      user?.orgId || 'system',
      user?.id || null,
      'System',
      `${req.method} ${req.originalUrl || req.path}`,
      'ERROR',
      null,
      {
        statusCode,
        method: req.method,
        path: req.originalUrl || req.path,
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    );
  } catch (auditErr) {
    logger.error({ err: auditErr }, 'Failed to record error in audit log');
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.warn(
      { statusCode: err.statusCode, message: err.message, method: req.method, path: req.path },
      'Operational error',
    );
    // Audit only unexpected AppErrors — a 5xx, or one explicitly flagged
    // non-operational. Expected 4xx (validation, auth, not-found) stay out.
    if (err.statusCode >= 500 || !err.isOperational) recordErrorAudit(req, err, err.statusCode);
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  recordErrorAudit(req, err, 500);
  res.status(500).json({
    success: false,
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
}
