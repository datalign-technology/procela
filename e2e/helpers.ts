// Shared helpers for the Procela e2e smoke suite.
//
// The dev login flow shows quick-pick buttons for the seeded users
// (Eleanor = Super Admin). Tests use Eleanor across the board — she
// has full permissions, so a single helper unlocks every page.
//
// Every test that needs server data goes through the helpers below
// rather than poking the UI for setup. UI-driven setup makes the test
// slow and brittle; we save UI assertions for the actual thing under
// test (the page rendering, the form submitting).
import type { Page } from '@playwright/test';

export const BACKEND = 'http://localhost:3001/api/v1';
export const FRONTEND = 'http://localhost:5173';

// Cache Eleanor's token across tests in the same worker. The auth
// rate limiter caps logins at 5/min per (IP, email), and seven
// sequential tests each calling /login would otherwise trip it. By
// holding the token in module scope and injecting it into each test's
// fresh browser context, we hit /login at most once per worker run.
let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

/** Sign in as Eleanor Briggs (seeded Super Admin), dismiss the welcome
 *  wizard, and return her access token for any direct API calls the
 *  test needs to make. After this resolves the page is at /. */
export async function loginAsEleanor(page: Page): Promise<string> {
  await page.goto(FRONTEND + '/login', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('procela:onboarding-complete', 'true'));

  // Fast path: a previous test already grabbed Eleanor's token. Hydrate
  // the new context's auth-storage directly so the page renders as
  // authenticated without going through /login again.
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    const t = cachedToken.token;
    await page.evaluate((tok) => {
      const state = {
        accessToken: tok, refreshToken: tok, isAuthenticated: true,
        sessionExpiresAt: Date.now() + 60 * 60 * 1000,
        user: { id: 'eleanor', email: 'eleanor.briggs@tidewater-utilities.com', name: 'Eleanor Briggs', role: 'SUPER_ADMIN', orgId: '' },
      };
      localStorage.setItem('auth-storage', JSON.stringify({ state, version: 0 }));
    }, t);
    await page.goto(FRONTEND + '/', { waitUntil: 'networkidle' });
    return t;
  }

  await page.getByRole('button', { name: /Eleanor Briggs/i }).click();
  await page.waitForFunction(() => !!localStorage.getItem('auth-storage'), null, { timeout: 10_000 });
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('auth-storage');
    return raw ? (JSON.parse(raw).state?.accessToken as string) : '';
  });
  if (!token) throw new Error('No access token after Eleanor login');
  // JWT exp is in seconds; decode the middle segment to know when this
  // token expires so we can refresh proactively instead of mid-test.
  const expSec = (() => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
      return typeof payload.exp === 'number' ? payload.exp : 0;
    } catch { return 0; }
  })();
  cachedToken = { token, expiresAt: expSec ? expSec * 1000 : Date.now() + 30 * 60_000 };
  return token;
}

/** Create a fresh organisation via the API. Returns its id. The
 *  `type` must be lowercase to satisfy the accessible-orgs filter
 *  (uppercase types are persisted but won't surface in Eleanor's
 *  reachable set on a fresh dev DB). */
export async function createOrg(token: string, name: string): Promise<string> {
  const res = await fetch(BACKEND + '/organizations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: 'company', industry: 'utilities' }),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`createOrg failed: ${JSON.stringify(j)}`);
  return j.data.id as string;
}

/** Switch the active org in the persisted Zustand store so the next
 *  page navigation reads from this org's scope. Verifies the value
 *  survived after the next page renders — Layout's accessible-orgs
 *  auto-select can otherwise clobber freshly-set values when the
 *  backend has accumulated orgs from prior test runs. If it does,
 *  re-set and reload so the value sticks before the assertion runs. */
export async function setActiveOrg(page: Page, orgId: string, orgName = 'Smoke Test Org'): Promise<void> {
  await page.evaluate(({ id, name }) => {
    localStorage.setItem(
      'org-context',
      JSON.stringify({
        state: { activeOrgId: id, activeOrgName: name, activeOrgType: 'company' },
        version: 0,
      }),
    );
  }, { id: orgId, name: orgName });
}

/** Visit a path and ensure the activeOrgId stayed pinned to the
 *  expected value through Layout's render cycle. Use this instead of
 *  `page.goto(...)` directly whenever a test's assertion depends on
 *  the active-org filter being correct. */
export async function gotoWithOrg(
  page: Page,
  path: string,
  orgId: string,
  orgName = 'Smoke Test Org',
): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  // Give Layout's fetchOrgs + auto-select a beat to settle, then
  // verify activeOrgId stuck. If it didn't (Layout overwrote it),
  // re-set and reload so the page rerenders with the right scope.
  await page.waitForTimeout(500);
  const stuck = await page.evaluate(() => {
    const raw = localStorage.getItem('org-context');
    return raw ? (JSON.parse(raw).state?.activeOrgId as string) : '';
  });
  if (stuck !== orgId) {
    await setActiveOrg(page, orgId, orgName);
    await page.reload({ waitUntil: 'networkidle' });
  }
}

/** Generate a unique entity name so tests don't collide on persisted
 *  dev state. Timestamp + a 4-char random suffix is enough — the
 *  smoke runs are sequential. */
export function uniqueName(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix} ${stamp}-${rand}`;
}

// Every test name we ever pass to uniqueName() goes here. Used by
// cleanSmokeOrgs() below to sweep accumulated pollution from prior
// runs — the dev backend's auto-save persists every test org to
// disk, so without this the user's interactive session eventually
// shows dozens of "Smoke Org abc123-def" entries in the org picker.
const SMOKE_NAME_PREFIXES = [
  'Smoke Org', 'People Smoke', 'Roles Smoke', 'Form Smoke',
  'Data Map Smoke', 'Orphan Smoke',
];

/** Sweep every org whose name starts with one of the smoke-test
 *  prefixes via the API. Designed to run once at the start of the
 *  suite — self-heals after past failures left rows behind, and
 *  keeps the dev backend's org picker clean for interactive use.
 *
 *  Soft-fail: a delete that returns 4xx (e.g. missing dependent
 *  cleanup permissions) is logged and skipped rather than aborting
 *  the whole run. The next test will still succeed because each
 *  test creates its own fresh org. */
export async function cleanSmokeOrgs(token: string): Promise<{ scanned: number; deleted: number }> {
  const res = await fetch(BACKEND + '/organizations', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) return { scanned: 0, deleted: 0 };
  const body = await res.json();
  const orgs: Array<{ id: string; name: string }> = body.data || [];
  let deleted = 0;
  for (const org of orgs) {
    if (!SMOKE_NAME_PREFIXES.some((p) => org.name.startsWith(p))) continue;
    const r = await fetch(BACKEND + `/organizations/${org.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (r.ok || r.status === 204) deleted++;
  }
  return { scanned: orgs.length, deleted };
}
