// Audit hash-chain bootstrap semantics.
//
// The bootstrap in audit.service.ts fires when un-hashed entries
// exist at boot. Two behaviors matter:
//   1. In non-production, the bootstrap runs, re-hashes the loose
//      entries, and appends an AUDIT_CHAIN_BOOTSTRAPPED marker so
//      the trust boundary is explicit in the log itself.
//   2. In production without AUDIT_ALLOW_BOOTSTRAP=1, the module
//      throws at import-time. That aborts server startup, which is
//      the desired behaviour — silently re-hashing a tampered row
//      would make it look legitimate.
//
// Both cases exercise the module-load side effect, so each test
// snapshots the auditLogs.json on disk, plants a "legacy" fixture,
// clears the module cache, and re-requires audit.service to force
// the bootstrap to run.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const AUDIT_FILE = path.join(DATA_DIR, 'auditLogs.json');
const BACKUP = path.join(DATA_DIR, 'auditLogs.backup.json');

function fireBootstrap(): typeof import('../services/audit.service') {
  // Clear both the config module (audit.service imports logger via
  // ../lib/logger which reads config for log level) and the audit
  // module itself so the top-level bootstrap side effect runs again.
  delete require.cache[require.resolve('../services/audit.service')];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../services/audit.service') as typeof import('../services/audit.service');
}

function plantLegacyEntries(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacy = [
    { id: 'legacy-1', orgId: 'o1', userId: null, entityType: 'Person', entityId: 'p1', action: 'CREATE', before: null, after: null, timestamp: '2026-01-01T00:00:00.000Z' },
    { id: 'legacy-2', orgId: 'o1', userId: null, entityType: 'Person', entityId: 'p1', action: 'UPDATE', before: null, after: null, timestamp: '2026-01-02T00:00:00.000Z' },
  ];
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(legacy, null, 2));
}

describe('audit.service — chain bootstrap', () => {
  before(() => {
    if (fs.existsSync(AUDIT_FILE)) fs.renameSync(AUDIT_FILE, BACKUP);
  });
  after(() => {
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
    if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, AUDIT_FILE);
    // Reset cache so subsequent test files re-init audit.service
    // against the restored disk state (which is empty in most CI runs).
    delete require.cache[require.resolve('../services/audit.service')];
  });
  beforeEach(() => {
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
  });

  it('bootstraps missing hashes and appends an AUDIT_CHAIN_BOOTSTRAPPED marker (non-production)', () => {
    const savedEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV; // ensure not 'production'
    plantLegacyEntries();

    const mod = fireBootstrap();

    // Two legacy entries + one marker = 3 rows.
    assert.strictEqual(mod.auditLogs.length, 3);
    const [e1, e2, marker] = mod.auditLogs;
    assert.ok(e1.entryHash && e1.entryHash.length === 64, 'legacy #1 should have a hash');
    assert.ok(e2.entryHash && e2.entryHash.length === 64, 'legacy #2 should have a hash');
    assert.strictEqual(e2.prevHash, e1.entryHash, 'chain wires legacy #2 to #1');
    assert.strictEqual(marker.action, 'AUDIT_CHAIN_BOOTSTRAPPED');
    assert.strictEqual(marker.entityType, 'Audit');
    assert.strictEqual(marker.prevHash, e2.entryHash, 'marker chains onto the last bootstrapped entry');
    assert.ok(marker.after && typeof marker.after === 'object' && 'firstBootstrappedIndex' in marker.after);

    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
  });

  it('refuses to bootstrap in production without AUDIT_ALLOW_BOOTSTRAP=1', () => {
    const savedNode = process.env.NODE_ENV;
    const savedAllow = process.env.AUDIT_ALLOW_BOOTSTRAP;
    process.env.NODE_ENV = 'production';
    delete process.env.AUDIT_ALLOW_BOOTSTRAP;
    plantLegacyEntries();

    assert.throws(fireBootstrap, /Refusing to auto-bootstrap in production/);

    if (savedNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNode;
    if (savedAllow === undefined) delete process.env.AUDIT_ALLOW_BOOTSTRAP;
    else process.env.AUDIT_ALLOW_BOOTSTRAP = savedAllow;
  });

  it('allows the bootstrap in production when AUDIT_ALLOW_BOOTSTRAP=1 is set', () => {
    const savedNode = process.env.NODE_ENV;
    const savedAllow = process.env.AUDIT_ALLOW_BOOTSTRAP;
    process.env.NODE_ENV = 'production';
    process.env.AUDIT_ALLOW_BOOTSTRAP = '1';
    plantLegacyEntries();

    const mod = fireBootstrap();
    assert.strictEqual(mod.auditLogs.length, 3);
    assert.strictEqual(mod.auditLogs[2].action, 'AUDIT_CHAIN_BOOTSTRAPPED');

    if (savedNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNode;
    if (savedAllow === undefined) delete process.env.AUDIT_ALLOW_BOOTSTRAP;
    else process.env.AUDIT_ALLOW_BOOTSTRAP = savedAllow;
  });
});
