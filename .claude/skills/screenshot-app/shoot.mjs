// Screenshot authenticated Procela pages against the seeded demo tenant.
//
// Assumes the dev stack is ALREADY running (frontend :5173, backend :3001).
// Boot it first with `npm run dev` from the repo root (in-memory JSON mode —
// no DATABASE_URL, no Postgres needed).
//
// Usage:
//   node .claude/skills/screenshot-app/shoot.mjs <outDir> <name=route> [<name=route> ...]
// Example:
//   node .claude/skills/screenshot-app/shoot.mjs /tmp/shots dashboard=/ report=/reports?tab=executive
//
// This file lives inside the repo so `import '@playwright/test'` resolves
// against the repo-root node_modules (Node walks parent dirs). A copy placed
// OUTSIDE the repo (e.g. a scratch dir) fails with ERR_MODULE_NOT_FOUND.
import { chromium } from '@playwright/test';

const [outDir, ...pairs] = process.argv.slice(2);
if (!outDir || pairs.length === 0) {
  console.error('usage: shoot.mjs <outDir> <name=route> [<name=route> ...]');
  process.exit(1);
}

const FE = 'http://localhost:5173';
const BE = 'http://localhost:3001/api/v1';

const browser = await chromium.launch(); // Chromium is pre-installed at /opt/pw-browsers — never run `playwright install`.
const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage();

// Dev quick-login as the seeded Super Admin, and skip the onboarding wizard.
await page.goto(FE + '/login', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('procela:onboarding-complete', 'true'));
await page.getByRole('button', { name: /Eleanor Briggs/i }).click();
await page.waitForFunction(() => !!localStorage.getItem('auth-storage'), null, { timeout: 15000 });
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage')).state.accessToken);

// Ensure the populated demo tenant (Tidewater Utilities) exists, then pin it
// as the active org — an empty org renders onboarding, not the real pages.
await fetch(BE + '/admin/demo-seed', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: '{}',
}).catch(() => {});
const orgs = (await (await fetch(BE + '/organizations', { headers: { Authorization: 'Bearer ' + token } })).json()).data || [];
const demo = orgs.find((o) => /tidewater utilities/i.test(o.name)) || orgs[0];
await page.evaluate(
  (o) => localStorage.setItem('org-context', JSON.stringify({ state: { activeOrgId: o.id, activeOrgName: o.name, activeOrgType: 'company' }, version: 0 })),
  demo,
);
console.log('active org:', demo?.name);

for (const pair of pairs) {
  const i = pair.indexOf('=');
  const name = pair.slice(0, i);
  const route = pair.slice(i + 1);
  await page.goto(FE + route, { waitUntil: 'networkidle' });
  // Layout's accessible-orgs auto-select can clobber the pinned org on first
  // render — re-assert it and reload if it didn't stick (else you screenshot
  // an empty org showing onboarding / all-zeros).
  await page.waitForTimeout(400);
  const stuck = await page.evaluate((id) => {
    try { return JSON.parse(localStorage.getItem('org-context')).state?.activeOrgId === id; } catch { return false; }
  }, demo.id);
  if (!stuck) {
    await page.evaluate((o) => localStorage.setItem('org-context', JSON.stringify({ state: { activeOrgId: o.id, activeOrgName: o.name, activeOrgType: 'company' }, version: 0 })), demo);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2500); // let data fetch + skeleton→data settle
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log('shot:', name, '→', route, stuck ? '' : '(re-pinned org)');
}

await browser.close();
console.log('DONE');
