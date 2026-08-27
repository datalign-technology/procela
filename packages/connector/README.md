# Procela on-prem connector

A small Node 20 agent that runs **inside your network**, scans
configured data sources for catalog metadata (table names, row
counts, freshness), evaluates supported data-quality rules against
them, and ships that metadata plus aggregate DQ results (pass/fail
counts) back to Procela over an outbound HTTPS connection.
Connection strings and row data stay on-prem.

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

## Security

The connector's security posture, and the answer to "where do the source
database credentials live?":

- **Credentials never leave your network.** Connection strings and row
  data stay on-prem; only catalog **metadata** (schema/table/column names
  and types) is sent outbound over HTTPS. A compromise on the Procela side
  cannot expose a source credential — Procela never receives one.
- **Least privilege.** Point the connector at a **read-only** database
  account (the examples use `procela_ro`). It only ever issues catalog /
  `information_schema` reads.
- **Secrets need not sit in the config file.** A source `connectionString`
  can reference a secret the host already holds instead of embedding the
  password inline:

  ```yaml
  connectionString: postgres://procela_ro:${PG_PASSWORD}@db.internal:5432/warehouse
  # or from a mounted secret file (Docker/K8s secret, Vault agent, …):
  connectionString: postgres://procela_ro:${file:/run/secrets/db_pw}@db.internal:5432/warehouse
  ```

  `${ENV_VAR}` resolves from the environment; `${file:/path}` reads a
  mounted secret file (a single trailing newline is stripped). Only the
  referenced span is substituted, so the rest of the DSN stays readable in
  the file. Resolution happens **at scan time**, so (a) the resolved
  secret is never written back to the config when the connector rewrites
  it with its pairing token, and (b) a rotated secret is picked up on the
  next scan without a restart. A referenced secret that can't be resolved
  fails that source's scan with a clear error rather than connecting with
  a broken credential.
- **Deploy the config as a secret, not a plaintext file.** Mount
  `connector.yaml` from a **Docker/Kubernetes Secret** (or `chmod 600` it
  on a bare host), keep it out of source control, and prefer a **read-only
  mount** — the connector will print the issued token to stdout for you to
  inject via `PROCELA_CONNECTOR_TOKEN` rather than rewriting the file.
- **The Procela token is a bearer credential.** It is shown once at claim
  time; Procela stores only a SHA-256 hash. Treat it like the DB
  credentials above (secret file / env), and revoke + re-pair if it leaks.

## Pairing flow

1. Open Procela → **Settings → Integrations → On-prem connectors → Add
   connector**. A one-time 8-digit code appears. The code expires in 10 minutes
   and can only be claimed once.
2. Drop that code into `connector.yaml` (`pairingCode:`) or pass
   it via `PROCELA_PAIRING_CODE` on first boot.
3. Start the container. On first run the connector exchanges the
   code for a long-lived bearer token (`pct_…`), rewrites the
   YAML so subsequent runs skip pairing, and drops into its
   heartbeat / scan loop.
4. If the config mount is read-only the token is printed to
   stdout instead (as `PROCELA_CONNECTOR_TOKEN=…`) — supply it back via
   the `PROCELA_CONNECTOR_TOKEN` env var (keeps it off disk) or paste it
   under `token:`, then restart.

The plaintext token is shown **once**, at claim time. Procela
stores only a SHA-256 hash. Lose it and you must revoke + re-pair.

## Pull & run (recommended)

Pre-built multi-arch images (`linux/amd64`, `linux/arm64`) are
published to GitHub Container Registry: pinned semver tags on each
tagged release, and `:edge` on every push to the main branch. For
production, **pin a released version** — `0.3.0` is the latest — so a
trunk push can't move the image underneath you:

```bash
docker pull ghcr.io/datalign-technology/procela-connector:0.3.0

docker run --rm \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml" \
  ghcr.io/datalign-technology/procela-connector:0.3.0

# Or pass the pairing code via env on first boot
docker run --rm \
  -e PROCELA_PAIRING_CODE=12345678 \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml" \
  ghcr.io/datalign-technology/procela-connector:0.3.0
```

Available tags:

- `:0.3.0`, `:0.3`, `:0`, `:latest` — published on each
  `connector-vX.Y.Z` git tag. `connector-v0.3.0` is the latest
  release; `:0.3` and `:0` float to the newest patch/minor within
  that line. **Use one of these for production.**
- `:edge` — auto-built from every push to the main branch. Tracks
  trunk ahead of the next release; use it only to try unreleased fixes.
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

## Behind a corporate proxy

Enterprises often force all outbound traffic through an inspecting HTTP
proxy. Node's built-in `fetch` does **not** read the proxy environment
variables on its own (unlike `curl`), so the connector reads them for it
and installs a proxy dispatcher at startup:

- Set **`HTTPS_PROXY`** (or `HTTP_PROXY`) to your proxy URL, including the
  scheme — e.g. `http://proxy.corp:3128`. A value missing the `http://`
  is treated as a typo and the connector goes direct with an explanatory
  log line rather than silently ignoring it.
- **`NO_PROXY`** is honoured (comma-separated hosts/domains, or `*`), so
  you can carve the Procela host back out to go direct.
- Only the **outbound Procela traffic** (pair / heartbeat / report) is
  proxied. Source-database connections (`pg` / `mysql2` / `mssql` /
  `oracledb`) open their own TCP sockets and are **not** routed through
  the proxy — those targets sit inside your network, where an internet
  proxy would only break them.

Every start logs which path it took, so a bad proxy setting is
diagnosable from the container logs alone (passwords are redacted):

```
[procela-connector] proxy: routing via http://proxy.corp:3128/
[procela-connector] proxy: no proxy configured — going direct
[procela-connector] proxy: app.procela.ai excluded by NO_PROXY — going direct
```

**TLS-inspecting proxies.** When the proxy re-signs traffic with your
company's own certificate authority, point `NODE_EXTRA_CA_CERTS` at the
CA's PEM bundle. Node reads it at startup — no connector setting changes:

```bash
docker run --rm \
  -e HTTPS_PROXY=http://proxy.corp:3128 \
  -e NODE_EXTRA_CA_CERTS=/etc/procela/corp-ca.pem \
  -v "$(pwd)/corp-ca.pem:/etc/procela/corp-ca.pem:ro" \
  -v "$(pwd)/connector.yaml:/etc/procela/connector.yaml:ro" \
  ghcr.io/datalign-technology/procela-connector:edge
```

## Supported sources

| Type         | Config `type:` | Status |
| ------------ | -------------- | ------ |
| Postgres     | `postgres`     | v1 (0.1.x) |
| SQL Server   | `sqlserver`    | v1 (0.2.x) |
| MySQL / MariaDB | `mysql`     | v1 (0.3.x) |
| Oracle       | `oracle`       | v1 (0.3.x) |
| dbt manifest | `dbt`          | v1 (0.3.x) |

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
