import { test } from 'node:test';
import assert from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 (multi-vendor AI) — adapter contracts.
//
// Each vendor adapter is driven with a FAKE SDK client (no network, no real
// SDK call) so we can assert the two things an adapter is responsible for:
//   1. mapping the vendor-neutral LlmRequest onto that SDK's call shape, and
//   2. normalizing the vendor's response envelope back to plain text.
// The AiService above these was already proven vendor-neutral in phase 1;
// this locks the vendor-specific translation each adapter performs.
// ─────────────────────────────────────────────────────────────────────────

import {
  createChatProvider,
  AnthropicProvider,
  OpenAiProvider,
  GeminiProvider,
  BedrockProvider,
  type LlmRequest,
} from '../services/llm-provider';

async function* aiter<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const s of stream) out.push(s);
  return out;
}

const baseReq: LlmRequest = {
  model: 'm-1',
  system: 'SYS',
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'again' },
  ],
  maxTokens: 123,
};

// ── factory ───────────────────────────────────────────────────────────────

test('createChatProvider maps every known name to its adapter and rejects unknowns', () => {
  assert.ok(createChatProvider(undefined) instanceof AnthropicProvider);
  assert.ok(createChatProvider('anthropic') instanceof AnthropicProvider);
  assert.ok(createChatProvider('claude') instanceof AnthropicProvider);
  assert.ok(createChatProvider('openai') instanceof OpenAiProvider);
  assert.ok(createChatProvider('azure') instanceof OpenAiProvider);
  assert.ok(createChatProvider('AZURE-OPENAI') instanceof OpenAiProvider);
  assert.ok(createChatProvider('gemini') instanceof GeminiProvider);
  assert.ok(createChatProvider('google') instanceof GeminiProvider);
  assert.ok(createChatProvider('bedrock') instanceof BedrockProvider);
  assert.ok(createChatProvider('aws') instanceof BedrockProvider);
  assert.throws(() => createChatProvider('llama.cpp'), /Unknown AI_PROVIDER/);
});

// ── OpenAI-compatible adapter ───────────────────────────────────────────────

test('OpenAiProvider: system-leading messages, token budget, json mode, choice unwrap', async () => {
  let captured: any = null;
  const fake = {
    chat: {
      completions: {
        create: async (params: any) => {
          captured = params;
          if (params.stream) return aiter([
            { choices: [{ delta: { content: 'A' } }] },
            { choices: [{ delta: { content: 'B' } }] },
            { choices: [{ delta: {} }] }, // no content — must be skipped
          ]);
          return { choices: [{ message: { content: 'the answer' } }] };
        },
      },
    },
  };
  const p = new OpenAiProvider({ client: fake });

  const text = await p.complete({ ...baseReq, jsonMode: true });
  assert.equal(text, 'the answer');
  assert.equal(captured.model, 'm-1');
  assert.equal(captured.max_tokens, 123);
  // System prompt is carried as a leading system message.
  assert.deepEqual(captured.messages[0], { role: 'system', content: 'SYS' });
  assert.equal(captured.messages[1].content, 'hello');
  assert.equal(captured.messages.length, 4);
  assert.deepEqual(captured.response_format, { type: 'json_object' });

  const chunks = await collect(new OpenAiProvider({ client: fake }).stream(baseReq));
  assert.deepEqual(chunks, ['A', 'B']);
  assert.equal(captured.stream, true);
  // No jsonMode this time → no response_format forced.
  assert.equal(captured.response_format, undefined);
});

// ── Gemini adapter ──────────────────────────────────────────────────────────

test('Gemini: assistant→model role map, systemInstruction, responseMimeType, text unwrap', async () => {
  let modelCfg: any = null;
  let genArg: any = null;
  const fake = {
    getGenerativeModel: (cfg: any) => {
      modelCfg = cfg;
      return {
        generateContent: async (arg: any) => {
          genArg = arg;
          return { response: { text: () => 'gemini says hi' } };
        },
        generateContentStream: async (arg: any) => {
          genArg = arg;
          return { stream: aiter([{ text: () => 'x' }, { text: () => 'y' }, { text: () => '' }]) };
        },
      };
    },
  };

  const text = await new GeminiProvider({ client: fake }).complete({ ...baseReq, jsonMode: true });
  assert.equal(text, 'gemini says hi');
  assert.equal(modelCfg.model, 'm-1');
  assert.equal(modelCfg.systemInstruction, 'SYS');
  assert.equal(modelCfg.generationConfig.maxOutputTokens, 123);
  assert.equal(modelCfg.generationConfig.responseMimeType, 'application/json');
  // assistant turn is renamed to "model"; user stays user.
  assert.deepEqual(genArg.contents.map((c: any) => c.role), ['user', 'model', 'user']);
  assert.equal(genArg.contents[0].parts[0].text, 'hello');

  const chunks = await collect(new GeminiProvider({ client: fake }).stream(baseReq));
  assert.deepEqual(chunks, ['x', 'y']);
});

// ── Bedrock adapter (Converse API) ──────────────────────────────────────────

test('Bedrock: Converse input mapping and multi-block text join', async () => {
  let converseInput: any = null;
  let streamInput: any = null;
  const fake = {
    send: async (cmd: any) => {
      if (cmd.constructor.name === 'ConverseStreamCommand') {
        streamInput = cmd.input;
        return {
          stream: aiter([
            { contentBlockDelta: { delta: { text: 'Cus' } } },
            { messageStart: { role: 'assistant' } }, // non-text event — skipped
            { contentBlockDelta: { delta: { text: 'tomer' } } },
          ]),
        };
      }
      converseInput = cmd.input;
      return { output: { message: { content: [{ text: 'Cust' }, { text: 'omer' }] } } };
    },
  };

  const text = await new BedrockProvider({ client: fake }).complete(baseReq);
  assert.equal(text, 'Customer'); // two content blocks joined
  assert.equal(converseInput.modelId, 'm-1');
  assert.deepEqual(converseInput.system, [{ text: 'SYS' }]);
  assert.equal(converseInput.inferenceConfig.maxTokens, 123);
  assert.deepEqual(converseInput.messages[0], { role: 'user', content: [{ text: 'hello' }] });
  assert.deepEqual(converseInput.messages[1], { role: 'assistant', content: [{ text: 'hi' }] });

  const chunks = await collect(new BedrockProvider({ client: fake }).stream(baseReq));
  assert.deepEqual(chunks, ['Cus', 'tomer']);
  assert.equal(streamInput.modelId, 'm-1');
});

test('Bedrock: omits the system block when there is no system prompt', async () => {
  let converseInput: any = null;
  const fake = {
    send: async (cmd: any) => {
      converseInput = cmd.input;
      return { output: { message: { content: [{ text: 'ok' }] } } };
    },
  };
  await new BedrockProvider({ client: fake }).complete({ ...baseReq, system: '' });
  assert.equal(converseInput.system, undefined);
});
