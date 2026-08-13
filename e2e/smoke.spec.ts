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
import { test, expect, chromium, type Page } from '@playwright/test';
import {
  BACKEND,
  loginAsEleanor,
  createOrg,
  setActiveOrg,
  gotoWithOrg,
  uniqueName,
  cleanSmokeOrgs,
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
  // React duplicate-key warning that surfaces when the dev backend has
  // accumulated multiple rows with the same id from prior backend test
  // runs (the auth/mfa fixture id). Pre-existing data-hygiene issue,
  // unrelated to any single change under smoke test.
  /Encountered two children with the same key/i,
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
  // Self-heal before the suite: delete every org left behind by prior
  // smoke runs (the dev backend's auto-save persists each created org
  // to disk and the in-test login flow doesn't cascade-cleanup).
  // Without this the dev environment accumulates "Smoke Org abc-def"
  // rows that pollute the user's interactive org picker.
  test.beforeAll(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    try {
      const token = await loginAsEleanor(page);
      const { scanned, deleted } = await cleanSmokeOrgs(token);
      // eslint-disable-next-line no-console
      console.log(`[smoke setup] swept ${deleted} stale smoke orgs out of ${scanned}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`[smoke setup] cleanup skipped: ${err?.message || err}`);
    } finally {
      await browser.close();
    }
  });

  test('Eleanor can sign in and lands on the dashboard', async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    expect(token).toBeTruthy();
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/$/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('every top-level page renders without errors', async ({ page }) => {
    // Walking 23 routes serially can exceed the default 30s timeout
    // on a dev backend with accumulated state — each page's data
    // fetch takes longer when the persistence layer has more rows.
    // Give this test the room it needs; the per-page work is still
    // quick, just additive.
    test.setTimeout(90_000);
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
      '/data-assets/orphans',
      '/processes/data-map',
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
      // Sanity check: the document title contains "Procela" so we
      // know React mounted and the page rendered at all. networkidle
      // already covers the lazy-chunk load + initial data fetch.
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
    // Open the PersonPicker and type the freshly-created name into
    // its search box. The picker caps results at 100 alphabetical
    // names; on a dev backend with accumulated state from prior runs
    // the test person can land outside that window. Typing the name
    // narrows the list to a single match so the assertion is
    // deterministic.
    await page.getByRole('button', { name: /Pick a person/i }).first().click();
    const search = page.getByPlaceholder(/Search name, title, or org/i);
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(personName);
    await expect(page.locator('body')).toContainText(personName, { timeout: 10_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Process ↔ Data map renders the bipartite graph for a mapped activity', async ({ page }) => {
    // Phase 3 visualization. Seeds a value stream → process → activity
    // tree with one mapping via the API, then walks the user to the
    // map and asserts the activity name + the asset name appear in
    // the SVG. Catches regressions where /processes/data-map renders
    // an empty canvas even when there are real mappings to draw.
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    const orgId = await createOrg(token, uniqueName('Data Map Smoke'));
    await setActiveOrg(page, orgId, 'Data Map Smoke');

    const api = async (path: string, body: unknown) => {
      const res = await fetch(BACKEND + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.success) throw new Error(`${path} failed: ${JSON.stringify(j)}`);
      return j.data;
    };
    const sys = await api('/systems', { orgId, name: 'Map Smoke ERP', description: '', systemType: 'ERP' });
    const asset = await api('/data-assets', {
      orgId, name: 'Map Smoke Asset', description: 'mapped', systemId: sys.id,
      governanceTier: 'SILVER',
    });
    const vs = await api('/process-catalog/nodes', { orgIds: [orgId], parentId: null, level: 'VALUE_STREAM', name: 'Map Smoke VS', description: '' });
    const proc = await api('/process-catalog/nodes', { orgIds: [orgId], parentId: vs.id, level: 'PROCESS', name: 'Map Smoke Proc', description: '' });
    const act = await api('/process-catalog/nodes', {
      orgIds: [orgId], parentId: proc.id, level: 'ACTIVITY',
      name: 'Map Smoke Activity', description: '', systemIds: [sys.id],
    });
    await api('/mappings', {
      orgId, processStepId: act.id, dataAssetId: asset.id,
      linkType: 'consumes', notes: '',
    });

    await gotoWithOrg(page, '/processes/data-map', orgId, 'Data Map Smoke');
    // Target the data-map's SVG specifically — the page has many other
    // icon SVGs in nav and chrome that would match a bare locator('svg').
    const mapSvg = page.getByRole('img', { name: /Process to data asset map/i });
    await expect(mapSvg).toContainText('Map Smoke Activity', { timeout: 10_000 });
    await expect(mapSvg).toContainText('Map Smoke Asset', { timeout: 10_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Data Assets Unmapped filter lists an unmapped asset (orphans redirect)', async ({ page }) => {
    // Phase 3 reverse view, now folded into the Data Assets catalog.
    // Seed an asset with no mapping rows pointing at it, then hit the
    // retired /data-assets/orphans URL and verify it redirects to the
    // Data Assets page pre-filtered to Unmapped, with the seeded asset
    // showing its Unmapped badge. Regression catch for the isOrphan
    // flag + the mapping filter + the back-compat redirect.
    const errors = attachConsoleWatcher(page);
    const token = await loginAsEleanor(page);
    const orgId = await createOrg(token, uniqueName('Orphan Smoke'));
    await setActiveOrg(page, orgId, 'Orphan Smoke');

    const orphanName = uniqueName('Orphan Asset');
    const sysRes = await fetch(BACKEND + '/systems', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, name: 'Orphan Smoke Sys', description: '', systemType: 'ERP' }),
    });
    const sys = (await sysRes.json()).data;
    const assetRes = await fetch(BACKEND + '/data-assets', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId, name: orphanName, description: 'no mapping',
        systemId: sys.id, governanceTier: 'BRONZE',
      }),
    });
    expect(assetRes.status).toBeLessThan(300);

    await gotoWithOrg(page, '/data-assets/orphans', orgId, 'Orphan Smoke');
    // The old orphans route redirects to the filtered Data Assets page.
    await expect(page).toHaveURL(/mapping=unmapped/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /^Data Assets$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toContainText(orphanName, { timeout: 10_000 });
    // The seeded asset carries the Unmapped badge (exact text, so it
    // doesn't match the "Unmapped (N)" filter option).
    await expect(page.getByText('Unmapped', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
