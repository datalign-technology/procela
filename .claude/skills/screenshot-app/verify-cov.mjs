import { chromium } from '@playwright/test';
const FE = 'http://localhost:5173', BE = 'http://localhost:3001/api/v1';
const outDir = process.argv[2] || '/tmp/shots-cov';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage();
await page.goto(FE + '/login', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('procela:onboarding-complete', 'true'); localStorage.setItem('procela:shortcuts-hint-dismissed', '1'); });
await page.getByRole('button', { name: /Eleanor Briggs/i }).click();
await page.waitForFunction(() => !!localStorage.getItem('auth-storage'), null, { timeout: 15000 });
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage')).state.accessToken);
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const get = async (u) => (await fetch(BE + u, { headers: H })).json();
await fetch(BE + '/admin/demo-seed', { method: 'POST', headers: H, body: '{}' }).catch(() => {});
const orgs = (await get('/organizations')).data || [];
const demo = orgs.find((o) => /tidewater utilities/i.test(o.name)) || orgs[0];
const orgId = demo.id;
const prog = (await get(`/governance-program?orgId=${orgId}`)).data;
const domains = (await get('/data-domains')).data.filter((d) => d.orgId === orgId || (d.orgIds || []).includes(orgId));
// Scope to first two domains for a richer read-out.
const domIds = domains.slice(0, 2).map((d) => d.id);
await fetch(BE + `/governance-program/${prog.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ scope: { domainIds: domIds, systemIds: [], valueStreamIds: [] } }) });
console.log('scope-coverage (empty check):', JSON.stringify((await get(`/governance-program/scope-coverage?orgId=nonexistent`)).data));
console.log('scope-coverage (scoped):', JSON.stringify((await get(`/governance-program/scope-coverage?orgId=${orgId}`)).data));

// Screenshot the Foundation scope tab.
await page.evaluate((o) => localStorage.setItem('org-context', JSON.stringify({ state: { activeOrgId: o.id, activeOrgName: o.name, activeOrgType: 'company' }, version: 0 })), demo);
await page.goto(FE + '/governance/foundation', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/foundation-coverage.png`, fullPage: false });
console.log('shot: foundation-coverage');
await browser.close();
