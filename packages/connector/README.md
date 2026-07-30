# Procela on-prem connector

A small Node 20 agent that runs **inside your network**, scans
configured data sources for catalog metadata (table names, row
counts, freshness), and ships only that metadata back to Procela
over an outbound HTTPS connection. Connection strings and row
data stay on-prem.

This package builds a single container image (`procela-connector`)
that takes one YAML config file. It is intended for customers who
cannot give Procela direct network access to their databases.

## What it sends

For each table or view in every configured schema:

- `schema.table_name`
- approximate row count (`pg_stat_user_tables.n_live_tup`)
- last-vacuum / last-analyze timestamp (freshness proxy)
- optional `obj_description` comment
- its **columns** — name, data type, nullability, ordinal position
  (from the SQL-standard `information_schema.columns`)

No row values. No connection strings. No credentials. Column
**names and types** cross the wire; column **data** never does.

## Pairing flow

1. Open Procela → **Settings → Connectors → Add connector**. A
   one-time 8-digit code appears. The code expires in 10 minutes
   and can only be claimed once.
2. Drop that code into `connector.yaml` (`pairingCode:`) or pass
   it via `PROCELA_PAIRING_CODE` on first boot.
3. Start the container. On first run the connector exchanges the
   code for a long-lived bearer token (`pct_…`), rewrites the
   YAML so subsequent runs skip pairing, and drops into its
   heartbeat / scan loop.
4. If the config mount is read-only the token is printed to
   stdout instead — paste it under `token:` and restart.

The plaintext token is shown **once**, at claim time. Procela
stores only a SHA-256 hash. Lose it and you must revoke + re-pair.

## Pull & run (recommended)

Pre-built multi-arch images (`linux/amd64`, `linux/arm64`) are
published to GitHub Container Registry on every release. Pull the
pinned semver tag for production deployments:

```bash
docker pull ghcr.io/crossleyc-bot/procela-connector:0.1.0

docker run --rm \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml" \
  ghcr.io/crossleyc-bot/procela-connector:0.1.0

# Or pass the pairing code via env on first boot
docker run --rm \
  -e PROCELA_PAIRING_CODE=12345678 \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml" \
  ghcr.io/crossleyc-bot/procela-connector:0.1.0
```

Available tags:

- `:0.1.0`, `:0.1`, `:0`, `:latest` — published on each
  `connector-vX.Y.Z` git tag
- `:edge` — auto-built from every push to the main branch
- `:sha-<short>` — every build, for exact-provenance pinning

See `connector.example.yaml` for the full config shape.

## Build from source

If you'd rather build the image yourself (no internet pull, or
local source edits):

```bash
docker build -t procela-connector packages/connector
docker run --rm \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml" \
  procela-connector
```

## Local development

```bash
npm install -w packages/connector
npm run dev -w packages/connector   # tsx, no build step
npm run build -w packages/connector # emits dist/
npm run lint -w packages/connector
```

## Operating notes

- Outbound HTTPS only. No inbound port is required.
- Logs are structured JSON on stdout — pipe to your container
  logger. Lines are prefixed `[procela-connector]`.
- SIGINT / SIGTERM trigger a clean exit at the next loop slice.
- **Liveness.** The agent runs no HTTP server, so there's no port to
  probe. Instead each loop iteration touches a liveness file
  (`/tmp/procela-connector.alive` by default; override with
  `livenessFile:` in the config or `PROCELA_CONNECTOR_LIVENESS_FILE`)
  with the current time. The same binary run as
  `node dist/index.js --healthcheck` exits `0` if that file is fresh
  and `1` once it goes stale (default staleness window
  `max(3 × heartbeat, 180s)`), so a wedged loop is detected and the
  container is restarted. The Docker image ships a `HEALTHCHECK` that
  does exactly this. On Kubernetes, wire an `exec` liveness probe:

  ```yaml
  livenessProbe:
    exec:
      command: ["node", "/app/dist/index.js", "--healthcheck"]
    initialDelaySeconds: 90
    periodSeconds: 60
    timeoutSeconds: 10
    failureThreshold: 3
  ```

  Liveness tracks the *loop*, not backend reachability — the file is
  refreshed whether or not the heartbeat POST reached Procela, so a
  network outage never trips the probe.
- A failed report is retried with capped exponential backoff
  (5 attempts: 0.5s, 1s, 2s, 4s) before the cycle is abandoned, so a
  brief backend blip doesn't cost a whole scan interval. A heartbeat
  miss self-heals on the next beat. A *rejected* report (bad token,
  validation) is not retried.
- Multiple connectors per org are supported. Procela tags each
  reported asset with the connector that observed it.
- Freshness states in the Procela UI: **ONLINE** (heartbeat in
  the last 30 min), **STALE** (30 min – 4 h), **OFFLINE** (> 4 h).

## Supported sources

| Type         | Config `type:` | Status |
| ------------ | -------------- | ------ |
| Postgres     | `postgres`     | v1 (0.1.x) |
| SQL Server   | `sqlserver`    | v1 (0.2.x) |
| MySQL / MariaDB | `mysql`     | v1 (0.3.x) |
| Oracle       | `oracle`       | v1 (0.5.x) |
| dbt manifest | `dbt`          | v1 (0.4.x) |

The **Oracle** source uses `oracledb` in **thin mode** — pure
JavaScript, so no Oracle Instant Client is needed in the image. It reads
`all_tables` / `all_views` / `all_tab_columns`; row counts come from the
optimizer stats (`num_rows`) and freshness from `last_analyzed`. With no
`schemas:` list it scans the connecting user's own schema (`owner =
USER`).

The **dbt** source reads a local `manifest.json` (from `dbt compile` /
`dbt run`) and ships each model / source / seed / snapshot as an asset
with its columns — no database connection required. Asset identity
(`schema.relation`) matches Procela's in-app dbt import and live DB
scans, so the three ingest paths reconcile onto the same assets. Lineage
and dbt tests are captured by the richer in-app dbt import; the edge
source captures models + columns.

Cloud warehouses (Snowflake / BigQuery / Redshift / Databricks) are
intentionally out of scope for the edge agent — they always have
routable endpoints, so use a **Data Connection** in the Procela UI
instead. The agent exists specifically to reach databases Procela
cannot.
