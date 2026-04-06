import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import { ProcessContext, OrgContext, ChatMessage } from '../types';

const MODEL = 'claude-sonnet-4-20250514';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}

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
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: `You are a business process expert for the Procela platform. Generate a comprehensive value stream hierarchy for the specified industry.

Return ONLY a valid JSON object with this exact structure — no markdown, no code fences, no explanation:
{
  "valueStreams": [
    {
      "name": "Value Stream Name",
      "description": "Brief description of this value stream",
      "processes": [
        {
          "name": "Process Name",
          "description": "Brief description",
          "subProcesses": [
            {
              "name": "Sub-Process Name",
              "description": "Brief description",
              "steps": [
                { "name": "Step Name", "description": "Brief description" }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Guidelines:
- Generate 3-5 value streams typical for the industry
- Each value stream should have 2-4 processes
- Each process should have 2-3 sub-processes
- Each sub-process should have 2-4 steps
- Use clear business language, not technical jargon
- Descriptions should be concise (1-2 sentences)`,
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
      // Handle potential markdown code fences in response
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Suggest data assets that are likely relevant for a given process context.
   */
  async suggestDataAssets(context: ProcessContext): Promise<object> {
    const response = await getClient().messages.create({
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
    const response = await getClient().messages.create({
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
