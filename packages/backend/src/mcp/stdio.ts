// ──────────────────────────────────────────────────────────────────────────
// stdio transport for the MCP server.
//
// MCP over stdio frames each JSON-RPC message as a single line of JSON on
// stdin/stdout (newline-delimited). This reads lines, dispatches them through
// an `McpServer`, and writes each non-null response back. Logging goes to
// stderr so it never corrupts the stdout JSON-RPC channel.
//
// v1 uses stdio (a local process a desktop/agent client spawns, matching how
// the edge connector is deployed on-prem). A Streamable-HTTP transport for the
// hosted multi-tenant surface is a planned follow-up (see
// docs/MCP_SERVER_DESIGN.md §5.2); the `McpServer` core is transport-agnostic.
// ──────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';
import type { JsonRpcRequest, McpServer } from './protocol';
import { RPC } from './protocol';

export interface StdioStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  log?: (msg: string) => void;
}

/** Run `server` over the given streams until the input closes. Resolves when
 *  the input stream ends (EOF), so callers can await a clean shutdown. */
export function runStdio(server: McpServer, streams: StdioStreams): Promise<void> {
  const { input, output } = streams;
  const log = streams.log ?? ((m: string) => process.stderr.write(`[procela-mcp] ${m}\n`));

  const write = (obj: unknown): void => {
    output.write(`${JSON.stringify(obj)}\n`);
  };

  return new Promise<void>((resolve) => {
    const rl = createInterface({ input, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: RPC.PARSE_ERROR, message: 'Parse error' } });
        return;
      }
      // Dispatch async; keep ordering-agnostic (clients correlate by id).
      void server.handle(req).then((res) => {
        if (res) write(res);
      }).catch((err) => {
        log(`handler error: ${err instanceof Error ? err.message : String(err)}`);
        if (req.id !== undefined && req.id !== null) {
          write({ jsonrpc: '2.0', id: req.id, error: { code: RPC.INTERNAL_ERROR, message: 'Internal error' } });
        }
      });
    });

    rl.on('close', () => resolve());
  });
}
