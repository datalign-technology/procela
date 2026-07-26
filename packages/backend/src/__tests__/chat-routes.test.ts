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
const { glossaryTerms } = require('../routes/business-glossary');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePolicies } = require('../routes/governance-policies');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceIssues } = require('../routes/governance-issues');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceTasks } = require('../routes/governance-tasks');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections, connectionSystemLinks } = require('../routes/connections');
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
  // Parent org so we can prove buildOrgSnapshot walks up the org
  // tree the way filterByOrgScope does. Assets/systems owned by
  // the parent must appear when snapshotting the child scope —
  // the AI has to see the same rows the user is looking at.
  const parentOrgId = 'test-org-chat-parent';
  const PREFIX = 'test-chat-';
  const sysId = PREFIX + 'sys';
  const parentSysId = PREFIX + 'parent-sys';
  const mappedAsset = PREFIX + 'asset-mapped';
  const orphanAsset = PREFIX + 'asset-orphan';
  const parentAsset = PREFIX + 'asset-parent';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const actId = PREFIX + 'act';
  const mapId = PREFIX + 'map';
  const dismissalId = PREFIX + 'dismissal';
  const termId = PREFIX + 'term';
  const policyId = PREFIX + 'policy';
  const issueId = PREFIX + 'issue';
  const taskId = PREFIX + 'task';
  const dqId = PREFIX + 'dq';
  const connId = PREFIX + 'conn';
  const linkA = PREFIX + 'link-a';
  const linkB = PREFIX + 'link-b';
  // Second system on the same connection so we can assert the
  // multi-system join renders in the snapshot.
  const sysId2 = PREFIX + 'sys2';

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
    sweep(glossaryTerms); sweep(governancePolicies); sweep(governanceIssues); sweep(governanceTasks); sweep(dataQualityRules);
    sweep(connections); sweep(connectionSystemLinks);
    // Sweep both orgs so any stale rows from a previous run go away.
    const oiOld = organizations.findIndex((o: any) => o.id === orgId);
    if (oiOld >= 0) organizations.splice(oiOld, 1);
    const oiOldP = organizations.findIndex((o: any) => o.id === parentOrgId);
    if (oiOldP >= 0) organizations.splice(oiOldP, 1);
    const nowInit = new Date().toISOString();
    // Parent-child hierarchy: the child scope (orgId) sits under
    // parentOrgId. filterByOrgScope walks up from the child and
    // must return items owned at parentOrgId as visible.
    organizations.push({ id: parentOrgId, name: 'Chat Test Parent', industry: 'Healthcare', type: 'company', parentId: null, createdAt: nowInit, updatedAt: nowInit });
    organizations.push({ id: orgId, name: 'Chat Test Co', industry: 'Healthcare', type: 'division', parentId: parentOrgId, createdAt: nowInit, updatedAt: nowInit });

    const now = new Date().toISOString();
    systems.push({ id: sysId, orgId, name: 'Epic EHR', description: '', systemType: 'EHR', createdAt: now, updatedAt: now });
    systems.push({ id: sysId2, orgId, name: 'Systems_2', description: '', systemType: 'Ops', createdAt: now, updatedAt: now });
    // System owned at the parent — the child scope's snapshot must
    // include it. This is the scope-bug regression guard.
    systems.push({ id: parentSysId, orgId: parentOrgId, name: 'Corporate DW', description: '', systemType: 'DW', createdAt: now, updatedAt: now });
    // Data connection wired to two systems via the join table.
    // Regression guard for "what systems is <connection> tied to?" —
    // the assistant returned "no such connection" until the
    // snapshot named both the connection and the linked systems.
    connections.push({
      id: connId, orgId, name: 'Systems.csv',
      connectionType: 'FILE_STORAGE',
      config: { storageType: 'LOCAL', originalFileName: 'Systems.csv' },
      credentials: {},
      status: 'CONNECTED', lastTestedAt: now, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    connectionSystemLinks.push({ id: linkA, connectionId: connId, systemId: sysId });
    connectionSystemLinks.push({ id: linkB, connectionId: connId, systemId: sysId2 });
    dataAssets.push(
      { id: mappedAsset, orgId, name: 'Patient encounter records', description: '', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'GOLD', healthScore: 95, createdAt: now, updatedAt: now },
      { id: orphanAsset, orgId, name: 'Unused billing ledger', description: '', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 40, createdAt: now, updatedAt: now },
      // Inherited-from-parent asset — must show up when we snapshot
      // the child scope.
      { id: parentAsset, orgId: parentOrgId, name: 'Corporate finance ledger', description: '', systemId: parentSysId, owner: '', stewardIds: [], governanceTier: 'GOLD', healthScore: 90, createdAt: now, updatedAt: now },
    );
    // Seed a term, policy, open issue, open task, and a failing DQ
    // rule so we can assert the newly-added snapshot sections.
    glossaryTerms.push({
      id: termId, orgId, term: 'Encounter', definition: 'A patient visit or clinical interaction.',
      context: '', synonyms: [], relatedTerms: [], domainId: null, ownerPersonId: null,
      status: 'APPROVED', category: 'BUSINESS', exampleValues: '', businessRules: '', sourceOfTruth: '',
      createdAt: now, updatedAt: now,
    });
    governancePolicies.push({
      id: policyId, orgId, code: 'POL-001', name: 'Data classification policy',
      description: '', documentType: 'POLICY', status: 'ACTIVE', ownerAssignmentId: null,
      category: 'CLASSIFICATION', reviewFrequency: 'ANNUAL', lastReviewDate: null, nextReviewDate: null,
      effectiveDate: null, content: '', createdAt: now, updatedAt: now,
    });
    governanceIssues.push({
      id: issueId, orgId, title: 'Missing steward for billing ledger', description: '',
      issueType: 'STEWARDSHIP', severity: 'HIGH', status: 'OPEN', domainId: null,
      dataAssetId: orphanAsset, systemId: null, reportedBy: null, assignedTo: null,
      resolutionSummary: null, createdAt: now, updatedAt: now, closedAt: null,
    });
    governanceTasks.push({
      id: taskId, orgId, title: 'Assign steward to billing ledger', description: '',
      taskType: 'REMEDIATION', status: 'OPEN', priority: 'HIGH',
      assigneeId: null, dueDate: null, linkedObjectType: null, linkedObjectId: null,
      automationMode: 'MANUAL', resolution: null, createdBy: null,
      createdAt: now, updatedAt: now, completedAt: null,
    });
    dataQualityRules.push({
      id: dqId, orgId, dataAssetId: mappedAsset, dimension: 'COMPLETENESS',
      name: 'Encounter records completeness', description: '', threshold: 95, currentScore: 82,
      weight: 1, status: 'FAILING', lastMeasured: now,
      createdAt: now, updatedAt: now,
    });
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
    sweep(glossaryTerms); sweep(governancePolicies); sweep(governanceIssues); sweep(governanceTasks); sweep(dataQualityRules);
    for (const id of [orgId, parentOrgId]) {
      const i = organizations.findIndex((o: any) => o.id === id);
      if (i >= 0) organizations.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('buildOrgSnapshot', () => {
    it('returns undefined when the org has no nodes/assets/systems at all', async () => {
      assert.strictEqual(await buildOrgSnapshot('this-org-does-not-exist'), undefined);
      assert.strictEqual(await buildOrgSnapshot(''), undefined);
    });

    it('includes the catalog tree, systems and assets sections', async () => {
      const out = await buildOrgSnapshot(orgId);
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

    it('includes the activity → system declarations (Phase 3 signal)', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## ACTIVITY → SYSTEM \(declared\)/);
      assert.match(out!, /"Look up patient record" runs on: Epic EHR/);
    });

    it('includes asset-shaped mappings and excludes orphans from the coverage section', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## PROCESS COVERAGE/);
      assert.match(out!, /"Look up patient record" consumes "Patient encounter records"/);
      // The orphan asset's name appears in the catalog list — but it
      // must NOT appear as a coverage row (no mapping). We assert by
      // checking the coverage section directly.
      const cov = out!.split('## PROCESS COVERAGE')[1].split('##')[0];
      assert.ok(!/Unused billing ledger/.test(cov), 'orphan should not appear as a coverage edge');
    });

    it('surfaces orphan assets and dismissal count in KNOWN GAPS', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## KNOWN GAPS/);
      // Two orphans in scope: the child's "Unused billing ledger"
      // and the parent-inherited "Corporate finance ledger", both
      // of which have no mapping. Names are both required so the
      // regression covers the scope walk-up.
      assert.match(out!, /Orphan data assets.*\(2\)/);
      assert.match(out!, /Unused billing ledger/);
      assert.match(out!, /Corporate finance ledger/);
      assert.match(out!, /Suggestions the user has dismissed.*: 1/);
    });

    // Regression guard for the scope bug: buildOrgSnapshot used to
    // filter by raw `orgId === orgId`, so a child scope couldn't
    // see parent-owned data even though every scoped route (via
    // filterByOrgScope) exposed it. Aligning the snapshot with the
    // same helper fixed the mismatch. Assets/systems/etc. owned
    // above the current scope must now appear in the snapshot.
    it('walks up to ancestors — parent-owned rows appear when scoping to a child', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /Corporate DW/, 'parent-owned system should appear in the child scope snapshot');
      assert.match(out!, /Corporate finance ledger/, 'parent-owned asset should appear in the child scope snapshot');
    });

    it('walks down to descendants — child-owned rows appear when scoping to the parent', async () => {
      const out = await buildOrgSnapshot(parentOrgId);
      assert.ok(out, 'parent snapshot should render even if the parent has no direct rows');
      assert.match(out!, /Epic EHR/, 'child-owned system should appear in the parent scope snapshot');
      assert.match(out!, /Patient encounter records/, 'child-owned asset should appear in the parent scope snapshot');
    });

    it('includes the business glossary section with approved terms', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## BUSINESS GLOSSARY/);
      assert.match(out!, /Encounter: A patient visit/);
    });

    it('includes governance documents with code + name + type', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## GOVERNANCE DOCUMENTS/);
      assert.match(out!, /\[POL-001\] Data classification policy \(policy/);
    });

    it('lists open governance issues (severity + target)', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## OPEN GOVERNANCE ISSUES/);
      assert.match(out!, /Missing steward for billing ledger.*severity:high.*asset:Unused billing ledger/s);
    });

    it('lists open governance tasks with priority + assignee', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## OPEN GOVERNANCE TASKS/);
      assert.match(out!, /Assign steward to billing ledger.*priority:high.*unassigned/s);
    });

    it('summarises data quality and lists failing rules', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## DATA QUALITY/);
      assert.match(out!, /Summary: 0 passing, 1 failing\/warning/);
      assert.match(out!, /Encounter records completeness.*failing.*score:82\/95/s);
    });

    // Regression: user asked "what systems is the Systems.csv
    // connection tied to?" and got "no such connection" — the
    // snapshot didn't include data connections at all. The section
    // must name the connection AND every system it's linked to
    // via connectionSystemLinks so the AI can answer join questions.
    it('lists data connections with their linked systems', async () => {
      const out = await buildOrgSnapshot(orgId);
      assert.match(out!, /## DATA CONNECTIONS/);
      assert.match(out!, /Systems\.csv \(file storage, status:connected, systems:Epic EHR, Systems_2\)/);
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
    it('emits entries for activities, processes, systems, assets and people', async () => {
      const idx = await buildEntityIndex(orgId);
      const names = idx.map((r: any) => r.name);
      assert.ok(names.includes('Look up patient record'), 'activity should appear');
      assert.ok(names.includes('Schedule appointment'), 'process should appear');
      assert.ok(names.includes('Epic EHR'), 'system should appear');
      assert.ok(names.includes('Patient encounter records'), 'asset should appear');
      assert.ok(names.includes('Unused billing ledger'), 'orphan asset should appear');
    });
    it('sorts longest name first so the client matches "Customer Billing Master" before "Customer"', async () => {
      const idx = await buildEntityIndex(orgId);
      for (let i = 1; i < idx.length; i++) {
        assert.ok(idx[i - 1].name.length >= idx[i].name.length,
          `entries should be sorted longest-first; got ${idx[i - 1].name} before ${idx[i].name}`);
      }
    });
    it('emits a url that points back to the entity\'s page', async () => {
      const idx = await buildEntityIndex(orgId);
      const sys = idx.find((r: any) => r.name === 'Epic EHR');
      assert.ok(sys);
      assert.match(sys!.url, /^\/systems\?id=/);
      const asset = idx.find((r: any) => r.name === 'Unused billing ledger');
      assert.match(asset!.url, /^\/data-assets\?id=/);
      const act = idx.find((r: any) => r.name === 'Look up patient record');
      assert.match(act!.url, /^\/processes\?node=/);
    });
    it('returns an empty list when orgId is empty', async () => {
      assert.deepStrictEqual(await buildEntityIndex(''), []);
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
