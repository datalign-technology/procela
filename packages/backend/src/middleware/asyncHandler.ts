import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async Express handler so a rejected promise is forwarded to the
 * error-handling middleware via `next(err)` instead of becoming an unhandled
 * promise rejection that crashes the process.
 *
 * Express 4 does not catch throws from async handlers, so an un-awaited
 * rejection (e.g. a Prisma error) escapes to `process.on('unhandledRejection')`
 * and, under Node's default, exits the process. The agent-facing connector
 * endpoints run untrusted, high-volume traffic — a single bad request (a
 * foreign-key violation, a malformed payload) must never be able to take the
 * whole API server down. Wrapping the handler routes that error to the shared
 * errorHandler, which returns a clean 500.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
