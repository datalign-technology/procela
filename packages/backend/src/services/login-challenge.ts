import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// login-challenge — per-IP failure counter that promotes a CAPTCHA
// challenge after the threshold is crossed. Sits in front of the
// password verifier alongside the rate limiter and the account-lockout
// service:
//   - rate limiter      blocks bursts from one IP across all accounts
//   - account-lockout   locks one account after N failures from any IP
//   - login-challenge   demands proof-of-human after N failures from
//                       one IP, regardless of which account was tried
//
// The CAPTCHA itself is hCaptcha when HCAPTCHA_SECRET is set; in dev /
// when no provider is configured we accept any non-empty token, which
// lets the frontend test the prompt flow without an hCaptcha account.
//
// Counter resets on successful login from the same IP, or after the
// window passes without another failure.
// ──────────────────────────────────────────────────────────────────────────

const THRESHOLD = parseInt(process.env.CAPTCHA_THRESHOLD || '3', 10);
const WINDOW_MS = parseInt(process.env.CAPTCHA_WINDOW_MS || String(15 * 60 * 1000), 10);

interface IpState {
  count: number;
  firstAt: number;
}

const ipState = new Map<string, IpState>();

function ipKey(ip: string | undefined): string {
  return ip || 'noip';
}

/** Returns true when the IP has exceeded the threshold inside the
 *  window. Read-only — used by the login route to decide whether to
 *  demand a captchaToken on the incoming request. */
export function isCaptchaRequired(ip: string | undefined): boolean {
  const key = ipKey(ip);
  const state = ipState.get(key);
  if (!state) return false;
  if (Date.now() - state.firstAt > WINDOW_MS) {
    ipState.delete(key);
    return false;
  }
  return state.count >= THRESHOLD;
}

/** Bump the failure counter for an IP. Called on every failed login
 *  attempt regardless of the cause (unknown email, bad password,
 *  account locked) so a scripted attempt that walks a list of emails
 *  trips the threshold the same as one targeting a single account. */
export function recordLoginFailure(ip: string | undefined): void {
  const key = ipKey(ip);
  const now = Date.now();
  const state = ipState.get(key);
  if (!state || now - state.firstAt > WINDOW_MS) {
    ipState.set(key, { count: 1, firstAt: now });
  } else {
    state.count += 1;
  }
}

/** Clear the counter for an IP. Called on a successful login from
 *  that IP — the legitimate user just produced valid credentials, so
 *  the counter starts fresh. */
export function clearLoginFailures(ip: string | undefined): void {
  ipState.delete(ipKey(ip));
}

/** Verify a captchaToken supplied by the frontend.
 *
 *   - When HCAPTCHA_SECRET is set, POST to hCaptcha's siteverify
 *     endpoint and trust their response. This is the production path.
 *   - When no secret is set, accept any non-empty token. Dev / test
 *     path — lets the frontend exercise the captcha-required flow
 *     without signing up for hCaptcha. */
export async function verifyCaptchaToken(token: string | undefined, ip: string | undefined): Promise<boolean> {
  if (!token || token.length === 0) return false;
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    logger.debug({ ip }, 'CAPTCHA verification accepted without HCAPTCHA_SECRET (dev mode)');
    return true;
  }
  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    const res = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'hCaptcha siteverify HTTP error');
      return false;
    }
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!json.success) {
      logger.info({ codes: json['error-codes'], ip }, 'hCaptcha verification rejected');
    }
    return !!json.success;
  } catch (err) {
    logger.warn({ err }, 'hCaptcha siteverify network error');
    return false;
  }
}

/** Public helper for the frontend so it can render the right hCaptcha
 *  widget. Returns the site key only — the secret stays server-side. */
export function getCaptchaSiteKey(): string {
  return process.env.HCAPTCHA_SITE_KEY || '';
}
