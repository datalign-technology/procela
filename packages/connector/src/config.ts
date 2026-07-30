// Config normalisation for the connector. Pure (no file IO) so it
// is unit-testable — index.ts reads + parses the YAML file, then
// hands the parsed object here for defaulting and env overrides.

import type { ConnectorConfig } from './types';

/** Agent version stamped onto every request (heartbeat / report /
 *  pair) so Procela can show which build a connector is running and
 *  flag stale agents. */
export const AGENT_VERSION = '0.3.0';

/** Default path for the liveness file the loop touches each heartbeat. */
export const LIVENESS_FILE_DEFAULT = '/tmp/procela-connector.alive';

/** Apply defaults + environment overrides to a parsed connector
 *  config. Kept pure so tests can pass a plain object + a fake env.
 *
 *  - `PROCELA_PAIRING_CODE` (trimmed) overrides `pairingCode`, so an
 *    operator can pair on first boot without editing the file.
 *  - heartbeat defaults to 60s, scan to 30m.
 *  - `sources` is coerced to an array so a missing / malformed key
 *    can't crash the scan loop. */
export function normalizeConfig(
  parsed: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorConfig {
  const cfg = (parsed && typeof parsed === 'object'
    ? { ...(parsed as Record<string, unknown>) }
    : {}) as unknown as ConnectorConfig;

  const pairingEnv = env.PROCELA_PAIRING_CODE;
  if (pairingEnv && pairingEnv.trim()) cfg.pairingCode = pairingEnv.trim();

  cfg.agentVersion = `procela-connector/${AGENT_VERSION}`;
  cfg.heartbeatSeconds = cfg.heartbeatSeconds || 60;
  cfg.scanSeconds = cfg.scanSeconds || 30 * 60;
  cfg.sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  cfg.livenessFile = cfg.livenessFile || LIVENESS_FILE_DEFAULT;
  // Tolerate a couple of missed heartbeats before reporting unhealthy.
  cfg.livenessMaxStaleSeconds = cfg.livenessMaxStaleSeconds || Math.max(cfg.heartbeatSeconds * 3, 180);
  return cfg;
}
