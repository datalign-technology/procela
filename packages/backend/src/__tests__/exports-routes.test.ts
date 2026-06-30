// HTTP coverage for routes/exports + routes/audit's new export.csv
// endpoint + lib/csv emitCsv. These three landed together as the
// compliance-export surface and deserve to be locked in as a unit.
//
// Pattern: mount the routers on an ephemeral express server, seed the
// shared in-memory stores with unique prefixes, scrub on after().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

import { emitCsv, parseCsv } from '../lib/csv';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const exportsRouter = require('../routes/exports').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildExecutiveReportMarkdown } = require('../routes/exports');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auditRouter = require('../routes/audit').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { auditService } = require('../services/audit.service');

function request(port: number, method: string, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: chunks }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('lib/csv emitCsv', () => {
  it('emits a header row + each row with double-quoted cells', () => {
    const out = emitCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    assert.strictEqual(out, '"a","b"\r\n"1","2"\r\n"3","4"\r\n');
  });
  it('escapes embedded double quotes as ""', () => {
    const out = emitCsv(['name'], [['She said "hi"']]);
    assert.strictEqual(out, '"name"\r\n"She said ""hi"""\r\n');
  });
  it('preserves embedded commas and newlines because every cell is quoted', () => {
    const out = emitCsv(['x'], [['a,b'], ['c\nd']]);
    assert.strictEqual(out, '"x"\r\n"a,b"\r\n"c\nd"\r\n');
  });
  it('renders null and undefined as empty strings', () => {
    const out = emitCsv(['v'], [[null], [undefined], [0], [false]]);
    // 0 and false are valid values — not blank.
    assert.strictEqual(out, '"v"\r\n""\r\n""\r\n"0"\r\n"false"\r\n');
  });
  it('round-trips through parseCsv', () => {
    const rows = [['a', 'b "quoted"'], ['c,d', 'e\nf']];
    const back = parseCsv(emitCsv(['col1', 'col2'], rows));
    assert.deepStrictEqual(back, [['col1', 'col2'], ...rows]);
  });
});

