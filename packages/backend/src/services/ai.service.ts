import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import { ProcessContext, OrgContext, ChatMessage } from '../types';

// Model resolution: admin override (set via Settings → AI, wins)
// → ANTHROPIC_MODEL env → config default. Kept as a getter so
// changing the override at runtime affects the next call without a
// restart. See routes/ai.ts (settings + models endpoints) and the
// startup ping in index.ts.
let _modelOverride: string | null = null;
export function getConfiguredModel(): string {
  return _modelOverride || config.anthropicModel;
}
export function setModelOverride(model: string | null): void {
  _modelOverride = model && model.trim() ? model.trim() : null;
}

let _client: Anthropic | null = null;

/**
 * Pull the first top-level JSON value (array or object) out of a free-
 * form Claude response. Tolerates:
 *
 *   - Markdown code fences in any common variant (```json, ```, ~~~).
 *   - Narrative prefaces ("Here are the domains:") or trailing notes
 *     after the JSON.
 *   - Mixed-content responses where the JSON is embedded.
 *
 * Uses a small bracket-balance scanner that respects string literals
 * and escape sequences so `]` inside a description doesn't fool it.
 * Throws an Error carrying the raw text when nothing parseable is
 * found — that surfaces upstream as a real error in the UI instead of
 * a silent empty array.
 */
