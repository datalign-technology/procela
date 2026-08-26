# Edge-connector demo (utility + shipbuilder data)

Run a **real** Procela on-prem edge connector against a **real** source database
seeded with the utility (Tidewater Utilities) and shipbuilder (Momentum
Industries) test data — and watch it discover the tables and measure their data
quality inside the app. No stubs, no fabricated connector row.

## What it shows

- The connector connects to a customer's operational database **on-prem**,
  discovers its tables and columns, and reports them to Procela as **Bronze**
  data assets. Row values never leave the source — only names, types, row
  counts, and freshness.
- When you add data-quality rules to those columns, the connector runs them as
  **aggregate pushdown** queries inside the source network and pushes back only
  pass/fail counts — driving **measured** health (badged as real, not "Est").

## One command

```bash
docker compose --profile demo up --build
```

That brings up the normal stack **plus** four demo services:

| Service | Role |
|---|---|
| `source-db` | A stand-in **customer** Postgres, seeded from `docker/demo/source-db/init/*.sql` with `utility.*` and `shipbuilder.*` operational tables (with deliberately dirty rows so DQ is non-trivial). This is **not** Procela's store. |
| `demo-seed` | Seeds the Procela app tenant (org, admin, systems) so the connector has a home to pair into. Runs once. |
| `demo-bootstrap` | Pairs a real connector (`pair/start` → `pair/claim`) and writes `connector.yaml` to a shared volume. Runs once. |
| `connector` | The real agent. Reads that config, discovers the source tables, reports them, and measures any DQ rules. |

A plain `docker compose up` (no `--profile demo`) is unchanged.

## See it in the app

1. Open the app at <http://localhost:3000> and sign in (dev quick-login is fine).
2. Switch the org scope to **Tidewater Utilities**.
3. **Data → Data Assets → Registry** — search `utility.` or `shipbuilder.` to see
   the 8 discovered source tables, all **Bronze** (new arrivals surface as work
   items, not silently approved). Expand a row to see the discovered columns.
4. **Settings → Connectors** — the connector shows **ONLINE** with a recent
   heartbeat and its scan events.

## Measure data quality with the connector

Discovery alone doesn't measure quality — you tell Procela which columns matter:

1. Go to **Data → Data Quality → Rules → Add Rule**.
2. Pick a discovered asset (e.g. `utility.billing_accounts`), then use the
   **Column** picker to target a column, e.g. `email`, rule type **NOT_NULL**.
   Add a couple more (e.g. `service_class` **IN_SET**
   `residential,commercial,industrial`; `work_packages.pct_complete`
   **NUMERIC_RANGE** 0–100).
3. Within one scan cycle (`scanSeconds`, 30s in the demo) the connector picks up
   the rule plan, runs the aggregate query against the source DB, and the rule
   flips to a **measured** score. With the seeded data you'll see realistic
   numbers — e.g. `email` NOT_NULL lands around **94%** (≈6% of rows have a null
   or malformed address), not a fabricated 100%.

The five pushdown-safe rule types run measured on the connector: `NOT_NULL`,
`UNIQUE`, `IN_SET`, `NUMERIC_RANGE`, `LENGTH_RANGE`. `REGEX_MATCH` / `CUSTOM`
still simulate.

## Tuning

`docker/demo/bootstrap.mjs` renders the connector config from env (set on the
`demo-bootstrap` service in `docker-compose.yml`):

- `SCAN_SECONDS` / `HEARTBEAT_SECONDS` — cadences (kept short for the demo).
- `SOURCE_DSN` — the source database DSN (defaults to the `source-db` service).
- `CONNECTOR_NAME`, `ADMIN_EMAIL` — connector display name and the tenant admin
  to pair as.

To add or change the sample source tables, edit
`docker/demo/source-db/init/01-utility.sql` / `02-shipbuilder.sql` and recreate
the `source-db` volume.

## Reset

```bash
docker compose --profile demo down -v   # -v also drops the seeded source DB
```

## Running the connector without Docker

The same flow works against a locally-running backend and any Postgres:

```bash
# 1. Load the sample data into a Postgres you control:
psql "$SOURCE_DSN" -f docker/demo/source-db/init/01-utility.sql
psql "$SOURCE_DSN" -f docker/demo/source-db/init/02-shipbuilder.sql

# 2. Pair a connector + render config (writes ./connector.yaml):
PROCELA_URL=http://127.0.0.1:3001/api/v1 \
ADMIN_EMAIL=admin@tidewater-utilities.com \
SOURCE_DSN="$SOURCE_DSN" OUT=./connector.yaml \
node docker/demo/bootstrap.mjs

# 3. Run the agent:
PROCELA_CONNECTOR_CONFIG=./connector.yaml npm run dev -w packages/connector
```
