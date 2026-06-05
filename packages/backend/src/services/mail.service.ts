import nodemailer, { Transporter } from 'nodemailer';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// mail.service — SMTP delivery of transactional email.
//
// Currently used for password-reset tokens; designed to grow into the
// home for any outbound email (admin notifications, weekly digests,
// audit alerts).
//
// Configuration is env-driven and entirely optional. When SMTP isn't
// configured, isConfigured() returns false and callers fall back to
// their dev path (e.g. /auth/password/forgot writes the token to the
// audit log instead of sending it). This is the default in CLAUDE.md's
// prototype scope — production deployments set the SMTP_* vars to
// activate real delivery.
//
// Env vars (all required for delivery to be active):
//   SMTP_HOST       e.g. smtp.sendgrid.net, smtp.office365.com
//   SMTP_PORT       e.g. 587 (STARTTLS) or 465 (TLS)
//   SMTP_USER       SMTP username
//   SMTP_PASS       SMTP password / API key
//   MAIL_FROM       "Procela <noreply@procela.io>" — From header
//   APP_URL         e.g. https://app.procela.io — base for reset links
//
// Optional:
//   SMTP_SECURE     'true' for port 465 implicit TLS, omit otherwise
//
// The transporter is verified at module init so a bad config surfaces
// in the boot log rather than the first forgot-password request.
// ──────────────────────────────────────────────────────────────────────────

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  appUrl: string;
}

function readConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;
  const appUrl = process.env.APP_URL;
  if (!host || !port || !user || !pass || !from || !appUrl) return null;
  return {
    host,
    port: parseInt(port, 10),
    secure: process.env.SMTP_SECURE === 'true',
    user, pass, from, appUrl,
  };
}

const config = readConfig();
let transporter: Transporter | null = null;
let ready = false;

if (config) {
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  // Verify in the background so we don't block module init. A bad
  // config logs but doesn't crash — isConfigured() flips to false on
  // verification failure and callers fall back to the dev path.
  transporter.verify()
    .then(() => {
      ready = true;
      logger.info({ host: config.host, port: config.port }, 'SMTP transporter verified');
    })
    .catch((err) => {
      ready = false;
      transporter = null;
      logger.warn({ err, host: config.host }, 'SMTP verification failed — falling back to dev audit-log delivery');
    });
} else {
  logger.info('SMTP not configured — outbound mail will fall back to the audit log');
}

export function isConfigured(): boolean {
  return ready && transporter !== null && config !== null;
}

/** App-wide base URL for clickable links in emails. Falls back to a
 *  relative path when APP_URL isn't set; callers that need an
 *  absolute link should check isConfigured() first. */
export function getAppUrl(): string {
  return config?.appUrl || '';
}

/** Send the password-reset email. Returns true on successful send,
 *  false otherwise. The /forgot route logs the audit entry either
 *  way — this function is only responsible for delivery. */
export async function sendPasswordResetEmail(args: {
  to: string;
  name: string;
  token: string;
  ttlMinutes: number;
}): Promise<boolean> {
  if (!isConfigured() || !transporter || !config) return false;

  const resetLink = `${config.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(args.token)}`;
  const subject = 'Reset your Procela password';

  // Both HTML and plain-text bodies. Plain-text is what most security
  // tooling renders and prevents phishing-by-link-text mismatch — the
  // URL appears verbatim either way.
  const text = [
    `Hi ${args.name || 'there'},`,
    '',
    `We received a request to reset the password on your Procela account.`,
    '',
    `Open this link to choose a new password:`,
    resetLink,
    '',
    `The link expires in ${args.ttlMinutes} minutes and can only be used once.`,
    '',
    `If you didn't request this, you can safely ignore this email — your`,
    `password won't change unless you click the link.`,
    '',
    '— Procela',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #1e293b; max-width: 480px;">
      <p>Hi ${escapeHtml(args.name || 'there')},</p>
      <p>We received a request to reset the password on your Procela account.</p>
      <p>
        <a href="${resetLink}" style="display: inline-block; padding: 10px 18px; background: #0f4f46; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">
          Choose a new password
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b;">
        Or paste this link in a browser:<br/>
        <a href="${resetLink}" style="color: #0f4f46;">${escapeHtml(resetLink)}</a>
      </p>
      <p style="font-size: 13px; color: #64748b;">
        The link expires in ${args.ttlMinutes} minutes and can only be used once.
      </p>
      <p style="font-size: 13px; color: #64748b;">
        If you didn't request this, you can safely ignore this email — your password
        won't change unless you click the link.
      </p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">— Procela</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: config.from,
      to: args.to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    logger.warn({ err, to: args.to }, 'Failed to deliver password reset email');
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
