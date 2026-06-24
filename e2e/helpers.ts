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

/** Sign in as Eleanor Briggs (seeded Super Admin), dismiss the welcome
 *  wizard, and return her access token for any direct API calls the
 *  test needs to make. After this resolves the page is at /. */
export async function loginAsEleanor(page: Page): Promise<string> {
  await page.goto(FRONTEND + '/login', { waitUntil: 'networkidle' });
  // Mark the onboarding wizard as already-dismissed so it doesn't
  // overlay the page and intercept clicks. Has to land BEFORE the
  // login click so the dashboard render after sign-in sees the flag.
  await page.evaluate(() => localStorage.setItem('procela:onboarding-complete', 'true'));
  await page.getByRole('button', { name: /Eleanor Briggs/i }).click();
  // Wait for the auth-storage entry to land, which the Layout component
  // polls for before rendering anything authenticated.
  await page.waitForFunction(() => !!localStorage.getItem('auth-storage'), null, { timeout: 10_000 });
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('auth-storage');
    return raw ? (JSON.parse(raw).state?.accessToken as string) : '';
  });
  if (!token) throw new Error('No access token after Eleanor login');
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
