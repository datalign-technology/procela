// Standalone smoke-org sweep — same code path as the test suite's
// before-all cleanup, but exposed as a one-liner you can run on
// demand (`npm run e2e:clean`) without booting Playwright or running
// any tests.
//
// Assumes the dev stack is reachable at FRONTEND (default
// localhost:5173). If it isn't, this script tells you instead of
// hanging on a network timeout.

import { chromium } from '@playwright/test';
import { FRONTEND, loginAsEleanor, cleanSmokeOrgs } from './helpers';

async function devUp(): Promise<boolean> {
  try {
    const res = await fetch(FRONTEND, { method: 'HEAD' });
    return res.ok || res.status === 304 || res.status === 200;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  if (!(await devUp())) {
    console.error(`[e2e:clean] no dev server at ${FRONTEND} — start it with \`npm run dev\` first.`);
    return 2;
  }
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const token = await loginAsEleanor(page);
    const { scanned, deleted } = await cleanSmokeOrgs(token);
    console.log(`[e2e:clean] swept ${deleted} stale smoke orgs out of ${scanned} total`);
    return 0;
  } catch (err: any) {
    console.error(`[e2e:clean] failed: ${err?.message || err}`);
    return 1;
  } finally {
    await browser.close();
  }
}

main().then((code) => process.exit(code));
