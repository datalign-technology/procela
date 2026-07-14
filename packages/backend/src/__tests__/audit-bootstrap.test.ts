// Audit hash-chain bootstrap semantics.
//
// The bootstrap fires when un-hashed entries exist. Two behaviors
// matter:
//   1. In non-production, the bootstrap runs, re-hashes the loose
//      entries, and appends an AUDIT_CHAIN_BOOTSTRAPPED marker so the
//      trust boundary is explicit in the log itself.
//   2. In production without allowBootstrap, the bootstrap throws.
//      At module-init this aborts server startup, which is the
//      desired behaviour — silently re-hashing a tampered row would
//      make it look legitimate.
//
// The bootstrap logic lives in an exported pure function
// (bootstrapHashChain) so tests can drive it against in-memory
// arrays. That avoids racing the shared .procela-data/auditLogs.json
// file that parallel test workers also touch — the earlier
// disk-based test flavour of this file hit ENOENT / stale-read
// failures under the parallel runner.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { bootstrapHashChain, AuditLogEntry } from '../services/audit.service';

function legacyEntries(): AuditLogEntry[] {
  return [
    { id: 'legacy-1', orgId: 'o1', userId: null, entityType: 'Person', entityId: 'p1', action: 'CREATE', before: null, after: null, timestamp: '2026-01-01T00:00:00.000Z' },
    { id: 'legacy-2', orgId: 'o1', userId: null, entityType: 'Person', entityId: 'p1', action: 'UPDATE', before: null, after: null, timestamp: '2026-01-02T00:00:00.000Z' },
  ];
}

describe('audit.service — chain bootstrap', () => {
  it('bootstraps missing hashes and appends an AUDIT_CHAIN_BOOTSTRAPPED marker (non-production)', () => {
    const entries = legacyEntries();
    const result = bootstrapHashChain(entries, { isProduction: false, now: '2026-07-14T00:00:00.000Z' });

    assert.strictEqual(result.mutated, true);
    assert.strictEqual(result.firstBootstrappedIndex, 0);
    assert.ok(result.marker, 'marker should be returned');

    // Two legacy entries + one marker = 3 rows.
    assert.strictEqual(entries.length, 3);
    const [e1, e2, marker] = entries;
    assert.ok(e1.entryHash && e1.entryHash.length === 64, 'legacy #1 should have a hash');
    assert.ok(e2.entryHash && e2.entryHash.length === 64, 'legacy #2 should have a hash');
    assert.strictEqual(e1.prevHash, '', 'first entry chains from empty root');
    assert.strictEqual(e2.prevHash, e1.entryHash, 'chain wires legacy #2 to #1');
    assert.strictEqual(marker.action, 'AUDIT_CHAIN_BOOTSTRAPPED');
    assert.strictEqual(marker.entityType, 'Audit');
    assert.strictEqual(marker.prevHash, e2.entryHash, 'marker chains onto the last bootstrapped entry');
    assert.ok(marker.after && typeof marker.after === 'object' && 'firstBootstrappedIndex' in marker.after);
  });

  it('refuses to bootstrap in production without allowBootstrap', () => {
    const entries = legacyEntries();
    assert.throws(
      () => bootstrapHashChain(entries, { isProduction: true, allowBootstrap: false }),
      /Refusing to auto-bootstrap in production/
    );
  });

  it('allows the bootstrap in production when allowBootstrap is set', () => {
    const entries = legacyEntries();
    const result = bootstrapHashChain(entries, { isProduction: true, allowBootstrap: true, now: '2026-07-14T00:00:00.000Z' });
    assert.strictEqual(result.mutated, true);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[2].action, 'AUDIT_CHAIN_BOOTSTRAPPED');
  });

  it('is a no-op when the chain is already intact', () => {
    // First bootstrap to establish a valid chain.
    const entries = legacyEntries();
    bootstrapHashChain(entries, { isProduction: false, now: '2026-07-14T00:00:00.000Z' });
    const lenAfterFirst = entries.length;

    // Second bootstrap should not mutate or append another marker.
    const result = bootstrapHashChain(entries, { isProduction: false });
    assert.strictEqual(result.mutated, false);
    assert.strictEqual(result.marker, null);
    assert.strictEqual(entries.length, lenAfterFirst);
  });
});
