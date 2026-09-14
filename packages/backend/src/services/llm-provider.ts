import Anthropic from '@anthropic-ai/sdk';
import config from '../config';

// ─────────────────────────────────────────────────────────────────────────
// LLM provider seam
//
// This is the transport boundary between Procela's AI service (which owns
// the prompts and the JSON-extraction safety net) and whatever model vendor
// actually answers the call. Every AiService method builds a vendor-neutral
// request — a system prompt, a message list, a token budget — and hands it
// to a ChatProvider. The provider is the ONLY thing that knows a specific
// vendor's SDK, request params, response shape, and streaming events.
//
// Today there is one implementation (AnthropicProvider). Phase 2 adds
// OpenAI-compatible, Gemini, and Bedrock adapters behind this same
// interface; the AiService above them does not change. Keeping the vendor
// SDK import confined here is the whole point — the rest of the backend
// speaks only in LlmRequest / string.
// ─────────────────────────────────────────────────────────────────────────

/** One conversational turn, vendor-neutral. Mirrors the shape every major
 *  chat API accepts; providers translate it to their own message type. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A single completion request in vendor-neutral terms. Providers map each
 *  field onto their SDK — e.g. `maxTokens` becomes Anthropic's `max_tokens`
 *  or OpenAI's `max_completion_tokens`, and `system` is passed as a
 *  top-level system prompt (Anthropic) or a leading system message
 *  (OpenAI). */
export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** Ask the provider to constrain output to a JSON object where the vendor
   *  supports it natively (OpenAI response_format, Gemini responseMimeType).
   *  A hint, not a guarantee — the AiService's extractJson stays the safety
   *  net regardless, and providers without a native mode ignore it. Only set
   *  it for OBJECT-returning prompts: OpenAI's json_object mode rejects a
   *  top-level array, so array-returning calls must leave it off. */
  jsonMode?: boolean;
}

/** The transport contract every vendor adapter implements. `complete`
 *  returns the whole answer as one string; `stream` yields the answer as
 *  text fragments as they arrive. Both return PLAIN TEXT — any vendor-
 *  specific envelope (Anthropic content blocks, OpenAI choices, thinking
 *  blocks, etc.) is unwrapped inside the adapter, never leaked upward. */
export interface ChatProvider {
  complete(req: LlmRequest): Promise<string>;
  stream(req: LlmRequest): AsyncIterable<string>;
}

/** Per-instance credentials for an adapter. When omitted, each adapter falls
 *  back to the deployment-level env/config values (preserving the phase-2
 *  behaviour). Supplying these is what lets one org run on its own key — the
 *  per-tenant path builds an adapter bound to the org's decrypted key. */
export interface ProviderCredentials {
  apiKey?: string;
  /** OpenAI-compatible endpoint base URL (Azure / self-hosted). */
  baseUrl?: string;
  /** AWS region for Bedrock. */
  region?: string;
}

/** Adapter construction options: bound credentials for production, or a
 *  pre-built SDK `client` for tests (no network, no real SDK). */
export interface ProviderOptions {
  creds?: ProviderCredentials;
  client?: any;
}

/**
 * Concatenate every text block in an Anthropic response.
 *
 * Older Claude models put a single text block at content[0]. Claude
 * 5-family models with extended thinking return the content array as
 * `[{type: 'thinking', ...}, {type: 'text', text: ...}]`, so content[0] is
 * the thinking block and the text would be silently missed. This walks the
 * array, keeps every text block's `text` field, and joins them. Non-text
 * blocks (thinking, tool_use, etc.) are ignored.
 *
 * Anthropic-specific — hence it lives inside the Anthropic adapter file.
 */
function textFromAnthropicResponse(response: { content?: unknown }): string {
  const arr = Array.isArray(response.content) ? response.content : [];
  const parts: string[] = [];
  for (const block of arr) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: string }).text;
      if (typeof t === 'string' && t) parts.push(t);
    }
  }
  return parts.join('');
}

