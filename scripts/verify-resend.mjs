#!/usr/bin/env node
// verify-resend.mjs — send one real test email through your configured SMTP
// relay and report the result. Exercises the exact nodemailer path the backend
// uses for "Report a problem" and password resets, so a success here means the
// app's mail delivery is correctly wired.
//
// Defaults target Resend, but any authenticated SMTP relay works — override the
// SMTP_* vars. Config is read from the environment (and a repo-root .env if
// present), the same variables the backend reads.
//
// Usage:
//   RESEND_API_KEY=re_... MAIL_FROM='Procela <noreply@procela.ai>' \
//     npm run verify:email
//   # or point anywhere:
//   SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... \
//     MAIL_FROM='...' npm run verify:email
//
// Env vars:
//   SMTP_HOST      default smtp.resend.com
//   SMTP_PORT      default 465
//   SMTP_SECURE    'true' | 'false'; defaults true when port is 465, else false
//   SMTP_USER      default 'resend' (Resend's SMTP username)
//   SMTP_PASS      SMTP password; for Resend this is your API key
//   RESEND_API_KEY convenience alias used as SMTP_PASS when SMTP_PASS is unset
//   MAIL_FROM      REQUIRED — must be on a domain verified with your relay
//   SUPPORT_EMAIL  recipient; default support@procela.ai
//   TEST_TO        override the recipient just for this test

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// Load a repo-root .env without adding a dotenv dependency. Existing
// process.env values win, so an inline override on the command line is honoured.
try {
  const raw = readFileSync(join(repoRoot, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
} catch {
  /* no .env — rely entirely on the environment */
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  console.error('✗ Could not load nodemailer. Run `npm install` at the repo root first.');
  process.exit(1);
}

const host = process.env.SMTP_HOST || 'smtp.resend.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
const user = process.env.SMTP_USER || 'resend';
const pass = process.env.SMTP_PASS || process.env.RESEND_API_KEY || '';
const from = process.env.MAIL_FROM || '';
const to = process.env.TEST_TO || process.env.SUPPORT_EMAIL || 'support@procela.ai';

const missing = [];
if (!pass) missing.push('SMTP_PASS (or RESEND_API_KEY)');
if (!from) missing.push('MAIL_FROM');
if (missing.length) {
  console.error(`✗ Missing required config: ${missing.join(', ')}`);
  console.error('  Set them in the environment or repo-root .env, then re-run.');
  process.exit(1);
}

console.log(`→ Relay:  ${user}@${host}:${port} (secure=${secure})`);
console.log(`→ From:   ${from}`);
console.log(`→ To:     ${to}`);

const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

const category = 'Bug';
const message = 'Verification send from scripts/verify-resend.mjs — confirms the app mail path delivers.';

try {
  await transporter.verify();
  console.log('✓ verify() OK — relay reachable and credentials accepted (isConfigured() would be true).');

  const info = await transporter.sendMail({
    from,
    to,
    replyTo: from,
    subject: `[Procela support] ${category}: ${message.slice(0, 60).replace(/\s+/g, ' ')}`,
    text: `A Procela mail-path verification.\n\nCategory: ${category}\n\nMessage:\n${message}\n\n— Procela`,
    html: `<p>A Procela mail-path verification.</p><p>${message}</p>`,
  });

  console.log(`✓ SENT — messageId=${info.messageId}`);
  console.log(`  accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)}`);
  console.log(`\nCheck the ${to} inbox (and your relay's dashboard logs) to confirm arrival.`);
  transporter.close();
} catch (err) {
  console.error(`✗ FAILED: ${err && err.message ? err.message : err}`);
  console.error('\nCommon causes:');
  console.error('  • MAIL_FROM domain not verified with the relay (Resend returns 403/422).');
  console.error('  • Wrong API key / SMTP password.');
  console.error('  • Port blocked — try SMTP_PORT=587 with SMTP_SECURE=false.');
  process.exit(1);
}