function extractJson(text: string): unknown {
  if (!text) throw aiParseError('Empty response from AI', text);

  // Strip the common code-fence variants up front. This handles the
  // "everything inside one fence" case quickly without touching the
  // bracket scanner.
  const stripped = text
    .replace(/```json\b/gi, '```')
    .replace(/~~~/g, '```')
    .replace(/```/g, '')
    .trim();

  // Fast path: the whole stripped body parses cleanly.
  try { return JSON.parse(stripped); } catch { /* fall through */ }

  // Scan for the first top-level [ ... ] or { ... } that balances and
  // attempt to parse it.
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    const start = stripped.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const candidate = stripped.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }

  throw aiParseError(
    "Couldn't parse JSON from the AI response. The model returned text " +
    'that isn\'t a recognised JSON array or object.',
    text,
  );
}

interface AiParseError extends Error { rawResponse?: string }

function aiParseError(message: string, raw: string): AiParseError {
  const err: AiParseError = new Error(message);
  err.name = 'AiParseError';
  err.rawResponse = raw;
  return err;
}

/**
 * Concatenate every text block in a Claude response.
 *
 * Older Claude models put a single text block at content[0] — every
 * call site in this file used to just grab that. Claude 5-family
 * models with extended thinking return the content array as
 * `[{type: 'thinking', ...}, {type: 'text', text: ...}]`, so
 * content[0] is the thinking block and the text was silently missed —
 * downstream we saw "Empty response from AI" on every call.
 *
 * This walks the array, keeps every text block's `text` field, and
 * joins them. Non-text blocks (thinking, tool_use, etc.) are ignored.
 */
function textFromResponse(response: { content?: unknown }): string {
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

/** The canonical set of sensitivity tags the classifier can suggest.
 *  Two groups: data-sensitivity categories (privacy/financial/security)
 *  and regulatory / export-control regimes (defense & government). The
 *  regulatory tags carry statutory handling obligations rather than a
 *  data-content category, so they're grouped separately in the UI.
 *  Deliberately compact — a longer list dilutes precision. Adding
 *  new tags means updating the prompt (SENSITIVITY_PROMPT_TAGS) too. */
export type SensitivityTag =
  | 'PII'
  | 'PHI'
  | 'PCI'
  | 'FINANCIAL'
  | 'CREDENTIAL'
  | 'CONFIDENTIAL'
  | 'PUBLIC'
  // Regulatory / export-control regimes
  | 'CUI'
  | 'ITAR'
  | 'EXPORT_CONTROLLED';

export const SENSITIVITY_TAGS: readonly SensitivityTag[] = [
  'PII', 'PHI', 'PCI', 'FINANCIAL', 'CREDENTIAL', 'CONFIDENTIAL', 'PUBLIC',
  'CUI', 'ITAR', 'EXPORT_CONTROLLED',
] as const;

/** Regulatory / export-control regimes — a subset of SENSITIVITY_TAGS that
 *  express a statutory handling regime (defense / government / export)
 *  rather than a data-content category. Grouped apart in the classifier
 *  prompt and the UI. */
export const REGULATORY_SENSITIVITY_TAGS: readonly SensitivityTag[] = [
  'CUI', 'ITAR', 'EXPORT_CONTROLLED',
] as const;

export interface SensitivitySuggestion {
  tag: SensitivityTag;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** One-sentence rationale so the reviewer can accept/reject with
   *  context. E.g. "columns include email, phone, and date_of_birth". */
  reason: string;
}

/** Everything the sensitivity classifier needs to see about an asset. */
export interface AssetSensitivityContext {
  name: string;
  description?: string;
  systemType?: string;
  columns?: Array<{ name: string; dataType?: string; description?: string }>;
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

/** One event emitted while streaming a template. `progress` is
 *  purely for the UI progress bar (chars received so far — token
 *  estimates lie about JSON's char/token ratio, so we ship the raw
 *  char count and let the client scale). `done` carries the parsed
 *  hierarchy — the same object shape the non-streaming call returned. */
export type TemplateStreamEvent =
  | { type: 'progress'; chars: number }
  | { type: 'done'; data: object };

export interface AiService {
  generateIndustryTemplate(industry: string, specialization?: IndustryTemplateSpecialization): Promise<object>;
  /** Streaming counterpart of generateIndustryTemplate(). Uses
   *  Anthropic's streaming API so we can (a) show real progress in
   *  the wizard instead of a fake spinner and (b) bump max_tokens
   *  above the non-streaming 16000-token ceiling for wider
   *  hierarchies without hitting request-timeout enforcement. Same
   *  prompt and grounding as the non-streaming variant — only the
   *  delivery shape differs. */
  generateIndustryTemplateStream(industry: string, specialization?: IndustryTemplateSpecialization): AsyncIterable<TemplateStreamEvent>;
  generateDataDomains(industry: string): Promise<object>;
  generateSubDomains(industry: string, parentName: string, parentDescription?: string): Promise<object>;
  suggestDataAssets(context: ProcessContext): Promise<object>;
  /** Suggest sensitivity tags (PII/PHI/PCI/FINANCIAL/CREDENTIAL/etc.)
   *  for a data asset based on its name, description, and column
   *  names/types. Returns an array of {tag, confidence, reason}
   *  objects. Conservative by prompt design — the model errs on
   *  the side of not-tagging when signal is weak. Persistence is a
   *  separate step so the user can review + accept individually. */
  suggestAssetSensitivity(asset: AssetSensitivityContext): Promise<SensitivitySuggestion[]>;
  chat(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): Promise<string>;
  /** Streaming counterpart of chat(). Yields text fragments as they
   *  arrive from the Anthropic stream so the UI can render the reply
   *  progressively instead of staring at "Thinking…" for several
   *  seconds. Same prompt and grounding as chat() — only the
   *  delivery shape differs. */
  chatStream(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): AsyncIterable<string>;
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
  /** Shared prompt builder for both the streaming and non-streaming
   *  hierarchy generators. Keeps the two delivery shapes byte-for-byte
   *  identical — any wording tweak has to land in one place, not two. */
  private buildTemplatePrompt(industry: string, specialization?: IndustryTemplateSpecialization): { system: string; user: string } {
    const user = specialization
      ? `Generate a standard process hierarchy for the "${industry}" industry, specialised for the **${specialization.orgName}** ${specialization.orgType || 'division'}${specialization.orgDescription ? ` (${specialization.orgDescription})` : ''}. The hierarchy should reflect the specific operations, terminology and processes of this sub-organization rather than the generic industry. Include value streams, processes, and activities.`
      : `Generate a standard process hierarchy for the "${industry}" industry. Include value streams, processes, and activities.`;
    const system = `You are a business process expert for the Procela platform. Generate a comprehensive process hierarchy for the specified industry.

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
      "purpose": "What this value stream accomplishes for the business and the tangible value or result it delivers (one or two sentences)",
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
- Focus on the most common, standard processes for the industry`;
    return { system, user };
  }

  async generateIndustryTemplate(industry: string, specialization?: IndustryTemplateSpecialization): Promise<object> {
    const { system, user } = this.buildTemplatePrompt(industry, specialization);
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      // See generateIndustryTemplateStream for the streaming path
      // that lets us go higher. This non-streaming call is kept for
      // callers that don't need progress events (tests, admin
      // regeneration scripts) and stays below the streaming-required
      // threshold — Anthropic rejects non-streaming above ~16K.
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = textFromResponse(response);
    return extractJson(text) as object;
  }

  /**
   * Streaming variant of generateIndustryTemplate. Yields progress
   * events (running char count) as text streams from Anthropic, then
   * a final `done` event with the parsed hierarchy. Because the call
   * uses the streaming API, max_tokens can safely go above the
   * ~16K non-streaming ceiling — we bump to 32K here for headroom on
   * unusually verbose hierarchies (large industries × specialisation
   * detail). If we ever see truncation at 32K we can push higher; the
   * streaming API has no request-timeout cap the way the sync one does.
   */
  async *generateIndustryTemplateStream(industry: string, specialization?: IndustryTemplateSpecialization): AsyncIterable<TemplateStreamEvent> {
    const { system, user } = this.buildTemplatePrompt(industry, specialization);
    const stream = getClient().messages.stream({
      model: getConfiguredModel(),
      max_tokens: 32000,
      system,
      messages: [{ role: 'user', content: user }],
    });

    let chars = 0;
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        chars += event.delta.text.length;
        yield { type: 'progress', chars };
      }
    }

    const finalMessage = await stream.finalMessage();
    const text = textFromResponse(finalMessage);
    const data = extractJson(text) as object;
    yield { type: 'done', data };
  }

  /**
   * Generate data-domain suggestions for a given industry. Returns an
   * array of { name, description } objects that the frontend previews
   * before committing.
   */
  async generateDataDomains(industry: string): Promise<object> {
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      // See generateIndustryTemplate for the max_tokens rationale.
      // Smaller here since domain suggestions are a flatter list.
      max_tokens: 8192,
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

    const text = textFromResponse(response);
    return extractJson(text) as object;
  }

  /**
   * Suggest sub-domains for one parent data domain — the second level of the
   * Domain → Sub-Domain hierarchy. Seeded with the parent's name + description
   * so, e.g., a "Manufacturing" domain yields Welding / Fabrication / Assembly.
   */
  async generateSubDomains(industry: string, parentName: string, parentDescription?: string): Promise<object> {
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      max_tokens: 4096,
      system: `You are a data governance expert for the Procela platform. Given an industry and a top-level data domain, suggest the sub-domains that break that domain down into more granular, separately-stewarded subject areas.

A sub-domain is the second level of the taxonomy — Data Domain → Sub-Domain. For example, a "Manufacturing" domain divides into sub-domains like "Welding", "Fabrication", "Assembly", "Outfitting"; a "Customer Data" domain divides into "Accounts", "Billing", "Service History".

Return ONLY a valid JSON array — no markdown, no code fences, no explanation:
[
  {
    "name": "Sub-Domain Name",
    "description": "1-2 sentence description of what data this sub-domain governs within the parent domain"
  }
]

Guidelines:
- Suggest 3-8 sub-domains that are standard for this domain in this industry
- Each sub-domain must be a distinct subject area WITHIN the parent domain — not a sibling of the parent, and not a restatement of it
- Use clear business language accessible to non-technical users
- Order from most foundational to most specialized
- Descriptions should explain scope within the parent domain`,
      messages: [
        {
          role: 'user',
          content: `Industry: "${industry}"\nParent data domain: "${parentName}"${parentDescription ? `\nParent description: ${parentDescription}` : ''}\n\nGenerate the sub-domains for this domain.`,
        },
      ],
    });

    const text = textFromResponse(response);
    return extractJson(text) as object;
  }

  /**
   * Suggest data assets that are likely relevant for a given process context.
   */
  async suggestDataAssets(context: ProcessContext): Promise<object> {
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      // See generateIndustryTemplate — headroom for JSON list
      // output that new-gen models render more verbosely.
      max_tokens: 8192,
      system:
        'You are a data governance expert. Given a process context, suggest data assets (tables, datasets, reports) that are likely consumed or produced by the process step. Return a JSON array of suggestions.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(context),
        },
      ],
    });

    const text = textFromResponse(response);
    return extractJson(text) as object;
  }

  /**
   * Classify an asset's sensitivity. Sends the asset's name,
   * description, system type, and column list to Claude and gets
   * back an array of {tag, confidence, reason} suggestions.
   *
   * Prompt is conservative: the model is instructed to only tag
   * when there's clear signal in the metadata, and to skip tags
   * rather than guess. False positives here are worse than false
   * negatives — a bad tag creates noise across every downstream
   * gap/coverage report; a missed tag just doesn't fire.
   *
   * The suggestions are not persisted here — the route layer
   * returns them for user review, and a separate PUT route
   * writes accepted tags to the asset.
   */
  async suggestAssetSensitivity(asset: AssetSensitivityContext): Promise<SensitivitySuggestion[]> {
    const columns = (asset.columns || []).slice(0, 100).map((c) => ({
      name: c.name,
      type: c.dataType || 'unknown',
      ...(c.description ? { description: c.description } : {}),
    }));
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      max_tokens: 4096,
      system: `You are a data privacy and compliance classifier. Given a data asset's metadata, decide which sensitivity tags apply.

Tags (only use these — exact spelling):
- PII         — personally identifiable information (name, email, phone, address, DOB, SSN, national id, etc.)
- PHI         — protected health information (medical records, diagnoses, provider names in a clinical context)
- PCI         — payment card industry data (card numbers, CVV, cardholder name in a payment context)
- FINANCIAL   — bank accounts, income, tax records, financial transactions (that aren't PCI)
- CREDENTIAL  — passwords, API keys, tokens, secrets, private keys
- CONFIDENTIAL— business confidential (unreleased plans, negotiations, competitive analysis) that isn't covered by another tag
- PUBLIC      — deliberately public/open data (e.g. published reference data, public catalog)
- CUI         — Controlled Unclassified Information subject to NARA CUI / DFARS 252.204-7012 (e.g. controlled technical data, procurement-sensitive, export-controlled markings, government contract data)
- ITAR        — technical data on the US Munitions List subject to ITAR export control (defense articles, munitions, weapons-system technical data)
- EXPORT_CONTROLLED — dual-use technical data subject to EAR / the Commerce Control List that is not ITAR

Rules:
- Be conservative. Only apply a tag when the metadata gives clear signal — a column named "email", a table called "patient_encounters", a description mentioning "credit card numbers", etc. If you can't tell, don't tag.
- Return only tags that apply. Assets can have zero tags. Do NOT invent new tags.
- Confidence:
    HIGH   — the metadata is unambiguous (e.g. "customer_ssn" column).
    MEDIUM — strong signal but requires inference (e.g. "customer_records" description in a CRM system).
    LOW    — weak signal, worth surfacing but the reviewer should probably reject.
- Reason: one short sentence naming the specific columns or phrases you keyed off. Never restate the tag definition.

Return ONLY a JSON array — no markdown, no code fences, no prose:
[
  { "tag": "PII", "confidence": "HIGH", "reason": "columns include email, phone, and date_of_birth" }
]

Return [] when no tag applies with any confidence.`,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            name: asset.name,
            ...(asset.description ? { description: asset.description } : {}),
            ...(asset.systemType ? { systemType: asset.systemType } : {}),
            ...(columns.length ? { columns } : {}),
          }),
        },
      ],
    });

    const text = textFromResponse(response);
    const raw = extractJson(text);
    if (!Array.isArray(raw)) return [];
    // Validate: keep only well-shaped entries with a known tag.
    const validTags = new Set<string>(SENSITIVITY_TAGS);
    const validConf = new Set(['HIGH', 'MEDIUM', 'LOW']);
    return (raw as any[])
      .filter((s) => s && typeof s === 'object' && typeof s.tag === 'string' && typeof s.reason === 'string' && typeof s.confidence === 'string')
      .filter((s) => validTags.has(s.tag) && validConf.has(s.confidence))
      .map((s) => ({ tag: s.tag as SensitivityTag, confidence: s.confidence as 'HIGH' | 'MEDIUM' | 'LOW', reason: s.reason }));
  }

  /**
   * Shared system-prompt builder for chat() and chatStream(). Keeps
   * the two delivery shapes in lockstep — fixing wording in one place
   * fixes it everywhere, and the navigation guidance below has to be
   * identical or streaming and non-streaming would give different
   * answers.
   */
  private buildChatSystemPrompt(orgContext: OrgContext, catalogSummary?: string): string {
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
    // Navigation guidance — when an answer is best resolved on a
    // specific page, point the user at it with a markdown link. The
    // frontend extracts these links from the streamed text and
    // renders them as clickable navigation chips. Use ONLY paths
    // from the list below — fabricated paths render as broken
    // navigation buttons.
    parts.push(
      'When your answer would benefit from showing the user a specific Procela page, '
      + 'include a markdown link to that page using the exact paths below. The frontend '
      + 'turns these links into "Open" buttons that navigate the user there.\n'
      + 'Valid pages:\n'
      + '  - Dashboard: /\n'
      + '  - Process Catalog: /processes\n'
      + '  - Process ↔ Data Map: /processes/data-map\n'
      + '  - Data Assets: /data-assets\n'
      + '  - Orphan (unmapped) Assets: /data-assets?mapping=unmapped\n'
      + '  - Systems: /systems\n'
      + '  - Data Domains: /data-domains\n'
      + '  - Data Quality: /data-quality\n'
      + '  - Mappings (audit view): /mappings\n'
      + '  - Gap Detection: /gap-detection\n'
      + '  - People: /people\n'
      + '  - Governance Roles: /dama-roles\n'
      + '  - Governance Groups: /governance-groups\n'
      + '  - Reports: /reports\n'
      + '  - Audit Log: /audit-log\n'
      + 'Format: [Page name](/path). Use sparingly — at most one navigation link per answer, '
      + 'placed at the end after the substantive content. Do not invent paths not on this list.',
    );
    parts.push(
      'Keep answers concise and actionable. Name specific processes, assets, and gaps rather '
        + 'than speaking generally. Do not fabricate.',
    );
    return parts.join('\n\n');
  }

  /**
   * Multi-turn conversational chat, grounded in the organization's
   * actual Procela data when a catalog summary is supplied.
   */
  async chat(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): Promise<string> {
    const response = await getClient().messages.create({
      model: getConfiguredModel(),
      max_tokens: 2048,
      system: this.buildChatSystemPrompt(orgContext, catalogSummary),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return textFromResponse(response);
  }

  /** Streaming variant of chat(). Yields each text delta from the
   *  Anthropic stream as it arrives. Same system prompt and grounding
   *  as chat(); the model output is identical, only the delivery
   *  shape differs (incremental chunks vs one final string). The
   *  caller is responsible for translating chunks to whatever wire
   *  format the client expects (SSE, WebSocket, plain HTTP chunked). */
  async *chatStream(messages: ChatMessage[], orgContext: OrgContext, catalogSummary?: string): AsyncIterable<string> {
    const stream = getClient().messages.stream({
      model: getConfiguredModel(),
      max_tokens: 2048,
      system: this.buildChatSystemPrompt(orgContext, catalogSummary),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
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
      model: getConfiguredModel(),
      max_tokens: 3000,
      system,
      messages: [{ role: 'user', content: lines.join('\n') }],
    });

    return textFromResponse(response);
  }
}

export const aiService: AiService = new AnthropicAiService();

// Internal helper exposed for unit tests. Not part of the public API.
export const _extractJsonForTests = extractJson;
