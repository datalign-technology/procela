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

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
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

// Internal helper exposed for unit tests. Not part of the public API.
export const _textFromAnthropicResponseForTests = textFromAnthropicResponse;
