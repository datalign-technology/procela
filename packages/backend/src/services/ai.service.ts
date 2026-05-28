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

export interface IndustryTemplateSpecialization {
  /** The active org's name (e.g. "Tidewater Electric"). When set,
   *  the AI specialises the template to this division / department
   *  instead of returning a generic industry template. */
  orgName: string;
  /** Optional description from the org record. Helps Claude pick
   *  the right sub-specialty when names are ambiguous ("Northwest
   *  Region" vs "Tidewater Electric"). */
  orgDescription?: string;
  /** Org type — company / division / department / team. Passes
   *  through to the prompt so Claude can scope appropriately. */
  orgType?: string;
}

/** Everything an agent needs to actually perform one governance activity.
 *  Assembled server-side from the activity node and its linked context. */
export interface GovernanceActivityRun {
  agent: { name: string; instructions: string; description?: string; agentType?: string };
  activity: { name: string; description?: string; inputsOutputs?: string; responsibleRole?: string };
  inputs: string[];          // resolved linked inputs (assets / docs / files)
  outputs: string[];         // resolved linked outputs
  systems: string[];         // system names this activity runs on
  requiredSkills: string[];  // skills the human role would need
  orgName?: string;
}

export interface AiService {
  generateIndustryTemplate(industry: string, specialization?: IndustryTemplateSpecialization): Promise<object>;
  generateDataDomains(industry: string): Promise<object>;
  suggestDataAssets(context: ProcessContext): Promise<object>;
  chat(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): Promise<string>;
  /** Run the agent against a single governance activity and return a
   *  Markdown draft deliverable for human review. */
  performGovernanceActivity(run: GovernanceActivityRun): Promise<string>;
}