describe('Exports + audit CSV routes', () => {
  let server: http.Server;
  let port: number;
  const orgId = 'test-org-exports';
  const PREFIX = 'test-export-';
  const sysId = PREFIX + 'sys';
  const assetMapped = PREFIX + 'asset-mapped';
  const assetOrphan = PREFIX + 'asset-orphan';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const actId = PREFIX + 'act';
  const mapId = PREFIX + 'mapping';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/exports', exportsRouter);
    app.use('/audit', auditRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Sweep leftovers before seeding so the persisted JSON store
    // doesn't accumulate test rows across runs.
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
      }
    };
    sweep(mappings); sweep(processNodes); sweep(dataAssets); sweep(systems);

    const now = new Date().toISOString();
    systems.push({ id: sysId, orgId, name: 'Export Test ERP', description: 'erp', systemType: 'ERP', createdAt: now, updatedAt: now });
    dataAssets.push(
      { id: assetMapped, orgId, name: 'Mapped asset', description: 'm', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'GOLD', healthScore: 0, createdAt: now, updatedAt: now },
      { id: assetOrphan, orgId, name: 'Orphan asset', description: 'o', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 0, createdAt: now, updatedAt: now },
    );
    processNodes.push(
      { id: vsId,  parentId: null,  level: 'VALUE_STREAM', name: 'Export VS', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, createdAt: now, updatedAt: now },
      { id: procId, parentId: vsId, level: 'PROCESS',     name: 'Export proc', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', createdAt: now, updatedAt: now },
      { id: actId, parentId: procId, level: 'ACTIVITY',   name: 'Export act',  description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', systemIds: [sysId], createdAt: now, updatedAt: now },
    );
    mappings.push({
      id: mapId, orgId, processStepId: actId, dataAssetId: assetMapped,
      linkType: 'consumes', notes: '', aiSuggested: false, userOverridden: false,
      createdBy: 'test', createdAt: now, updatedAt: now,
    });
    auditService.log(orgId, null, 'DataAsset', assetMapped, 'CREATE', null, { name: 'Mapped asset' });
  });

  after(async () => {
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
      }
    };
    sweep(mappings); sweep(processNodes); sweep(dataAssets); sweep(systems);
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('buildExecutiveReportMarkdown', () => {
    it('produces a header + the catalog counts for the scope', () => {
      const md = buildExecutiveReportMarkdown({ orgId, orgName: 'Export Co', scope: new Set([orgId]) });
      assert.match(md, /^# Executive Report/);
      assert.match(md, /\*\*Organization:\*\* Export Co/);
      assert.match(md, /Value streams: \*\*1\*\*/);
      assert.match(md, /Activities: \*\*1\*\*/);
      assert.match(md, /Data assets: \*\*2\*\*/);
    });
    it('surfaces the orphan asset by name in the orphan list', () => {
      const md = buildExecutiveReportMarkdown({ orgId, orgName: 'Export Co', scope: new Set([orgId]) });
      assert.match(md, /Orphan asset/);
      assert.match(md, /Orphan data assets \(no process references them\): \*\*1\*\*/);
    });
    it('summarises the governance tier mix', () => {
      const md = buildExecutiveReportMarkdown({ orgId, orgName: 'Export Co', scope: new Set([orgId]) });
      assert.match(md, /Gold: \*\*1\*\*/);
      assert.match(md, /Bronze: \*\*1\*\*/);
    });
  });

  describe('GET /exports/executive.md', () => {
    it('returns the markdown body with the expected content-type and disposition', async () => {
      const res = await request(port, 'GET', `/exports/executive.md?orgId=${orgId}`);
      assert.strictEqual(res.status, 200);
      assert.match(String(res.headers['content-type']), /text\/markdown/);
      assert.match(res.body, /# Executive Report/);
      assert.match(res.body, /Data assets: \*\*2\*\*/);
    });
  });

  describe('GET /exports/executive.pdf', () => {
    it('returns a real PDF binary (starts with the %PDF magic)', async () => {
      const res = await request(port, 'GET', `/exports/executive.pdf?orgId=${orgId}`);
      assert.strictEqual(res.status, 200);
      assert.match(String(res.headers['content-type']), /application\/pdf/);
      // PDF files always start with "%PDF-1.x" — a cheap shape check
      // that catches the most common failure mode (route returns JSON
      // error instead of a binary).
      assert.ok(res.body.startsWith('%PDF'), 'body should start with %PDF magic');
      // attachment so the browser downloads instead of inlining.
      assert.match(String(res.headers['content-disposition'] || ''), /^attachment;/);
    });
  });

  describe('GET /audit/export.csv', () => {
    it('returns a CSV with the expected header row + at least one body row', async () => {
      const res = await request(port, 'GET', `/audit/export.csv?orgId=${orgId}`);
      assert.strictEqual(res.status, 200);
      assert.match(String(res.headers['content-type']), /text\/csv/);
      assert.match(String(res.headers['content-disposition'] || ''), /^attachment;.*\.csv"/);
      const rows = parseCsv(res.body);
      assert.deepStrictEqual(rows[0], [
        'timestamp', 'orgId', 'userId', 'userName', 'entityType', 'entityId', 'entityName', 'action', 'entryHash',
      ]);
      // Find our seeded audit entry.
      const ours = rows.slice(1).find((r) => r[5] === assetMapped);
      assert.ok(ours, 'seeded audit entry should appear in the export');
      assert.strictEqual(ours![4], 'DataAsset');
      assert.strictEqual(ours![7], 'CREATE');
    });
    it('honours the entityType + entityId filter', async () => {
      const res = await request(port, 'GET', `/audit/export.csv?orgId=${orgId}&entityType=DataAsset&entityId=${assetMapped}`);
      assert.strictEqual(res.status, 200);
      const rows = parseCsv(res.body);
      // Every body row must match the filter — that's what the filter
      // promises. We don't assert a strict count because the audit log
      // persists across the session (auto-save flushes to disk) so a
      // prior run of this same test can leave matching entries behind.
      const body = rows.slice(1);
      assert.ok(body.length >= 1, 'at least one matching entry should be exported');
      for (const r of body) {
        assert.strictEqual(r[4], 'DataAsset', `row should have entityType=DataAsset, got ${r[4]}`);
        assert.strictEqual(r[5], assetMapped, `row should have entityId=${assetMapped}, got ${r[5]}`);
      }
    });
  });
});
