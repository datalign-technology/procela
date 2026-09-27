// ──────────────────────────────────────────────────────────────────────────
// Minimal, transport-agnostic MCP (Model Context Protocol) server core.
//
// This implements the read-only subset of MCP that Procela's server needs —
// `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`,
// `ping` — as plain JSON-RPC 2.0 message handling with no I/O and no external
// SDK. Each transport (stdio and Streamable-HTTP) feeds parsed request objects
// to `handle()` and ships the returned responses; the
// tool/resource handlers never touch the wire. Keeping the protocol layer
// dependency-free and pure keeps it fully unit-testable and lets the official
// `@modelcontextprotocol/sdk` be dropped in later without touching the tools.
//
// Spec references: JSON-RPC 2.0; MCP 2024-11-05 tools & resources.
// ──────────────────────────────────────────────────────────────────────────

/** Protocol version this server advertises in `initialize`. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// JSON-RPC error codes (standard + MCP conventions).
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** A JSON-Schema-ish object describing a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

/** Result content block — text is all a read-only governance server needs. */
export interface TextContent { type: 'text'; text: string }

export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Handler receives the raw `arguments` object; returns text content. Throwing
   *  an McpError yields a tool-level error result (isError), not a transport
   *  error, so an agent sees the message. */
  handler: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<string> | string;
}

/** A tool/handler-level error whose message is surfaced to the caller. */
export class McpError extends Error {
  constructor(message: string, readonly code: number = RPC.INTERNAL_ERROR) {
    super(message);
    this.name = 'McpError';
  }
}

export interface ServerInfo { name: string; version: string }

export class McpServer {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly resources = new Map<string, ResourceDefinition>();

  constructor(private readonly info: ServerInfo) {}

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerResource(resource: ResourceDefinition): void {
    this.resources.set(resource.uri, resource);
  }

  listToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Handle one JSON-RPC request. Returns a response, or `null` for a
   *  notification (no `id`), which takes no reply. Never throws. */
  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const isNotification = req.id === undefined || req.id === null;
    const reply = (body: Partial<JsonRpcResponse>): JsonRpcResponse | null =>
      isNotification ? null : { jsonrpc: '2.0', id: req.id ?? null, ...body } as JsonRpcResponse;

    try {
      switch (req.method) {
        case 'initialize':
          return reply({
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              serverInfo: this.info,
              capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false, subscribe: false },
              },
            },
          });

        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null; // client notifications — no response

        case 'ping':
          return reply({ result: {} });

        case 'tools/list':
          return reply({
            result: {
              tools: [...this.tools.values()].map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          });

        case 'tools/call': {
          const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
          const tool = params.name ? this.tools.get(params.name) : undefined;
          if (!tool) {
            return reply({ error: { code: RPC.METHOD_NOT_FOUND, message: `Unknown tool: ${params.name}` } });
          }
          try {
            const result = await tool.handler(params.arguments ?? {});
            return reply({ result });
          } catch (err) {
            // Tool-level failures come back as an error *result*, so the agent
            // sees the reason rather than a dropped connection.
            const message = err instanceof Error ? err.message : String(err);
            return reply({ result: { content: [{ type: 'text', text: message }], isError: true } as ToolResult });
          }
        }

        case 'resources/list':
          return reply({
            result: {
              resources: [...this.resources.values()].map((r) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
              })),
            },
          });

        case 'resources/read': {
          const params = (req.params ?? {}) as { uri?: string };
          const resource = params.uri ? this.resources.get(params.uri) : undefined;
          if (!resource) {
            return reply({ error: { code: RPC.INVALID_PARAMS, message: `Unknown resource: ${params.uri}` } });
          }
          try {
            const text = await resource.read();
            return reply({ result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] } });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply({ error: { code: RPC.INTERNAL_ERROR, message } });
          }
        }

        default:
          return reply({ error: { code: RPC.METHOD_NOT_FOUND, message: `Unknown method: ${req.method}` } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply({ error: { code: RPC.INTERNAL_ERROR, message } });
    }
  }
}

/** A small helper for building a text tool result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Serialize a value as pretty JSON inside a text result (the common case for
 *  a read-only data tool). */
export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
