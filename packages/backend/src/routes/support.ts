// In-app "Report a problem" endpoint (go-live checklist #19).
//
// A signed-in user submits a short report from the app shell. Every
// submission is recorded to the tamper-evident audit trail — that is
// the durable record and needs no external infra. If a support inbox
// (SUPPORT_EMAIL) and SMTP are configured, the report is also emailed;
// if not, it's audit-only, the same graceful fallback the password-reset
// flow uses. Nothing here can fail a user's request just because mail
// isn't wired.

import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people } from './people';
import { getPeopleRepository } from '../db/people.repo';
import { sendSupportEmail } from '../services/mail.service';
import { config } from '../config';
import { DEV_ORG_ID } from './auth';

const router = Router();
const peopleRepo = getPeopleRepository(people);

// Keep it modest: 5 reports/minute per user is plenty for a human and
// caps accidental double-submits or a wedged client from flooding the
// audit log / support inbox.
const supportLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyBy: (req) => `support:${(req as AuthenticatedRequest).user?.sub || req.ip || 'anon'}`,
  label: 'support_report',
});

const CATEGORIES = ['Bug', 'Question', 'Feedback'] as const;
type Category = (typeof CATEGORIES)[number];

const MESSAGE_MAX = 5000;
// Context is operator-useful metadata the client captures (route, app
// version, user agent). Bound both the number of keys and each value so
// a hostile client can't bloat an audit row or the email body.
const CONTEXT_MAX_KEYS = 12;
const CONTEXT_VALUE_MAX = 500;

function sanitizeContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= CONTEXT_MAX_KEYS) break;
    if (typeof k !== 'string') continue;
    const val = typeof v === 'string' ? v : v == null ? '' : String(v);
    out[k.slice(0, 60)] = val.slice(0, CONTEXT_VALUE_MAX);
  }
  return out;
}

/**
 * POST /api/v1/support
 * Body: { message: string; category?: 'Bug'|'Question'|'Feedback'; context?: Record<string,string> }
 * Always audit-logged; emailed to SUPPORT_EMAIL when configured.
 * Returns 202 { delivered } — delivered=true iff the email was sent.
 */
router.post('/', authenticateToken, supportLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    res.status(400).json({ success: false, error: 'A message is required.' });
    return;
  }
  if (message.length > MESSAGE_MAX) {
    res.status(400).json({ success: false, error: `Message must be ${MESSAGE_MAX} characters or fewer.` });
    return;
  }

  const category: Category = CATEGORIES.includes(req.body?.category) ? req.body.category : 'Bug';
  const context = sanitizeContext(req.body?.context);

  // Resolve the reporter from the authenticated token. name + org come
  // from the people record when there is one (there always is for a
  // real login; the dev fallback still has an email + sub).
  const email = req.user?.email || '';
  const userId = req.user?.sub || null;
  const person = email ? (await peopleRepo.list()).find((p) => p.email.toLowerCase() === email.toLowerCase()) : undefined;
  const reporterName = person?.name || email || 'Unknown user';
  const orgId = person?.orgIds?.[0] || DEV_ORG_ID;

  // Durable record first — this is the source of truth. Store a bounded
  // copy of the message so a huge report doesn't balloon the audit row.
  auditService.log(orgId, userId, 'Support', 'report', 'SUPPORT_REPORT', null, {
    category,
    message: message.slice(0, 1000),
    context,
    reporterEmail: email,
  });

  // Best-effort delivery. A missing SUPPORT_EMAIL or SMTP config just
  // means audit-only — never an error to the user.
  let delivered = false;
  if (config.supportEmail) {
    try {
      delivered = await sendSupportEmail({
        to: config.supportEmail,
        reporterName,
        reporterEmail: email,
        orgId,
        category,
        message,
        context,
      });
    } catch (err) {
      logger.warn({ err }, 'Support email delivery threw');
    }
  }

  logger.info({ orgId, userId, category, delivered }, 'Support report received');
  res.status(202).json({ success: true, data: { delivered } });
});

export default router;
