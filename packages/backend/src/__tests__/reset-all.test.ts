import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import config from '../config';
import backupRouter from '../routes/backup';
import { registerStore } from '../lib/persistence';
import { auditLogs } from '../services/audit.service';
import { replaceArray } from './_helpers/store-isolation';

// End-to-end test for POST /backup/reset-all. The data directory is
// moved aside before the suite so the reset operates on a controlled
// fixture set; any failure mid-suite would leave the real dev data in
// `.procela-data.bak-reset-test-<pid>` for manual recovery.

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const BACKUP_DIR = `${DATA_DIR}.bak-reset-test-${process.pid}`;

function mintToken(role: string): string {
  return jwt.sign(
    { sub: 'tester-1', email: 't@x.io', orgId: 'o1', role, type: 'access' },
    config.jwtSecret,
    { expiresIn: '1h' },
  );
}

async function startApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/backup', backupRouter);
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

let app: { url: string; close: () => Promise<void> };

// A pair of test in-memory stores so we can verify the reload-registry
// arm of wipeAllStores does its job.
const testPeople: Array<Record<string, unknown>> = [];
const testProcesses: Array<Record<string, unknown>> = [];

before(async () => {
  if (fs.existsSync(DATA_DIR)) fs.renameSync(DATA_DIR, BACKUP_DIR);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  registerStore('reset-test-people', testPeople);
  registerStore('reset-test-processes', testProcesses);
  app = await startApp();
});

after(async () => {
  await app.close();
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, DATA_DIR);
});

beforeEach(() => {
  // Re-seed fixtures so each test starts from a known state.
  for (const f of fs.readdirSync(DATA_DIR)) fs.unlinkSync(path.join(DATA_DIR, f));
  fs.writeFileSync(path.join(DATA_DIR, 'reset-test-people.json'), JSON.stringify([{ id: 'p1' }, { id: 'p2' }]));
  fs.writeFileSync(path.join(DATA_DIR, 'reset-test-processes.json'), JSON.stringify([{ id: 'pr1' }]));
  fs.writeFileSync(path.join(DATA_DIR, 'someUnknownStore.json'), JSON.stringify([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }]));
  replaceArray(testPeople, [{ id: 'p1' }, { id: 'p2' }]);
  replaceArray(testProcesses, [{ id: 'pr1' }]);
  replaceArray(auditLogs, []);
});

describe('POST /backup/reset-all — gates', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects non-super-admin tokens with 403', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('ORG_ADMIN')}`,
      },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('rejects a missing confirmation phrase with 400 (data preserved)', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('SUPER_ADMIN')}`,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    // Fixtures untouched.
    const peopleFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reset-test-people.json'), 'utf-8'));
    assert.strictEqual(peopleFile.length, 2);
  });

  it('rejects a wrong confirmation phrase with 400 (data preserved)', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('SUPER_ADMIN')}`,
      },
      body: JSON.stringify({ confirm: 'reset' }), // lowercase — must match exactly
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(testPeople.length, 2, 'in-memory store untouched');
  });
});

describe('POST /backup/reset-all — happy path', () => {
  it('truncates every JSON file under .procela-data to []', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('SUPER_ADMIN')}`,
      },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 200);

    // Every JSON file is now an empty array — registered or not.
    for (const file of ['reset-test-people.json', 'reset-test-processes.json', 'someUnknownStore.json']) {
      const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
      assert.deepStrictEqual(content, [], `${file} should be empty`);
    }
  });

  it('clears every registered in-memory store', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('SUPER_ADMIN')}`,
      },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(testPeople.length, 0);
    assert.strictEqual(testProcesses.length, 0);
  });

  it('records an ALL_DATA_RESET audit entry with actor + summary', async () => {
    const token = mintToken('SUPER_ADMIN');
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 200);
    // The reset clears the in-memory auditLogs first, then records
    // the single post-reset event.
    assert.strictEqual(auditLogs.length, 1, 'exactly one post-reset audit entry');
    const entry = auditLogs[0];
    assert.strictEqual(entry.action, 'ALL_DATA_RESET');
    assert.strictEqual(entry.userId, 'tester-1');
    const after = entry.after as Record<string, unknown>;
    assert.strictEqual(after.actorEmail, 't@x.io');
    assert.ok((after.filesCleared as number) >= 3, `filesCleared >= 3 (got ${after.filesCleared})`);
  });

  it('returns a useful summary in the response body', async () => {
    const res = await fetch(`${app.url}/api/v1/backup/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintToken('SUPER_ADMIN')}`,
      },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { data: { filesCleared: number; storesReloaded: number; message: string } };
    assert.ok(body.data.filesCleared >= 3);
    assert.ok(body.data.storesReloaded >= 2);
    assert.match(body.data.message, /onboarding/i);
  });
});
