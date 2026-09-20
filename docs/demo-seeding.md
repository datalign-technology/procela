# Procela — Demo data seeding

How to load a realistic, fully-populated demo tenant for any supported
industry. Every path drives the **same** server-side seeder, so the data
is identical no matter how you trigger it.

There are two unrelated seeding systems in the repo — this doc covers the
modern **in-app demo fixtures**. The legacy `db:seed` / `db:seed:momentum`
scripts are a separate, older thing (see [Relationship to the legacy
seeders](#relationship-to-the-legacy-seeders)).

## The one engine

All three entry points call the same super-admin endpoint:

```
POST /api/v1/admin/demo-seed   { "industry": "<key>" }
```

It is implemented by `seedDemoData(industry)` in
`packages/backend/src/services/demo-seed.service.ts` and is exposed by
`packages/backend/src/routes/admin.ts`.

## Industries

| `<key>` | Demo tenant | Shape |
|---|---|---|
| `utilities` | Tidewater Utilities | Multi-utility — electric + water + shared services |
| `shipbuilding` | Meridian Shipbuilding | Naval + commercial shipyard |
| `healthcare` | Cedarline Health | Integrated delivery network — acute + ambulatory |
| `manufacturing` | Forgeline Manufacturing | Discrete manufacturer — plant ops + supply chain |
| `financial` | Harborstone Financial | Bank holding company — retail + wealth & markets |
| `government` | Lakeside County | County government — public works + health & human services |
| `logistics` | Cascade Logistics | Freight carrier — line-haul + warehousing |
| `insurance` | Northwind Mutual | P&C insurer — underwriting + claims |
| `telecom` | Northlink Communications | Telecom carrier — network ops + consumer & business |
| `education` | Blue Ridge University | Research university — academic affairs + research |

These map one-to-one to the industry cards on the procela.ai industry page.

## Three ways to seed

### 1. In-app UI (primary)

**Settings → Data → Load demo data** (super-admin only). Pick a tenant
tile, confirm, and it seeds. This is the intended path for a live demo.

### 2. npm CLI

The app must already be running (`npm run dev` in another terminal); the
script drives the REST API.

```bash
npm run db:seed:demo -w packages/backend -- <key>
# e.g.
npm run db:seed:demo -w packages/backend -- healthcare
```

Or call the script directly (second arg overrides the base URL):

```bash
node packages/backend/scripts/seed-demo.js <key> [baseUrl]
node packages/backend/scripts/seed-demo.js financial http://localhost:3001/api/v1
```

### 3. Docker (one-shot service)

A `demo-seed` service under the `seed` profile waits for the backend to
be healthy, then seeds. A plain `docker compose up` never starts it.

```bash
DEMO_INDUSTRY=healthcare docker compose --profile seed run --rm demo-seed
```

`DEMO_INDUSTRY` defaults to `utilities` when unset.

## What each fixture contains

Every industry seeds the **same fixed skeleton** — only the domain
content differs — so a demo of any tenant lights up every page:

- **10 organizations** — 1 company → 3 divisions → 6 departments
  (branding lives on the company).
- **24 people** — person #1 is the **CDO persona** (e.g. Dr. Naomi Okafor
  for Healthcare), an `ORG_ADMIN` pre-loaded with tasks + an issue so **My
  Dashboard** tells a story; plus a Data Governance Lead, DAMA roles,
  skills and skill assignments, and a RACI override.
- **8 systems**, **5 agents** (one per agent type, with schedules +
  executions), **6 data domains** (3 top-level + 3 sub-domains).
- **9 data assets** — mixed Bronze/Silver/Gold, including **2 planted
  orphans** (`healthScore: 0`, unmapped) so Ask-AI orphan detection and
  gap views have something to find.
- **15 process nodes** across **2 value streams**
  (Value Stream → Process → Sub-Process → Activity) with flow
  relationships, and **7 process↔data mappings**.
- **3 governance tasks, 1 ownership issue, 2 DQ rules** (one passing, one
  failing — the failing rule and the issue target the **same Bronze,
  business-critical asset** so the story stays coherent).
- **2 connectors** (one ONLINE, one PAIRING) + 5 connector events,
  **1 weekly governance-calendar event**, **40 weekly stats snapshots**,
  governance / docs / lineage / agent-ops / collaboration depth, and
  **2 pre-warmed AI-template cache** entries.

## Behavior

- **Super-admin only.** The endpoint requires `SUPER_ADMIN`. The CLI
  signs in as `eleanor.briggs@tidewater-utilities.com` by default;
  override with `SEED_ADMIN_EMAIL`. This assumes the default dev auth
  provider (`AUTH_PROVIDER=dev`), which mints a token for that email +
  role with no password — point `SEED_ADMIN_EMAIL` at your bootstrapped
  super-admin for non-dev setups.
- **Idempotent.** Every row is stamped with a `demo-*` id. Re-seeding
  first sweeps all `demo-*` rows, so it always converges on a known
  state — safe to run repeatedly.
- **One demo tenant at a time.** Seeding a different industry clears the
  previous demo tenant (the sweep is global to the `demo-*` prefix).
- **Storage-agnostic.** The seeder writes through the mode-aware
  repository factories, so it persists correctly in **either the JSON dev
  store or Postgres** (`DATABASE_URL` set).

## Relationship to the legacy seeders

`npm run db:seed` (Tidewater Utilities) and `npm run db:seed:momentum`
(Momentum Industries) are **separate, older** CLI scripts
(`scripts/seed-tidewater.js`, `scripts/seed-momentum-governance.js`) that
build a different test-data tenant by POSTing to the ordinary catalog
endpoints. They are **not** `demo-*`-prefixed and are **not** seedable
from the UI picker. Docker-compose wires them into the connector demo
(`--profile demo`, see [`edge-connector-demo.md`](./edge-connector-demo.md)).
They are untouched by the demo-fixture system above.

## Troubleshooting

- **`403 This action requires a SUPER_ADMIN`** — the login didn't resolve
  to a super-admin. Check `SEED_ADMIN_EMAIL` and that `AUTH_PROVIDER=dev`
  (or that the email is a bootstrapped super-admin).
- **`ECONNREFUSED` / login failed** — the app isn't running or the base
  URL is wrong. Start it (`npm run dev`) and confirm the backend is on
  `http://localhost:3001` (`GET /api/v1/health`).
- **`Unknown industry "…"`** — the key must be one of the [industries
  above](#industries).
