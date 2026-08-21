#!/usr/bin/env node
// Procela connector — entry point.
//
// Run modes (chosen by config + env):
//   1. Pair-and-exit: PROCELA_PAIRING_CODE set (or config has
//      pairingCode) — exchange code for a token, print it to
//      stdout once, exit 0. Lets the admin run the container
//      ephemerally, capture the token, then bake it into a
//      persistent config.
//   2. Steady-state: token present in config — start the loop:
//      send a heartbeat every cfg.heartbeatSeconds, run a scan
//      every cfg.scanSeconds, log the upsert counts. Exits on
//      SIGINT/SIGTERM after a clean iteration.
//
// We deliberately keep the runtime small: native fetch (Node 20+),
// pg as the one source-adapter dep, yaml for config parsing.
//
// Secret handling is minimal by design: a source connectionString may
// carry its password inline, or reference the host's secret store with
// `${ENV_VAR}` / `${file:/path}` (resolved at scan time — see secrets.ts),
// so the config file need not hold plaintext credentials. Keeping the
// file itself access-controlled (file perms, a Docker/K8s Secret rather
// than a plaintext bind-mount, out of source control) remains the
// operator's job.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ConnectorConfig, ReportedAsset } from './types';
import { normalizeConfig, LIVENESS_FILE_DEFAULT } from './config';
import { resolveSourceSecrets, defaultResolvers } from './secrets';
import { writeLiveness, checkLiveness } from './liveness';
import { pairClaim, heartbeat, report } from './api';
import { scanPostgres } from './postgres';
import { scanSqlServer } from './sqlserver';
import { scanMysql } from './mysql';
import { scanDbt } from './dbt';
import { scanOracle } from './oracle';
import { withRetry } from './retry';
import { configureProxy } from './proxy';

// Resolvers for ${ENV_VAR} / ${file:/path} references in source
// connection strings — the real process env + filesystem.
const secretResolvers = defaultResolvers((p) => readFileSync(p, 'utf-8'));

function log(msg: string, extra: Record<string, unknown> = {}): void {
  // Structured stdout — every line is JSON so a container logger
  // can consume it without parsing English. Skip the structured
  // shape when no extras are present so plain operator messages
  // stay scannable.
  if (Object.keys(extra).length === 0) {
    process.stdout.write(`[procela-connector] ${msg}\n`);
    return;
  }
  process.stdout.write(
    `[procela-connector] ${msg} ${JSON.stringify(extra)}\n`,
  );
}

function loadConfig(): { path: string; cfg: ConnectorConfig } {
  const path = process.env.PROCELA_CONNECTOR_CONFIG || '/etc/procela/connector.yaml';
  if (!existsSync(path)) {
    throw new Error(
      `connector config not found at ${path} — set PROCELA_CONNECTOR_CONFIG or mount it at the default path`,
    );
  }
  const raw = readFileSync(path, 'utf-8');
  // Defaulting + env overrides live in ./config (normalizeConfig) so
  // they're unit-testable without file IO.
  const cfg = normalizeConfig(parseYaml(raw), process.env);
  return { path, cfg };
}

function rewriteConfigWithToken(path: string, cfg: ConnectorConfig, token: string): void {
  const next = { ...cfg, token };
  delete (next as any).pairingCode;
  try {
    writeFileSync(path, stringifyYaml(next), 'utf-8');
    log('config rewritten with new token', { path });
  } catch (err: any) {
    // Mount may be read-only. Surface the token to stdout so the
    // operator can paste it into a persistent config themselves.
    log('could not rewrite config (read-only mount?) — token follows; paste into your config and restart',
      { err: err?.message || String(err) });
    process.stdout.write(`PROCELA_CONNECTOR_TOKEN=${token}\n`);
  }
}

async function pairOnce(cfg: ConnectorConfig, path: string): Promise<string | null> {
  if (!cfg.pairingCode) return null;
  log('pairing with Procela', { url: cfg.procelaUrl });
  const res = await pairClaim(cfg, cfg.pairingCode);
  if (!res.success || !res.data) {
    log('pairing failed', { error: res.error || 'unknown' });
    process.exit(2);
  }
  log('paired successfully', { connectorId: res.data.connectorId });
  rewriteConfigWithToken(path, cfg, res.data.token);
  return res.data.token;
}

