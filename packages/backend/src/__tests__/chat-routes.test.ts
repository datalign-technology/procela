// Tests for routes/chat — the AI assistant's request handler — and
// its buildOrgSnapshot helper. The snapshot is the single piece of
// context that lets Claude answer questions about Procela's catalog
// instead of guessing; if it ever lies about what's there, the AI's
// answers go with it. This suite locks in:
//
//   buildOrgSnapshot
//     - returns undefined for an empty org (so the chat handler can
//       skip emitting an empty context block)
//     - includes the catalog tree, systems, assets, mappings and gaps
//       sections when data is present
//     - surfaces the Phase 3 signals (activity↔system declarations,
//       orphan assets, dismissed-suggestion count) so the assistant
//       can answer questions like "what data do we have that nobody
//       uses?"
//
//   POST /chat
//     - 400 on missing / malformed messages array
//     - 400 on a message with an unknown role
//     - happy path: aiService.chat is called with the snapshot and
//       the user's messages, and the reply is returned
//
// The aiService.chat call is stubbed for the test run so no real
// Claude request is made; the original implementation is restored
// in after().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatRouter = require('../routes/chat').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildOrgSnapshot, buildEntityIndex } = require('../routes/chat');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes, suggestionDismissals } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiService } = require('../services/ai.service');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {},
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
          catch { resolve({ status: res.statusCode || 0, body: chunks }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('chat routes + buildOrgSnapshot', () => {
  let server: http.Server;
  let port: number;
  const orgId = 'test-org-chat';
  const PREFIX = 'test-chat-';
  const sysId = PREFIX + 'sys';
  const mappedAsset = PREFIX + 'asset-mapped';
  const orphanAsset = PREFIX + 'asset-orphan';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const actId = PREFIX + 'act';
  const mapId = PREFIX + 'map';
  const dismissalId = PREFIX + 'dismissal';

  const originalChat = aiService.chat.bind(aiService);
  const originalChatStream = aiService.chatStream.bind(aiService);
  let chatCalls: Array<{ messages: any[]; context: any; snapshot: string | undefined }> = [];
  let streamCalls: Array<{ messages: any[]; context: any; snapshot: string | undefined }> = [];
  // The stream stub yields each space-split chunk of this reply so
  // the test can verify the SSE frames carry the same text the
  // non-streaming endpoint would have returned.
  const STUB_STREAM_REPLY = 'You have one orphan asset: Unused billing ledger.';

  before(async () => {
    aiService.chat = async (messages: any[], context: any, snapshot?: string) => {
      chatCalls.push({ messages, context, snapshot });
      return 'stub-reply';
    };
    aiService.chatStream = async function* (messages: any[], context: any, snapshot?: string) {
      streamCalls.push({ messages, context, snapshot });
      for (const word of STUB_STREAM_REPLY.split(' ')) yield word + ' ';
    };
    const app = express();
    app.use(express.json());
    app.use('/chat', chatRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Seed a self-contained scenario the snapshot can summarise.
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
      }
    };
    sweep(mappings); sweep(processNodes); sweep(dataAssets); sweep(systems); sweep(suggestionDismissals);
    organizations.push({ id: orgId, name: 'Chat Test Co', industry: 'Healthcare', type: 'company', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const now = new Date().toISOString();
    systems.push({ id: sysId, orgId, name: 'Epic EHR', description: '', systemType: 'EHR', createdAt: now, updatedAt: now });
    dataAssets.push(
      { id: mappedAsset, orgId, name: 'Patient encounter records', description: '', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'GOLD', healthScore: 95, createdAt: now, updatedAt: now },
      { id: orphanAsset, orgId, name: 'Unused billing ledger', description: '', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 40, createdAt: now, updatedAt: now },
    );
    processNodes.push(
      { id: vsId,  parentId: null,  level: 'VALUE_STREAM', name: 'Patient care VS', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, createdAt: now, updatedAt: now },
      { id: procId, parentId: vsId, level: 'PROCESS',     name: 'Schedule appointment', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', createdAt: now, updatedAt: now },
      { id: actId, parentId: procId, level: 'ACTIVITY',   name: 'Look up patient record', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', systemIds: [sysId], createdAt: now, updatedAt: now },
    );
    mappings.push({
      id: mapId, orgId, processStepId: actId, dataAssetId: mappedAsset,
      linkType: 'consumes', notes: '', aiSuggested: false, userOverridden: false,
      createdBy: 'test', createdAt: now, updatedAt: now,
    });
    suggestionDismissals.push({
      id: dismissalId, orgId, nodeId: actId, kind: 'asset', targetId: 'some-other-asset',
      dismissedBy: null, dismissedAt: now,
    });
  });

  after(async () => {
    aiService.chat = originalChat;
    aiService.chatStream = originalChatStream;
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
      }
    };
    sweep(mappings); sweep(processNodes); sweep(dataAssets); sweep(systems); sweep(suggestionDismissals);
    const oi = organizations.findIndex((o: any) => o.id === orgId);
    if (oi >= 0) organizations.splice(oi, 1);
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('buildOrgSnapshot', () => {
    it('returns undefined when the org has no nodes/assets/systems at all', () => {
      assert.strictEqual(buildOrgSnapshot('this-org-does-not-exist'), undefined);
      assert.strictEqual(buildOrgSnapshot(''), undefined);
    });

    it('includes the catalog tree, systems and assets sections', () => {
      const out = buildOrgSnapshot(orgId);
      assert.ok(out, 'snapshot should be non-empty for a populated org');
      assert.match(out!, /## PROCESS CATALOG/);
      assert.match(out!, /Patient care VS/);
      assert.match(out!, /Schedule appointment/);
      assert.match(out!, /Look up patient record/);
      assert.match(out!, /## SYSTEMS/);
      assert.match(out!, /Epic EHR/);
      assert.match(out!, /## DATA ASSETS/);
      assert.match(out!, /Patient encounter records/);
    });

    it('includes the activity → system declarations (Phase 3 signal)', () => {
      const out = buildOrgSnapshot(orgId);
      assert.match(out!, /## ACTIVITY → SYSTEM \(declared\)/);
      assert.match(out!, /"Look up patient record" runs on: Epic EHR/);
    });

    it('includes asset-shaped mappings and excludes orphans from the coverage section', () => {
      const out = buildOrgSnapshot(orgId);
      assert.match(out!, /## PROCESS COVERAGE/);
      assert.match(out!, /"Look up patient record" consumes "Patient encounter records"/);
      // The orphan asset's name appears in the catalog list — but it
      // must NOT appear as a coverage row (no mapping). We assert by
      // checking the coverage section directly.
      const cov = out!.split('## PROCESS COVERAGE')[1].split('##')[0];
      assert.ok(!/Unused billing ledger/.test(cov), 'orphan should not appear as a coverage edge');
    });

    it('surfaces orphan assets and dismissal count in KNOWN GAPS', () => {
      const out = buildOrgSnapshot(orgId);
      assert.match(out!, /## KNOWN GAPS/);
      assert.match(out!, /Orphan data assets.*\(1\).*Unused billing ledger/s);
      assert.match(out!, /Suggestions the user has dismissed.*: 1/);
    });
  });

  describe('POST /chat', () => {
    it('400s when messages is missing', async () => {
      const res = await request(port, 'POST', '/chat', { orgContext: { orgId } });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /messages is required/);
    });

    it('400s when messages is an empty array', async () => {
      const res = await request(port, 'POST', '/chat', { messages: [], orgContext: { orgId } });
      assert.strictEqual(res.status, 400);
    });

    it('400s when a message has an unknown role', async () => {
      const res = await request(port, 'POST', '/chat', {
        messages: [{ role: 'admin', content: 'hi' }],
        orgContext: { orgId },
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /valid role/);
    });

    it('happy path: forwards the snapshot + context to aiService.chat and returns the reply', async () => {
      chatCalls = [];
      const res = await request(port, 'POST', '/chat', {
        messages: [{ role: 'user', content: 'What data do we have that nobody uses?' }],
        orgContext: { orgId },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.reply, 'stub-reply');
      // Returns the entity index alongside the reply so the client
      // can render inline citations on the non-streaming path too.
      assert.ok(Array.isArray(res.body.data.entities), 'entities should be an array');
      assert.ok(res.body.data.entities.length > 0, 'entities should be populated');
      assert.strictEqual(chatCalls.length, 1);
      const call = chatCalls[0];
      assert.strictEqual(call.messages[0].content, 'What data do we have that nobody uses?');
      assert.strictEqual(call.context.orgId, orgId);
      assert.strictEqual(call.context.orgName, 'Chat Test Co');
      assert.strictEqual(call.context.industry, 'Healthcare');
      assert.match(call.snapshot!, /Unused billing ledger/);
    });
  });

  describe('buildEntityIndex', () => {
    it('emits entries for activities, processes, systems, assets and people', () => {
      const idx = buildEntityIndex(orgId);
      const names = idx.map((r: any) => r.name);
      assert.ok(names.includes('Look up patient record'), 'activity should appear');
      assert.ok(names.includes('Schedule appointment'), 'process should appear');
      assert.ok(names.includes('Epic EHR'), 'system should appear');
      assert.ok(names.includes('Patient encounter records'), 'asset should appear');
      assert.ok(names.includes('Unused billing ledger'), 'orphan asset should appear');
    });
    it('sorts longest name first so the client matches "Customer Billing Master" before "Customer"', () => {
      const idx = buildEntityIndex(orgId);
      for (let i = 1; i < idx.length; i++) {
        assert.ok(idx[i - 1].name.length >= idx[i].name.length,
          `entries should be sorted longest-first; got ${idx[i - 1].name} before ${idx[i].name}`);
      }
    });
    it('emits a url that points back to the entity\'s page', () => {
      const idx = buildEntityIndex(orgId);
      const sys = idx.find((r: any) => r.name === 'Epic EHR');
      assert.ok(sys);
      assert.match(sys!.url, /^\/systems\?id=/);
      const asset = idx.find((r: any) => r.name === 'Unused billing ledger');
      assert.match(asset!.url, /^\/data-assets\?id=/);
      const act = idx.find((r: any) => r.name === 'Look up patient record');
      assert.match(act!.url, /^\/processes\?node=/);
    });
    it('returns an empty list when orgId is empty', () => {
      assert.deepStrictEqual(buildEntityIndex(''), []);
    });
  });

  describe('POST /chat/stream', () => {
    // The SSE response is a single text/event-stream body — read it
    // raw and parse the event blocks manually so the test doesn't
    // depend on an EventSource client.
    function readStream(method: string, path: string, body: unknown): Promise<{ status: number; events: Array<{ event: string; data: any }> }> {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request(
          {
            host: '127.0.0.1', port, method, path,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
          },
          (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => {
              const events: Array<{ event: string; data: any }> = [];
              for (const block of buf.split('\n\n')) {
                if (!block.trim()) continue;
                let event = 'message';
                let dataStr = '';
                for (const line of block.split('\n')) {
                  if (line.startsWith('event: ')) event = line.slice(7);
                  else if (line.startsWith('data: ')) dataStr += line.slice(6);
                }
                if (dataStr) {
                  try { events.push({ event, data: JSON.parse(dataStr) }); }
                  catch { events.push({ event, data: dataStr }); }
                } else {
                  events.push({ event, data: null });
                }
              }
              resolve({ status: res.statusCode || 0, events });
            });
          },
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    }

    it('400s on missing/empty/unknown-role messages just like /chat', async () => {
      const r1 = await request(port, 'POST', '/chat/stream', { orgContext: { orgId } });
      assert.strictEqual(r1.status, 400);
      const r2 = await request(port, 'POST', '/chat/stream', { messages: [], orgContext: { orgId } });
      assert.strictEqual(r2.status, 400);
      const r3 = await request(port, 'POST', '/chat/stream', {
        messages: [{ role: 'admin', content: 'hi' }], orgContext: { orgId },
      });
      assert.strictEqual(r3.status, 400);
    });

    it('streams text chunks then an entities frame then done', async () => {
      streamCalls = [];
      const res = await readStream('POST', '/chat/stream', {
        messages: [{ role: 'user', content: 'orphans?' }],
        orgContext: { orgId },
      });
      assert.strictEqual(res.status, 200);
      const chunks = res.events.filter((e) => e.event === 'chunk');
      assert.ok(chunks.length > 1, 'should receive multiple chunks');
      const text = chunks.map((e) => e.data.text).join('');
      assert.match(text, /Unused billing ledger/);
      const entitiesEvent = res.events.find((e) => e.event === 'entities');
      assert.ok(entitiesEvent, 'should send an entities frame');
      assert.ok(Array.isArray(entitiesEvent!.data));
      assert.ok((entitiesEvent!.data as any[]).some((r) => r.name === 'Unused billing ledger'));
      assert.ok(res.events.find((e) => e.event === 'done'));
      // chatStream was called with the snapshot in scope.
      assert.strictEqual(streamCalls.length, 1);
      assert.match(streamCalls[0].snapshot!, /Unused billing ledger/);
    });
  });
});
