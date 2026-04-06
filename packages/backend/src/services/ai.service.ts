import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import { ProcessContext, OrgContext, ChatMessage } from '../types';

const MODEL = 'claude-sonnet-4-20250514';

const client = new Anthropic({
  apiKey: config.anthropicApiKey,
});

export interface AiService {
  generateIndustryTemplate(industry: string): Promise<object>;
  suggestDataAssets(context: ProcessContext): Promise<object>;
  chat(messages: ChatMessage[], orgContext: OrgContext): Promise<string>;
}

class AnthropicAiService implements AiService {
  /**
   * Generate a starter value-stream / process template for a given industry.
   */
  async generateIndustryTemplate(industry: string): Promise<object> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system:
        'You are a business process expert. Return a JSON object containing a suggested value stream hierarchy for the given industry. Include value streams, processes, sub-processes, and example process steps.',
      messages: [
        {
          role: 'user',
          content: `Generate a standard value stream template for the "${industry}" industry.`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Suggest data assets that are likely relevant for a given process context.
   */
  async suggestDataAssets(context: ProcessContext): Promise<object> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system:
        'You are a data governance expert. Given a process context, suggest data assets (tables, datasets, reports) that are likely consumed or produced by the process step. Return a JSON array of suggestions.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(context),
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Multi-turn conversational chat with organization-aware context.
   */
  async chat(messages: ChatMessage[], orgContext: OrgContext): Promise<string> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: `You are an AI assistant for the Procela platform, helping with business process mapping and data governance. Organization: ${orgContext.orgName ?? 'Unknown'}, Industry: ${orgContext.industry ?? 'General'}.`,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }
}

export const aiService: AiService = new AnthropicAiService();