async function runScan(cfg: ConnectorConfig): Promise<void> {
  let total = 0;
  const all: ReportedAsset[] = [];
  for (const rawSource of cfg.sources) {
    log('scanning source', { name: rawSource.name, type: rawSource.type });
    try {
      // Resolve ${ENV_VAR} / ${file:/path} references in the connection
      // string here, at scan time — so the on-disk config keeps the
      // reference (never the resolved secret) and a rotated secret is
      // picked up without a restart. A missing secret throws and is
      // caught below, skipping just this source with a clear message.
      const source = resolveSourceSecrets(rawSource, secretResolvers);
      let assets: ReportedAsset[];
      switch (source.type) {
        case 'postgres':
          assets = await scanPostgres(source);
          break;
        case 'sqlserver':
          assets = await scanSqlServer(source);
          break;
        case 'mysql':
          assets = await scanMysql(source);
          break;
        case 'dbt':
          assets = await scanDbt(source);
          break;
        case 'oracle':
          assets = await scanOracle(source);
          break;
        default:
          // TypeScript's exhaustiveness check would flag a missing
          // case here; the runtime log is the fallback for a config
          // that references a type the current binary was built
          // before it knew about.
          log('skipping unsupported source type', { type: (source as { type: string }).type, name: (source as { name: string }).name });
          continue;
      }
      log('discovered assets', { source: source.name, count: assets.length });
      all.push(...assets);
      total += assets.length;
    } catch (err: any) {
      log('scan failed for source', { source: rawSource.name, error: err?.message || String(err) });
    }
  }
  if (all.length === 0) {
    log('no assets discovered — nothing to report');
    return;
  }
  // Retry the report on a transient network failure (thrown by fetch)
  // with capped exponential backoff, so a brief blip doesn't drop the
  // whole scan until the next interval. A returned { success: false }
  // is a logical rejection (bad token, validation) — not retried.
  let res;
  try {
    res = await withRetry(() => report(cfg, all), {
      maxAttempts: 5,
      onRetry: (attempt, err) =>
        log('report failed, retrying', { attempt, error: (err as { message?: string })?.message || String(err) }),
    });
  } catch (err: any) {
    log('report failed after retries — will retry next scan', { error: err?.message || String(err) });
    return;
  }
  if (!res.success) {
    log('report rejected', { error: res.error || 'unknown' });
    return;
  }
  log('report accepted', { ...res.data });
  void total;
}

async function main(): Promise<void> {
  const { path, cfg } = loadConfig();
  // Install the HTTPS/HTTP proxy dispatcher before any fetch runs —
  // pairOnce/heartbeat/report all go through native fetch, which does
  // not read the proxy env vars on its own. Logs which path it took so
  // a broken proxy install is diagnosable from the container logs.
  log(`proxy: ${configureProxy(cfg.procelaUrl)}`);
  // Pair-and-keep-going: capture the new token, then drop into the
  // steady-state loop using it. If pairing is the only step the
  // operator wanted, they can ctrl-c right after.
  if (!cfg.token) {
    const newToken = await pairOnce(cfg, path);
    if (newToken) cfg.token = newToken;
  }
  if (!cfg.token) {
    log('no token after pairing attempt — exiting');
    process.exit(2);
  }

  log('entering steady-state loop', {
    heartbeatSeconds: cfg.heartbeatSeconds,
    scanSeconds: cfg.scanSeconds,
    sources: cfg.sources.length,
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log('shutting down on signal');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let lastScanAt = 0;
  while (!stopping) {
    const ok = await heartbeat(cfg);
    if (!ok) log('heartbeat failed — backend rejected or unreachable');
    // Touch the liveness file every loop — reflects the loop is
    // progressing, independent of whether the heartbeat POST reached
    // the backend. A wedged loop lets it go stale and the container's
    // --healthcheck probe restarts the agent.
    writeLiveness(cfg.livenessFile!, Date.now());

    const now = Date.now();
    if (now - lastScanAt > cfg.scanSeconds * 1000) {
      await runScan(cfg).catch((err) => log('scan iteration threw', { err: err?.message || String(err) }));
      lastScanAt = now;
    }
    // Sleep in small slices so SIGINT lands quickly.
    const target = now + cfg.heartbeatSeconds * 1000;
    while (Date.now() < target && !stopping) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log('clean exit');
}

/** `--healthcheck` mode (also PROCELA_CONNECTOR_HEALTHCHECK): a
 *  short-lived probe the container liveness check execs. Reports healthy
 *  iff the liveness file the main loop touches is fresh. Never starts the
 *  loop. */
function runHealthcheckAndExit(): never {
  let path = process.env.PROCELA_CONNECTOR_LIVENESS_FILE || LIVENESS_FILE_DEFAULT;
  let maxStaleMs = 180_000;
  try {
    const { cfg } = loadConfig();
    path = process.env.PROCELA_CONNECTOR_LIVENESS_FILE || cfg.livenessFile || path;
    if (cfg.livenessMaxStaleSeconds) maxStaleMs = cfg.livenessMaxStaleSeconds * 1000;
  } catch {
    // Config unreadable — fall back to defaults and still check the file.
  }
  const healthy = checkLiveness(path, Date.now(), maxStaleMs);
  log(`healthcheck ${healthy ? 'ok' : 'stale'}`, { path });
  process.exit(healthy ? 0 : 1);
}

if (process.argv.includes('--healthcheck') || process.env.PROCELA_CONNECTOR_HEALTHCHECK) {
  runHealthcheckAndExit();
} else {
  main().catch((err) => {
    log('fatal', { err: err?.message || String(err) });
    process.exit(1);
  });
}
