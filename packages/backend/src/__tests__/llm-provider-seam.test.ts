import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 (multi-vendor AI) — provider-seam contract.
//
// Proves the AiService is genuinely decoupled from the model vendor: the
// same service, driven by a FAKE ChatProvider (no network, no SDK), still
// builds its prompts and unwraps the response through its shared JSON
// extractor. This is the guarantee Phase 2's real OpenAI / Gemini / Bedrock
// adapters slot into — if this breaks, the seam has leaked.
// ─────────────────────────────────────────────────────────────────────────

import { AiServiceImpl } from '../services/ai.service';
import type { ChatProvider, LlmRequest } from '../services/llm-provider';

/** Records every request it receives and replays a scripted answer, so a
 *  test can both drive the service and inspect what the service asked for. */
class FakeProvider implements ChatProvider {
  calls: LlmRequest[] = [];
  constructor(
    private completeAnswer: string,
    private streamChunks: string[] = [],
  ) {}

  async complete(req: LlmRequest): Promise<string> {
    this.calls.push(req);
    return this.completeAnswer;
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    this.calls.push(req);
    for (const chunk of this.streamChunks) yield chunk;
  }
}

test('complete-path: service parses a fake provider’s JSON and forwards a real prompt', async () => {
  const fake = new FakeProvider(JSON.stringify([{ name: 'Customer Data', description: 'x' }]));
  const svc = new AiServiceImpl(fake);

  const result = (await svc.generateDataDomains('Utilities')) as Array<{ name: string }>;

  assert.deepEqual(result, [{ name: 'Customer Data', description: 'x' }]);
  // The service still assembles a grounded prompt and hands it to whatever
  // provider is behind the seam.
  assert.equal(fake.calls.length, 1);
  const req = fake.calls[0];
  assert.ok(req.system.length > 0, 'system prompt should be populated');
  assert.equal(req.messages[0].role, 'user');
  assert.match(req.messages[0].content, /Utilities/);
  assert.ok(req.maxTokens > 0, 'a token budget should be set');
});

test('complete-path: markdown-fenced JSON from a provider is still extracted', async () => {
  // Non-Anthropic models often wrap JSON in ```json fences; the shared
  // extractor must cope regardless of which provider produced it.
  const fenced = '```json\n{"valueStreams":[]}\n```';
  const fake = new FakeProvider(fenced);
  const svc = new AiServiceImpl(fake);

  const result = (await svc.generateIndustryTemplate('Healthcare')) as { valueStreams: unknown[] };
  assert.deepEqual(result, { valueStreams: [] });
});

test('stream-path: template streaming accumulates provider deltas then parses', async () => {
  // The provider yields the JSON in fragments; the service should emit
  // progress events as bytes arrive and a final done event with the parsed
  // object assembled from all fragments.
  const chunks = ['{"valueStr', 'eams":[]}'];
  const fake = new FakeProvider('', chunks);
  const svc = new AiServiceImpl(fake);

  const events: Array<{ type: string; chars?: number; data?: unknown }> = [];
  for await (const ev of svc.generateIndustryTemplateStream('Manufacturing')) {
    events.push(ev as { type: string; chars?: number; data?: unknown });
  }

  const progress = events.filter((e) => e.type === 'progress');
  const done = events.find((e) => e.type === 'done');
  assert.equal(progress.length, 2, 'one progress event per streamed fragment');
  assert.deepEqual(done?.data, { valueStreams: [] });
});

test('stream-path: chatStream re-yields the provider’s text deltas verbatim', async () => {
  const fake = new FakeProvider('', ['Hello', ' ', 'world']);
  const svc = new AiServiceImpl(fake);

  const out: string[] = [];
  for await (const frag of svc.chatStream(
    [{ role: 'user', content: 'hi' }],
    { orgName: 'Acme', industry: 'Utilities' } as any,
    'catalog snapshot',
  )) {
    out.push(frag);
  }

  assert.deepEqual(out, ['Hello', ' ', 'world']);
  // The chat system prompt should carry the org grounding through to the
  // provider request.
  assert.match(fake.calls[0].system, /Acme/);
});
