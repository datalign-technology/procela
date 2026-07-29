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
// pg as the one source-adapter dep, yaml for config parsing. No
// secret management — the admin's job to keep the config file out
// of source control.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ConnectorConfig, ReportedAsset } from './types';
import { normalizeConfig } from './config';
import { pairClaim, heartbeat, report } from './api';
import { scanPostgres } from './postgres';
import { scanSqlServer } from './sqlserver';
import { scanMysql } from './mysql';

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
  for (const source of cfg.sources) {
    log('scanning source', { name: source.name, type: source.type });
    try {
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
      log('scan failed for source', { source: source.name, error: err?.message || String(err) });
    }
  }
  if (all.length === 0) {
    log('no assets discovered — nothing to report');
    return;
  }
  const res = await report(cfg, all);
  if (!res.success) {
    log('report rejected', { error: res.error || 'unknown' });
    return;
  }
  log('report accepted', { ...res.data });
  void total;
}

async function main(): Promise<void> {
  const { path, cfg } = loadConfig();
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

main().catch((err) => {
  log('fatal', { err: err?.message || String(err) });
  process.exit(1);
});
