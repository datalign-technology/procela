// HTTP coverage for routes/ai's industry-template endpoints. The
// template generator is CLAUDE.md item 2 — Phase 1's promised
// "pick an industry and Procela drafts the hierarchy" surface — and
// it lives in production already, but went untested. The actual
// Anthropic call is mocked out: the test focuses on the surrounding
// contract (industry validation, cache hit/miss/refresh, list/delete).
//
// The generate-template endpoint now streams over Server-Sent
// Events so the wizard can render a real progress bar. We stub
// aiService.generateIndustryTemplateStream (the streaming
// counterpart) with a controlled async generator; the request
// helper below parses the SSE frames and returns the terminal
// `done`/`error` event as the effective response body — that way
// every existing assertion (cache hit, cache miss, specialisation
// bucketing) reads exactly the same as before.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const aiRouter = require('../routes/ai').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiService } = require('../services/ai.service');

// Parse a raw SSE payload into its events. Frames are separated by
// blank lines; each frame carries `data: <json>` lines whose payloads
// concatenate. Non-SSE responses (400 validation, GET/DELETE JSON)
// fall through unchanged.
function parseSseFrames(raw: string): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (const block of raw.split('\n\n')) {
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) dataStr += line.slice(6);
    }
    if (!dataStr) continue;
    try { frames.push(JSON.parse(dataStr)); } catch { /* ignore malformed */ }
  }
  return frames;
}

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any; frames?: Array<Record<string, unknown>> }> {
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
          const ct = res.headers['content-type'] || '';
          if (typeof ct === 'string' && ct.includes('text/event-stream')) {
            // SSE: collapse frames into a synthetic JSON body that
            // mirrors the pre-streaming response shape — the terminal
            // `done` event supplies data/cached/generatedAt, an
            // `error` event supplies { success: false, error }.
            const frames = parseSseFrames(chunks);
            const done = frames.find((f) => f.type === 'done');
            const err = frames.find((f) => f.type === 'error');
            if (err) {
              resolve({ status: res.statusCode || 0, body: { success: false, error: err.error }, frames });
              return;
            }
            if (done) {
              resolve({
                status: res.statusCode || 0,
                body: {
                  success: true,
                  data: done.data,
                  cached: done.cached,
                  generatedAt: done.generatedAt,
                  specializedFor: done.specializedFor,
                },
                frames,
              });
              return;
            }
            resolve({ status: res.statusCode || 0, body: null, frames });
            return;
          }
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

describe('routes/ai industry templates', () => {
  let server: http.Server;
  let port: number;
  let callCount = 0;
  let lastCall: { industry: string; specialization: any } | null = null;
  const originalGenerateStream = aiService.generateIndustryTemplateStream.bind(aiService);

  before(async () => {
    // Mount the router under /ai. Replace the streaming template
    // generator with a deterministic async-iterable stub so we
    // never reach Anthropic from CI. Yielding one progress event
    // exercises the SSE-emit path; the terminal `done` event
    // carries the same payload the old non-streaming stub returned.
    aiService.generateIndustryTemplateStream = async function* (industry: string, specialization?: any) {
      callCount++;
      lastCall = { industry, specialization };
      yield { type: 'progress', chars: 42 };
      yield {
        type: 'done',
        data: {
          valueStreams: [
            { name: `${industry} VS`, description: 'stub', processes: [
              { name: 'Stub process', description: '', activities: [{ name: 'Stub activity', description: '' }] },
            ] },
          ],
        },
      };
    };
    const app = express();
    app.use(express.json());
    app.use('/ai', aiRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Clear any cache entries left from previous runs so cache-hit/miss
    // assertions are deterministic.
    await request(port, 'DELETE', '/ai/template-cache');
  });

  after(async () => {
    aiService.generateIndustryTemplateStream = originalGenerateStream;
    await request(port, 'DELETE', '/ai/template-cache');
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => { callCount = 0; lastCall = null; });

  it('rejects a missing industry with 400', async () => {
    // Previously this test locked in enum-only industries. The
    // frontend combobox now accepts free text (Biotech,
    // Utilities Electric, …), so the backend validates only that
    // the field is a non-empty string.
    const res = await request(port, 'POST', '/ai/generate-template', {});
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Industry is required/);
    assert.strictEqual(callCount, 0);
  });

  it('accepts a custom (non-enum) industry string', async () => {
    const res = await request(port, 'POST', '/ai/generate-template', { industry: 'Insurance Tech' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(lastCall?.industry, 'Insurance Tech');
  });

  it('generates and caches a template on first request', async () => {
    await request(port, 'DELETE', '/ai/template-cache');
    const res = await request(port, 'POST', '/ai/generate-template', { industry: 'Healthcare' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.cached, false);
    assert.ok(res.body.generatedAt);
    assert.ok((res.body.data as any).valueStreams);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(lastCall?.industry, 'Healthcare');
  });

  it('returns the cached payload on the second request — no AI call', async () => {
    const res = await request(port, 'POST', '/ai/generate-template', { industry: 'Healthcare' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.cached, true);
    assert.strictEqual(callCount, 0, 'no fresh AI call when cache hits');
  });

  it('refresh=true bypasses the cache and re-generates', async () => {
    const res = await request(port, 'POST', '/ai/generate-template', { industry: 'Healthcare', refresh: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.cached, false);
    assert.strictEqual(callCount, 1);
  });

  it('refresh as query param works as well', async () => {
    const res = await request(port, 'POST', '/ai/generate-template?refresh=true', { industry: 'Healthcare' });
    assert.strictEqual(res.body.cached, false);
    assert.strictEqual(callCount, 1);
  });

  it('caches specialisation independently from the generic industry entry', async () => {
    // Generic Utilities entry first.
    await request(port, 'POST', '/ai/generate-template', { industry: 'Utilities (Electric, Gas, Water)' });
    assert.strictEqual(callCount, 1);
    // Specialised Utilities|Tidewater Electric entry — must not hit
    // the cached generic version.
    await request(port, 'POST', '/ai/generate-template', {
      industry: 'Utilities (Electric, Gas, Water)',
      orgName: 'Tidewater Electric',
      orgType: 'division',
    });
    assert.strictEqual(callCount, 2, 'specialisation should miss the generic cache');
    assert.strictEqual(lastCall?.specialization?.orgName, 'Tidewater Electric');
    // Re-hitting the specialised entry hits its own cache.
    await request(port, 'POST', '/ai/generate-template', {
      industry: 'Utilities (Electric, Gas, Water)',
      orgName: 'Tidewater Electric',
    });
    assert.strictEqual(callCount, 2, 'second specialised call should hit cache');
  });

  it('GET /template-cache lists entries with industry label + generatedAt', async () => {
    const res = await request(port, 'GET', '/ai/template-cache');
    assert.strictEqual(res.status, 200);
    const labels = (res.body.data as any[]).map((e) => e.industry);
    assert.ok(labels.includes('Healthcare'), 'healthcare entry should be in the cache list');
    assert.ok(labels.some((l: string) => /Tidewater Electric/.test(l)), 'specialised entry should appear with its org name in the label');
  });

  it('DELETE /template-cache/:industry busts one entry and forces re-generation', async () => {
    const del = await request(port, 'DELETE', '/ai/template-cache/healthcare');
    assert.strictEqual(del.status, 200);
    const after = await request(port, 'POST', '/ai/generate-template', { industry: 'Healthcare' });
    assert.strictEqual(after.body.cached, false, 'cache miss after explicit delete');
    assert.strictEqual(callCount, 1);
  });

  it('DELETE /template-cache clears every entry', async () => {
    const del = await request(port, 'DELETE', '/ai/template-cache');
    assert.strictEqual(del.status, 200);
    assert.ok(typeof del.body.cleared === 'number');
    const list = await request(port, 'GET', '/ai/template-cache');
    assert.deepStrictEqual(list.body.data, []);
  });
});