class AnthropicAiService implements AiService {
  /**
   * Generate a starter value-stream / process template for a given
   * industry. When `specialization` is supplied the template is
   * tailored to that specific org — e.g. Tidewater Electric gets
   * electric-utility processes (SCADA, outage management,
   * transmission & distribution) instead of generic "Utilities"
   * content that mixes electric, water and gas. Without a
   * specialization the prompt is industry-only, preserving the
   * original behaviour.
   */
  async generateIndustryTemplate(industry: string, specialization?: IndustryTemplateSpecialization): Promise<object> {
    const userMessage = specialization
      ? `Generate a standard process hierarchy for the "${industry}" industry, specialised for the **${specialization.orgName}** ${specialization.orgType || 'division'}${specialization.orgDescription ? ` (${specialization.orgDescription})` : ''}. The hierarchy should reflect the specific operations, terminology and processes of this sub-organization rather than the generic industry. Include value streams, processes, and activities.`
      : `Generate a standard process hierarchy for the "${industry}" industry. Include value streams, processes, and activities.`;
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
      "purpose": "What this value stream accomplishes for the business (one sentence)",
      "businessOutcome": "The tangible value or result this delivers (one sentence)",
      "processes": [
        {
          "name": "Process Name",
          "description": "What this process achieves",
          "purpose": "Why this process exists and what it accomplishes (one sentence)",
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
- Value Stream PURPOSE should answer "what does this accomplish?" — a clear business mission
- Value Stream BUSINESS OUTCOME should answer "what value does this deliver?" — measurable or tangible result
- Process PURPOSE should answer "what does this process exist to do?" — its specific operational mission
- Use clear business language accessible to non-technical users
- Descriptions and purpose statements should be concise (1-2 sentences)
- Focus on the most common, standard processes for the industry`,
      messages: [
        {
          role: 'user',
          content: userMessage,
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
   * Generate data-domain suggestions for a given industry. Returns an
   * array of { name, description } objects that the frontend previews
   * before committing.
   */
  async generateDataDomains(industry: string): Promise<object> {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: `You are a data governance expert for the Procela platform. Given an industry, suggest the standard data domains that a company in that industry should define to organize their enterprise data assets.

A data domain is a top-level grouping of related data assets under a single governance umbrella — for example "Customer Data", "Financial Data", "Product Data", "Operational Data".

Return ONLY a valid JSON array — no markdown, no code fences, no explanation:
[
  {
    "name": "Domain Name",
    "description": "1-2 sentence description of what data this domain governs and why it matters"
  }
]

Guidelines:
- Suggest 6-12 domains that are standard for the industry
- Include both operational and analytical domains
- Include regulatory/compliance domains where relevant (e.g. NERC CIP for utilities, HIPAA for healthcare)
- Use clear business language accessible to non-technical users
- Order from most foundational to most specialized
- Descriptions should explain scope and governance rationale`,
      messages: [
        {
          role: 'user',
          content: `Generate standard data domains for the "${industry}" industry.`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
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
   * Multi-turn conversational chat, grounded in the organization's
   * actual Procela data when a catalog summary is supplied.
   */
  async chat(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): Promise<string> {
    const parts: string[] = [
      'You are the AI assistant for Procela, a platform that connects an organization\'s '
        + 'business processes to the data and systems that support them.',
      `Organization: ${orgContext.orgName ?? 'Unknown'} — industry: ${orgContext.industry ?? 'General'}.`,
    ];
    if (catalogSummary && catalogSummary.trim()) {
      parts.push(
        'Below is a snapshot of THIS organization\'s current Procela data. Answer questions '
          + 'using ONLY this snapshot — never invent value streams, processes, activities, data '
          + 'assets, systems, or owners that do not appear here. If the answer is not in the '
          + 'data, say so plainly and suggest where the user could define it.',
        catalogSummary.trim(),
      );
    } else {
      parts.push(
        'This organization has no catalog data yet. If asked about specific processes, assets, '
          + 'or gaps, explain that nothing has been defined and point the user to the relevant '
          + 'page (Process Catalog, Data Assets, Systems).',
      );
    }
    parts.push(
      'Keep answers concise and actionable. Name specific processes, assets, and gaps rather '
        + 'than speaking generally. Do not fabricate.',
    );

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: parts.join('\n\n'),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  async performGovernanceActivity(run: GovernanceActivityRun): Promise<string> {
    const { agent, activity, inputs, outputs, systems, requiredSkills, orgName } = run;

    const system = [
      'You are an autonomous AI agent operating inside Procela, a platform that connects an organization\'s '
        + 'business processes to the data and systems that support them. You have been assigned to PERFORM a '
        + 'data-governance activity that a human role would normally carry out, and to produce a draft '
        + 'deliverable for human review.',
      'Your operating instructions (set by the team that configured you):\n"""\n'
        + (agent.instructions?.trim() || '(No specific instructions provided — apply general data-governance best practice, DAMA-DMBOK aligned.)')
        + '\n"""',
      'Critical constraints:\n'
        + '- You are working ONLY from the business-context description provided below. You do NOT have access '
        + 'to live data, databases, dashboards, or systems. Never claim to have queried, scanned, profiled, or '
        + 'measured real data.\n'
        + '- Wherever the activity would require real data or system access, say so explicitly and describe what '
        + 'you would need to complete it for real.\n'
        + '- Produce a concrete, useful draft tailored to THIS activity — not a generic essay.\n'
        + '- This output is a DRAFT pending human approval. Be explicit about your assumptions and confidence.',
      'Return your deliverable as well-structured Markdown using exactly these sections:\n'
        + '## Summary\n## Findings / Assessment\n## Recommendations\n## Assumptions & Data Needed',
    ].join('\n\n');

    const lines: string[] = [];
    if (orgName) lines.push(`Organization: ${orgName}`);
    lines.push(`Activity: ${activity.name}`);
    if (activity.description) lines.push(`Description: ${activity.description}`);
    if (activity.responsibleRole) lines.push(`Human role normally responsible: ${activity.responsibleRole}`);
    if (activity.inputsOutputs) lines.push(`Inputs/outputs note (free text): ${activity.inputsOutputs}`);
    if (requiredSkills.length) lines.push(`Skills this work requires: ${requiredSkills.join(', ')}`);
    lines.push(inputs.length ? `Linked inputs:\n${inputs.map((i) => `- ${i}`).join('\n')}` : 'Linked inputs: none recorded.');
    lines.push(outputs.length ? `Linked outputs:\n${outputs.map((o) => `- ${o}`).join('\n')}` : 'Linked outputs: none recorded.');
    lines.push(systems.length ? `Systems involved: ${systems.join(', ')}` : 'Systems involved: none recorded.');
    lines.push('\nPerform this activity now and produce your draft deliverable.');

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }
}

export const aiService: AiService = new AnthropicAiService();
