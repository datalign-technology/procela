import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { erasePersonReferences } from '../services/gdpr.service';
import { auditService, auditLogs } from '../services/audit.service';
import { replaceArray } from './_helpers/store-isolation';

// gdpr.service walks the entire .procela-data directory on disk.
// Tests that exercise it need full directory isolation — moving the
// real dir aside, working in an empty replacement, restoring on
// teardown. Any failure mid-suite would leave the dev's data in
// `.procela-data.bak-<id>` for manual recovery.

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const BACKUP_DIR = `${DATA_DIR}.bak-gdpr-test-${process.pid}`;

function writeFixture(name: string, data: unknown[]): void {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function readFixture<T = unknown>(name: string): T[] {
  const p = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

describe('gdpr.service — erasePersonReferences', () => {
  before(() => {
    // Move real dev data aside, create empty replacement.
    if (fs.existsSync(DATA_DIR)) fs.renameSync(DATA_DIR, BACKUP_DIR);
    fs.mkdirSync(DATA_DIR, { recursive: true });
  });

  after(() => {
    // Tear down our test dir, restore real one.
    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
    if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, DATA_DIR);
  });

  beforeEach(() => {
    // Wipe the test dir back to empty between cases. The audit log
    // in-memory state is also cleaned so the cascade's redactPerson
    // pass starts fresh. Tolerate ENOENT on unlink: with parallel
    // test workers a peer's saveStore may finish and delete its own
    // `.tmp` file between our readdirSync + unlinkSync — a race the
    // atomic-write fix in #100 introduced by design.
    for (const f of fs.readdirSync(DATA_DIR)) {
      try { fs.unlinkSync(path.join(DATA_DIR, f)); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    replaceArray(auditLogs, []);
  });

  it('scrubs single-ref fields (ownerId, stewardId) for the target person', async () => {
    const TARGET = 'person-to-forget';
    writeFixture('dataAssets', [
      { id: 'a1', name: 'Customer Master', ownerId: TARGET, stewardId: 'someone-else' },
      { id: 'a2', name: 'Billing Records', ownerId: 'untouched', stewardId: TARGET },
      { id: 'a3', name: 'Unrelated',       ownerId: 'untouched', stewardId: 'untouched' },
    ]);

    const report = await erasePersonReferences(TARGET);
    assert.ok(report.storesScanned >= 1);
    assert.ok(report.rowsModified >= 2);

    const after = readFixture<{ id: string; ownerId: string | null; stewardId: string | null }>('dataAssets');
    assert.strictEqual(after[0].ownerId, null, 'a1.ownerId scrubbed');
    assert.strictEqual(after[0].stewardId, 'someone-else', 'a1.stewardId untouched');
    assert.strictEqual(after[1].ownerId, 'untouched');
    assert.strictEqual(after[1].stewardId, null, 'a2.stewardId scrubbed');
    assert.strictEqual(after[2].ownerId, 'untouched');
    assert.strictEqual(after[2].stewardId, 'untouched');
  });

  it('removes the target from multi-ref array fields (stewardIds, memberIds)', async () => {
    const TARGET = 'person-to-forget';
    writeFixture('dataDomains', [
      { id: 'd1', name: 'Customer', stewardIds: [TARGET, 'keep-1', 'keep-2'] },
      { id: 'd2', name: 'Billing',  stewardIds: ['keep-3'] },
    ]);
    writeFixture('governanceGroups', [
      { id: 'g1', name: 'Council', memberIds: ['keep-a', TARGET, 'keep-b'] },
    ]);

    await erasePersonReferences(TARGET);

    const domains = readFixture<{ id: string; stewardIds: string[] }>('dataDomains');
    assert.deepStrictEqual(domains[0].stewardIds, ['keep-1', 'keep-2']);
    assert.deepStrictEqual(domains[1].stewardIds, ['keep-3']);

    const groups = readFixture<{ id: string; memberIds: string[] }>('governanceGroups');
    assert.deepStrictEqual(groups[0].memberIds, ['keep-a', 'keep-b']);
  });

  it('removes rows whose authorId IS the target (authored comments)', async () => {
    const TARGET = 'person-to-forget';
    writeFixture('comments', [
      { id: 'c1', authorId: TARGET,     body: 'mine' },
      { id: 'c2', authorId: 'someone',  body: 'theirs' },
      { id: 'c3', authorId: TARGET,     body: 'mine again' },
    ]);

    const report = await erasePersonReferences(TARGET);
    assert.ok(report.rowsRemoved >= 2);

    const after = readFixture<{ id: string }>('comments');
    assert.deepStrictEqual(after.map((r) => r.id), ['c2']);
  });

  it('leaves stores that have no reference to the target untouched', async () => {
    const TARGET = 'person-to-forget';
    const untouched = [
      { id: 's1', name: 'Salesforce', ownerId: 'someone-else' },
      { id: 's2', name: 'SAP',        ownerId: 'someone-else' },
    ];
    writeFixture('systems', untouched);

    await erasePersonReferences(TARGET);

    const after = readFixture('systems');
    assert.deepStrictEqual(after, untouched);
  });

  it('skips the auditLogs file (handled separately via tombstone + rechain)', async () => {
    const TARGET = 'person-to-forget';
    // Seed real-ish entries via auditService so they get hashes.
    auditService.log('org-1', TARGET,         'Person', 'p1', 'CREATE');
    auditService.log('org-1', 'someone-else', 'Person', 'p1', 'UPDATE');
    // Save to disk so the cascade's directory walk would see it.
    fs.writeFileSync(
      path.join(DATA_DIR, 'auditLogs.json'),
      JSON.stringify(auditLogs, null, 2),
    );

    const report = await erasePersonReferences(TARGET);
    // auditLogs in-memory should have the userId replaced by [deleted].
    assert.strictEqual(auditLogs[0].userId, '[deleted]');
    // Chain integrity preserved.
    assert.strictEqual((await auditService.verifyChain()).valid, true);
    // The auditLogs file should NOT be reported in storesScanned (handled separately).
    // We don't assert on the exact count, but reading the file back, the
    // userId for the target should now be [deleted] (because redactPerson()
    // wrote it via saveStore).
    const auditOnDisk = readFixture<{ userId: string }>('auditLogs');
    assert.strictEqual(auditOnDisk[0].userId, '[deleted]');
    // Most importantly: the cascade report's auditEntriesRedacted reflects
    // the rehash count.
    assert.ok(report.auditEntriesRedacted >= 1);
  });

  it('does not touch the people store (caller handles row removal)', async () => {
    const TARGET = 'person-to-forget';
    writeFixture('people', [
      { id: TARGET, name: 'Target', email: 't@x.io' },
      { id: 'other', name: 'Other', email: 'o@x.io' },
    ]);

    await erasePersonReferences(TARGET);

    // people.json should be untouched by the cascade — the route
    // handler in routes/people.ts is responsible for splicing the
    // person out and saving.
    const people = readFixture<{ id: string }>('people');
    assert.strictEqual(people.length, 2);
    assert.ok(people.find((p) => p.id === TARGET), 'cascade should not delete from people store');
  });

  it('returns a useful summary report', async () => {
    const TARGET = 'person-to-forget';
    writeFixture('dataAssets', [{ id: 'a1', ownerId: TARGET }]);
    writeFixture('comments', [{ id: 'c1', authorId: TARGET }]);
    writeFixture('systems', [{ id: 's1', ownerId: 'other' }]); // unmodified

    const report = await erasePersonReferences(TARGET);
    assert.ok(report.storesScanned >= 3);
    assert.ok(report.storesModified >= 2, `expected >=2 modified, got ${report.storesModified}`);
    assert.ok(report.rowsRemoved >= 1, 'authored comment dropped');
    assert.ok(report.rowsModified >= 1, 'ownership scrubbed');
  });

  it('handles a corrupted store file gracefully (skips, does not throw)', async () => {
    const TARGET = 'person-to-forget';
    fs.writeFileSync(path.join(DATA_DIR, 'broken.json'), '{{not-json');
    writeFixture('dataAssets', [{ id: 'a1', ownerId: TARGET }]);

    const report = await erasePersonReferences(TARGET);
    // Cascade survived the bad file and still scrubbed the good one.
    const after = readFixture<{ id: string; ownerId: string | null }>('dataAssets');
    assert.strictEqual(after[0].ownerId, null);
    assert.ok(report.storesScanned >= 1);
  });
});
