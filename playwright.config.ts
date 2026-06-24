// Procela end-to-end smoke configuration.
//
// One command — `npm run e2e` — boots the dev server, runs the smoke
// suite against it, and tears the server down. CI just calls
// `npm run e2e` and reads the exit code.
//
// What this is for:
//   - Catch full-stack regressions one short suite at a time: auth,
//     each top-level page rendering, a couple of write actions, and
//     the most-clicked navigation paths.
//   - NOT a comprehensive functional test suite. Per-feature behaviour
//     lives in vitest (frontend) or node:test (backend) where it
//     belongs. This is a "did we ship a broken build" backstop.
//
// What CI needs once: `npx playwright install chromium` to pull the
// browser binary the first time. After that, normal `npm install` +
// `npm run e2e` is enough.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // One worker keeps the suite simple: the dev backend's persistence
  // is shared, and sequential runs are easier to read in logs.
  // Parallelism is a future optimisation if the suite outgrows ~30s.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,

  use: {
    baseURL: 'http://localhost:5173',
    // Capture artefacts when something fails so CI logs link to the
    // exact moment of failure rather than a wall of text.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Boot the whole stack via the existing `npm run dev` script.
  // Reuses the existing server when one is already running locally
  // so a developer iterating on tests doesn't pay the cold-start tax.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  reporter: process.env.CI ? [['github'], ['list']] : 'list',
});
