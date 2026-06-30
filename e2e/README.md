# Procela end-to-end smoke

One short Playwright suite that catches full-stack regressions before
they ship. It boots the whole dev stack (backend + frontend), drives
Chromium through five top-level user flows, and exits non-zero on the
first JS error or failed assertion. Total runtime ~40 seconds.

## Run it

```bash
npm install              # one time — pulls @playwright/test
npm run e2e:install      # one time — downloads the Chromium build
npm run e2e              # boots dev, runs the suite, tears it down
```

Already running `npm run dev` in another terminal? The Playwright
config reuses the existing server when it sees one on
`http://localhost:5173`, so the suite picks up your live process and
doesn't fight it.

## Cleaning up dev pollution

The smoke suite creates a fresh org per test, and the dev backend
auto-saves every one to `.procela-data/organizations.json`. The
suite's own `beforeAll` sweeps stale rows before each run — so left
to itself the picker stays clean — but if you want to scrub
between runs without launching the test suite:

```bash
npm run e2e:clean        # requires `npm run dev` to be running
```

Deletes every org whose name starts with one of the smoke prefixes
(`Smoke Org`, `People Smoke`, `Roles Smoke`, `Form Smoke`,
`Data Map Smoke`, `Orphan Smoke`). Cascade-delete handles the
people/assets/mappings each org owns. Fails fast with a clear hint
if no dev server is reachable rather than hanging on a timeout.

Same code path as the suite's `beforeAll` — adding a new smoke
prefix means updating one place (`SMOKE_NAME_PREFIXES` in
`helpers.ts`), and both commands pick up the change.

## What the suite covers

| Test | Validates |
|---|---|
| `Eleanor can sign in and lands on the dashboard` | Auth flow + Layout shell |
| `every top-level page renders without errors` | 23 routes mount with zero JS errors |
| `creating a person through the API surfaces on the People page` | List page + active-org filter |
| `assigning a CDO surfaces on the Governance Roles page` | DAMA assignment + table render |
| `the assign-role form opens and lists the org's people` | PersonPicker integration |

## What it is *not*

This is a smoke suite, not a functional test suite. Per-feature
behaviour belongs in `vitest` (frontend components) or `node:test`
(backend routes) where it can run in milliseconds. The smoke runs in
seconds and is intended to backstop "is the build shippable".

## Adding a test

Three rules:

1. Use the helpers in `helpers.ts` for setup (login, create org, set
   active org). Reserve the UI for the thing being smoked, not the
   ten clicks it takes to get there.
2. Treat any `pageerror` or unfiltered `console.error` as a
   regression. Add to `KNOWN_NOISE` only if the error is genuinely
   benign and unrelated to the test.
3. Use `gotoWithOrg(page, path, orgId)` instead of `page.goto(path)`
   whenever the assertion depends on the active-org filter. The dev
   backend accumulates orgs across runs and Layout's auto-select can
   otherwise clobber a freshly-set `activeOrgId`.

## Known noise

`KNOWN_NOISE` in `smoke.spec.ts` filters two classes of console error:

- `Failed to load resource: …` — browser-level message for any
  non-2xx response. Real API failures are caught elsewhere.
- `/skills/gap-report` — endpoint isn't implemented; polled by a
  dashboard widget. Pre-existing.

When `skills/gap-report` lands or stops being polled, drop it.
