---
name: screenshot-app
description: Launch the Procela web app locally and screenshot authenticated pages (Dashboard, Executive Report, any route) against seeded demo data. Use whenever asked to screenshot, visually verify, or "see" a frontend change in the running app.
---

# Screenshot the Procela app

Boots the full stack in throwaway **in-memory mode** (no Postgres), logs in as
the seeded Super Admin, loads the **Tidewater Utilities** demo tenant, and
screenshots the routes you name. This is the verified path — follow it verbatim.

## Why the obvious approach fails

- **Empty org → onboarding, not the real page.** A fresh dev DB (or a
  leftover test org like "Test Org A") has no data, so the Dashboard renders
  the "Welcome to Procela" setup card and the Report renders its empty state.
  You **must** seed + select the demo org (the script does both).
- **Playwright script location matters.** `import '@playwright/test'` resolves
  against repo-root `node_modules` by walking parent dirs — so the script must
  live **inside the repo** (this skill dir is fine). A copy in a scratch dir
  outside the repo fails with `ERR_MODULE_NOT_FOUND`.
- **Chromium is pre-installed** at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`
  is set). Never run `playwright install`.

## Steps

### 1. Boot the stack (in-memory, no DB)

From the repo root, in the background:

```bash
unset DATABASE_URL   # forces JSON/in-memory persistence — no Postgres needed
nohup npm run dev > /tmp/procela-dev.log 2>&1 &
```

Wait until both are up (frontend :5173, backend :3001):

```bash
for i in $(seq 1 40); do
  fe=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173)
  be=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/v1/health)
  [ "$fe" = "200" ] && [ "$be" = "200" ] && { echo READY; break; }
  sleep 3
done
```

### 2. Screenshot

The script handles dev-login (Eleanor Briggs), `POST /admin/demo-seed` (loads
Tidewater Utilities — idempotent), pinning the active org, and full-page
capture. Pass an output dir and one or more `name=route` pairs:

```bash
node .claude/skills/screenshot-app/shoot.mjs /tmp/shots \
  dashboard=/ \
  report=/reports?tab=executive
```

Common routes: Dashboard `/` · Executive Report `/reports?tab=executive` ·
Scorecard `/reports?tab=scorecard` · Data Assets `/data-assets` · People
`/people`. Any authenticated route works.

### 3. Look at the output

`Read` each PNG under the output dir. A blank frame or the onboarding card =
the seed/org-select step didn't take — re-run step 2 (it's idempotent).

### Teardown (optional)

Leave the server up if you're iterating on visuals. To stop it:
`pkill -f "npm run dev"` (or the vite/tsx child processes).

## Seeded credentials & data

Dev login exposes quick-pick buttons for seeded users; **Eleanor Briggs** is a
Super Admin with full access. `/admin/demo-seed` loads the Tidewater Utilities
tenant (~10 orgs, 24 people, 8 systems, 9 data assets, 15 process nodes, 3
governance groups) — enough to populate every dashboard, report, and list.
