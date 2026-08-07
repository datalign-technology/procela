import { describe, it } from 'node:test';
import assert from 'node:assert';

import { normalizeConfig, AGENT_VERSION } from '../config';

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe('config — normalizeConfig', () => {
  it('applies cadence defaults and coerces sources to an array', () => {
    const cfg = normalizeConfig({ procelaUrl: 'https://api.procela.io', token: 't' }, EMPTY_ENV);
    assert.strictEqual(cfg.heartbeatSeconds, 60);
    assert.strictEqual(cfg.scanSeconds, 30 * 60);
    assert.deepStrictEqual(cfg.sources, []);
    assert.strictEqual(cfg.agentVersion, `procela-connector/${AGENT_VERSION}`);
    // Liveness defaults: default path + max(3×heartbeat, 180s).
    assert.strictEqual(cfg.livenessFile, '/tmp/procela-connector.alive');
    assert.strictEqual(cfg.livenessMaxStaleSeconds, 180);
  });

  it('derives livenessMaxStaleSeconds from a longer heartbeat', () => {
    const cfg = normalizeConfig({ procelaUrl: 'x', token: 't', heartbeatSeconds: 120 }, EMPTY_ENV);
    assert.strictEqual(cfg.livenessMaxStaleSeconds, 360, '3 × 120s');
  });

  it('preserves operator-provided cadences and sources', () => {
    const cfg = normalizeConfig(
      { procelaUrl: 'x', token: 't', heartbeatSeconds: 30, scanSeconds: 120, sources: [{ type: 'postgres', name: 'db', connectionString: 'postgres://…' }] },
      EMPTY_ENV,
    );
    assert.strictEqual(cfg.heartbeatSeconds, 30);
    assert.strictEqual(cfg.scanSeconds, 120);
    assert.strictEqual(cfg.sources.length, 1);
  });

  it('lets PROCELA_PAIRING_CODE (trimmed) override the config pairing code', () => {
    const cfg = normalizeConfig(
      { procelaUrl: 'x', pairingCode: 'from-file' },
      { PROCELA_PAIRING_CODE: '  12345678  ' } as NodeJS.ProcessEnv,
    );
    assert.strictEqual(cfg.pairingCode, '12345678');
  });

  it('keeps the file pairing code when the env var is empty / whitespace', () => {
    const cfg = normalizeConfig(
      { procelaUrl: 'x', pairingCode: 'from-file' },
      { PROCELA_PAIRING_CODE: '   ' } as NodeJS.ProcessEnv,
    );
    assert.strictEqual(cfg.pairingCode, 'from-file');
  });

  it('lets PROCELA_CONNECTOR_TOKEN (trimmed) override the config token', () => {
    const cfg = normalizeConfig(
      { procelaUrl: 'x' },
      { PROCELA_CONNECTOR_TOKEN: '  pct_env  ' } as NodeJS.ProcessEnv,
    );
    assert.strictEqual(cfg.token, 'pct_env');
  });

  it('keeps the file token when PROCELA_CONNECTOR_TOKEN is empty / whitespace', () => {
    const cfg = normalizeConfig(
      { procelaUrl: 'x', token: 'from-file' },
      { PROCELA_CONNECTOR_TOKEN: '   ' } as NodeJS.ProcessEnv,
    );
    assert.strictEqual(cfg.token, 'from-file');
  });

  it('does not throw on a null / non-object parse result', () => {
    const cfg = normalizeConfig(null, EMPTY_ENV);
    assert.deepStrictEqual(cfg.sources, []);
    assert.strictEqual(cfg.heartbeatSeconds, 60);
  });
});
