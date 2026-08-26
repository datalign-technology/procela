import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { hasPermission } from './permissions';
import { AppError } from '../middleware/errorHandler';

// Roles allowed to edit / publish a Council Scorecard beyond platform admins.
const SCORECARD_ROLE_TYPES = ['CDO', 'DATA_GOVERNANCE_LEAD'];

/**
 * Can the caller edit / publish council scorecards? Bridges the two role
 * systems: a platform admin (governance:write → Org/Super Admin) OR a person
 * who holds a CDO / Data Governance Lead DAMA-role assignment. The DAMA role
 * lives in a separate store and never on the JWT, so we resolve the caller's
 * Person by email and look up their assignments — the same bridge people.ts
 * uses. Kept as a plain predicate so route handlers can also use it to tell
 * the frontend whether to show edit controls.
 */
export function canEditScorecard(user: { role?: string; email?: string } | undefined): boolean {
  if (!user) return false;
  if (user.role && hasPermission(user.role, 'governance:write')) return true;
  // Lazy-require to avoid an import cycle (routes import each other at load).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { people } = require('../routes/people') as typeof import('../routes/people');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { damaRoles } = require('../routes/dama-roles') as typeof import('../routes/dama-roles');
  const email = String(user.email || '').toLowerCase();
  if (!email) return false;
  const person = people.find((p) => p.email?.toLowerCase() === email);
  if (!person) return false;
  return damaRoles.some((r) => r.personId === person.id && SCORECARD_ROLE_TYPES.includes(r.roleType));
}

/** Express guard for scorecard write routes. */
export function requireScorecardEditor(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  if (!req.user) { next(new AppError('Authentication required', 401)); return; }
  if (canEditScorecard(req.user as { role?: string; email?: string })) { next(); return; }
  next(new AppError('Only the CDO, Data Governance Lead, or an org admin can edit the council scorecard', 403));
}
