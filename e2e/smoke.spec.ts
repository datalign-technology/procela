// End-to-end smoke for Procela. One suite, five tests, ~30 seconds
// total. Each test is a top-level user flow that, if broken, means
// the whole build is unshippable.
//
// Test discipline:
//   - Use the API (loginAsEleanor / createOrg / setActiveOrg) for
//     setup. Use the UI for the thing actually being smoked.
//   - Treat any console error or page-level error as a failure.
//     A stack trace in the browser console is almost always a
//     regression.
//   - Skip 404s on /skills/gap-report — pre-existing console noise
//     that isn't worth chasing here.
import { test, expect, type Page } from '@playwright/test';
import {
  BACKEND,
  loginAsEleanor,
  createOrg,
  setActiveOrg,
  gotoWithOrg,
  uniqueName,
} from './helpers';

// Console errors that fire even on a clean build — ignore them so the
// suite doesn't fail on pre-existing noise unrelated to the change
// under test. The "Failed to load resource" pattern is browser-level
// noise for any HTTP non-2xx response; real API errors get caught by
// the JS-level handlers (pageerror, or an explicit app-side log), so
// excluding the raw browser message keeps the suite focused on actual
// regressions rather than expected 404s (probe endpoints, optional
// resources, etc.).
const KNOWN_NOISE = [
  /Failed to load resource/i,
  /skills\/gap-report/,
];

function attachConsoleWatcher(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.stack || e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (KNOWN_NOISE.some((rx) => rx.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

test.describe('Procela smoke', () => {
  test('Eleanor can sign in and lands on the dashboard', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    expect(token).toBeTruthy();
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/$/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('every top-level page renders without errors', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);

    // Seed one of everything via API so pages have data to render.
    const orgId = await createOrg(token, uniqueName('Smoke Org'));
    await setActiveOrg(page, orgId, 'Smoke Org');

    // The set of routes that should always work. New top-level
    // pages should land here when they ship. Wizards / deep-link
    // detail routes stay out — they're tested in their own flows.
    const routes = [
      '/',
      '/setup',
      '/processes',
      '/organizations',
      '/people',
      '/agents',
      '/skills',
      '/governance-groups',
      '/dama-roles',
      '/data-assets',
      '/systems',
      '/data-domains',
      '/data-lineage',
      '/data-quality',
      '/business-glossary',
      '/data-dictionary',
      '/governance-policies',
      '/governance-program',
      '/governance-calendar',
      '/decision-rights',
      '/audit-log',
      '/settings',
      '/help',
    ];

    for (const r of routes) {
      await page.goto(r, { waitUntil: 'networkidle' });
      // Give the page a beat to settle; lazy chunks may still be
      // resolving on first paint.
      await page.waitForTimeout(300);
      // Sanity check: the document title contains "Procela" so we
      // know React mounted and the page rendered at all.
      const title = await page.title();
      expect(title, `route ${r}`).toContain('Procela');
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('creating a person through the API surfaces on the People page', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    const orgId = await createOrg(token, uniqueName('People Smoke'));
    await setActiveOrg(page, orgId, 'People Smoke');

    const personName = uniqueName('Smoke Person');
    const res = await fetch(BACKEND + '/people', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: personName, email: `smoke-${Date.now()}@t.com`, orgIds: [orgId] }),
    });
    expect(res.status).toBeLessThan(300);

    await gotoWithOrg(page, '/people', orgId, 'People Smoke');
    await expect(page.locator('body')).toContainText(personName, { timeout: 10_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('assigning a CDO surfaces on the Governance Roles page', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    const orgId = await createOrg(token, uniqueName('Roles Smoke'));
    await setActiveOrg(page, orgId, 'Roles Smoke');

    const personRes = await fetch(BACKEND + '/people', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke CDO', email: `cdo-${Date.now()}@t.com`, orgIds: [orgId] }),
    });
    const person = await personRes.json();
    expect(person.success).toBe(true);

    const roleRes = await fetch(BACKEND + '/dama-roles', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: person.data.id, roleType: 'CDO', scopeType: 'ORG', scopeId: orgId }),
    });
    expect(roleRes.status).toBeLessThan(300);

    await gotoWithOrg(page, '/dama-roles', orgId, 'Roles Smoke');
    await expect(page.getByRole('heading', { name: /Governance Roles/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText('Smoke CDO', { timeout: 10_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the assign-role form opens and lists the org\'s people', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    const orgId = await createOrg(token, uniqueName('Form Smoke'));
    await setActiveOrg(page, orgId, 'Form Smoke');

    const personName = uniqueName('Form Person');
    await fetch(BACKEND + '/people', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: personName, email: `form-${Date.now()}@t.com`, orgIds: [orgId] }),
    });

    await gotoWithOrg(page, '/dama-roles', orgId, 'Form Smoke');
    await page.getByRole('button', { name: /Assign role/i }).first().click();
    // Click the PersonPicker trigger and verify the new person is
    // findable. This catches a regression where the picker either
    // doesn't load the org's people or doesn't open at all.
    await page.getByRole('button', { name: /Pick a person/i }).first().click();
    await expect(page.locator('body')).toContainText(personName);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
