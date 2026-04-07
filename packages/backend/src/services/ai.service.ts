import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import { ProcessContext, OrgContext, ChatMessage } from '../types';

const MODEL = 'claude-sonnet-4-20250514';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Check your .env file.');
    }
    _client = new Anthropic({ apiKey });
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
      system: `You are a business process expert for the Procela platform. Generate a comprehensive process hierarchy for the specified industry.

Procela uses a universal process hierarchy with these levels:
- VALUE STREAM (required) — end-to-end flow delivering value
- PROCESS (required) — a defined set of activities achieving an outcome
- ACTIVITY (required) — a specific unit of work with inputs and outputs

Optional levels (include where they add clarity):
- SUBPROCESS — a grouping of activities within a process

Return ONLY a valid JSON object — no markdown, no code fences, no explanation:
{
  "valueStreams": [
    {
      "name": "Value Stream Name",
      "description": "What value this stream delivers and to whom",
      "processes": [
        {
          "name": "Process Name",
          "description": "What this process achieves",
          "activities": [
            {
              "name": "Activity Name",
              "description": "What happens in this activity, its inputs and outputs"
            }
          ]
        }
      ]
    }
  ]
}

Guidelines:
- Generate 3-5 value streams typical for the industry
- Each value stream should have 3-5 processes
- Each process should have 3-6 activities
- Activities should be ordered in their natural sequence (first to last)
- Activity names should start with a verb (e.g. "Receive", "Validate", "Approve", "Dispatch")
- Activity descriptions should mention what triggers it and what it produces
- Use clear business language accessible to non-technical users
- Descriptions should be concise (1-2 sentences)
- Focus on the most common, standard processes for the industry`,
      messages: [
        {
          role: 'user',
          content: `Generate a standard process hierarchy for the "${industry}" industry. Include value streams, processes, and activities.`,
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