/**
 * Anthropic (Claude) transport adapter. Wraps the `@anthropic-ai/sdk`
 * client — the only place in the backend that imports it — and normalizes
 * both the one-shot and streaming response shapes to plain text.
 *
 * The client is created lazily and cached so a missing key surfaces on
 * first AI use rather than at boot, matching the previous behaviour.
 */
export class AnthropicProvider implements ChatProvider {
  private client: Anthropic | null = null;

  constructor(private opts: ProviderOptions = {}) {}

  private getClient(): Anthropic {
    if (this.opts.client) return this.opts.client;
    if (!this.client) {
      const apiKey = this.opts.creds?.apiKey || config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set. Check your .env file.');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async complete(req: LlmRequest): Promise<string> {
    const response = await this.getClient().messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
    });
    return textFromAnthropicResponse(response);
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const stream = this.getClient().messages.stream({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OpenAI-compatible adapter — covers OpenAI, Azure OpenAI, and any
// self-hosted / OpenAI-compatible server (Ollama, vLLM, LiteLLM, OpenRouter)
// via OPENAI_BASE_URL. The SDK loads lazily so a build that never selects
// this provider never pulls it in.
// ─────────────────────────────────────────────────────────────────────────
export class OpenAiProvider implements ChatProvider {
  private clientPromise: Promise<any> | null = null;

  // `opts.client` lets a test drive the adapter with a fake `chat` surface
  // (no SDK, no network); `opts.creds` binds a specific org's key/base-URL.
  // Production with neither falls back to the deployment env/config.
  constructor(private opts: ProviderOptions = {}) {}

  private async getClient(): Promise<any> {
    if (this.opts.client) return this.opts.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { default: OpenAI } = await import('openai');
        const apiKey = this.opts.creds?.apiKey || config.openaiApiKey || process.env.OPENAI_API_KEY || '';
        const baseURL = this.opts.creds?.baseUrl || config.openaiBaseUrl || '';
        if (!apiKey && !baseURL) {
          throw new Error('OPENAI_API_KEY is not set (or set OPENAI_BASE_URL for a keyless self-hosted endpoint).');
        }
        return new OpenAI({ apiKey: apiKey || 'not-required', baseURL: baseURL || undefined });
      })();
    }
    return this.clientPromise;
  }

  // OpenAI carries the system prompt as a leading system message rather
  // than a top-level field.
  private toMessages(req: LlmRequest) {
    return [{ role: 'system' as const, content: req.system }, ...req.messages];
  }

  private params(req: LlmRequest): Record<string, unknown> {
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: this.toMessages(req),
      ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  async complete(req: LlmRequest): Promise<string> {
    const client = await this.getClient();
    const res = await client.chat.completions.create(this.params(req));
    return res?.choices?.[0]?.message?.content ?? '';
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const client = await this.getClient();
    const s = await client.chat.completions.create({ ...this.params(req), stream: true });
    for await (const chunk of s) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield delta;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Google Gemini adapter.
// ─────────────────────────────────────────────────────────────────────────
export class GeminiProvider implements ChatProvider {
  private clientPromise: Promise<any> | null = null;

  constructor(private opts: ProviderOptions = {}) {}

  private async getClient(): Promise<any> {
    if (this.opts.client) return this.opts.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const apiKey = this.opts.creds?.apiKey || config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
        if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
        return new GoogleGenerativeAI(apiKey);
      })();
    }
    return this.clientPromise;
  }

  // Gemini names the assistant turn "model"; the system prompt is a
  // dedicated systemInstruction, not a message.
  private toContents(req: LlmRequest) {
    return req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  private async getModel(req: LlmRequest): Promise<any> {
    const client = await this.getClient();
    return client.getGenerativeModel({
      model: req.model,
      ...(req.system ? { systemInstruction: req.system } : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });
  }

  async complete(req: LlmRequest): Promise<string> {
    const model = await this.getModel(req);
    const res = await model.generateContent({ contents: this.toContents(req) });
    return res?.response?.text?.() ?? '';
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const model = await this.getModel(req);
    const res = await model.generateContentStream({ contents: this.toContents(req) });
    for await (const chunk of res.stream) {
      const t = chunk?.text?.();
      if (typeof t === 'string' && t) yield t;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// AWS Bedrock adapter — uses the Converse API, which is uniform across every
// Bedrock model family (Anthropic, Llama, Mistral, Titan, Cohere), so one
// adapter covers all of them. Credentials come from the standard AWS chain.
// ─────────────────────────────────────────────────────────────────────────
export class BedrockProvider implements ChatProvider {
  private clientPromise: Promise<any> | null = null;

  constructor(private opts: ProviderOptions = {}) {}

  private async getClient(): Promise<any> {
    if (this.opts.client) return this.opts.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
        return new BedrockRuntimeClient({ region: this.opts.creds?.region || config.bedrockRegion });
      })();
    }
    return this.clientPromise;
  }

  private toInput(req: LlmRequest): Record<string, unknown> {
    return {
      modelId: req.model,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { maxTokens: req.maxTokens },
    };
  }

  async complete(req: LlmRequest): Promise<string> {
    const client = await this.getClient();
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const out: any = await client.send(new ConverseCommand(this.toInput(req) as any));
    const blocks: any[] = out?.output?.message?.content ?? [];
    return blocks.map((b) => b?.text ?? '').join('');
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const client = await this.getClient();
    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const out: any = await client.send(new ConverseStreamCommand(this.toInput(req) as any));
    for await (const ev of out?.stream ?? []) {
      const t = ev?.contentBlockDelta?.delta?.text;
      if (typeof t === 'string' && t) yield t;
    }
  }
}

/**
 * Resolve a provider name (from `AI_PROVIDER`) to its adapter. Unknown names
 * throw rather than silently falling back, so a typo surfaces on first AI use
 * instead of quietly routing to the wrong vendor. Called lazily (first AI
 * call / boot probe), never at module load, so a bad value never crashes the
 * whole backend at boot.
 */
/** The canonical provider names the UI offers and the store persists. */
export const KNOWN_PROVIDERS = ['anthropic', 'openai', 'gemini', 'bedrock'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/** Fold a provider name (incl. aliases: claude / azure / google / aws) to its
 *  canonical form, or null if unrecognised. Used to validate a per-tenant
 *  provider choice with a clean 400 before it ever reaches createChatProvider. */
export function normalizeProviderName(name?: string): KnownProvider | null {
  switch ((name || '').trim().toLowerCase()) {
    case 'anthropic':
    case 'claude':
      return 'anthropic';
    case 'openai':
    case 'azure':
    case 'azure-openai':
      return 'openai';
    case 'gemini':
    case 'google':
      return 'gemini';
    case 'bedrock':
    case 'aws':
      return 'bedrock';
    default:
      return null;
  }
}

export function createChatProvider(name?: string, creds?: ProviderCredentials): ChatProvider {
  const opts: ProviderOptions = creds ? { creds } : {};
  switch ((name || 'anthropic').trim().toLowerCase()) {
    case '':
    case 'anthropic':
    case 'claude':
      return new AnthropicProvider(opts);
    case 'openai':
    case 'azure':
    case 'azure-openai':
      return new OpenAiProvider(opts);
    case 'gemini':
    case 'google':
      return new GeminiProvider(opts);
    case 'bedrock':
    case 'aws':
      return new BedrockProvider(opts);
    default:
      throw new Error(`Unknown AI_PROVIDER "${name}". Use one of: anthropic, openai, gemini, bedrock.`);
  }
}

// Internal helper exposed for unit tests. Not part of the public API.
export const _textFromAnthropicResponseForTests = textFromAnthropicResponse;
