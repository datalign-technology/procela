// ──────────────────────────────────────────────────────────────────────────
// Entry point for the Procela read-only MCP server (stdio transport).
//
// Run as: `PROCELA_MCP_TOKEN=<bearer> MCP_SERVER_ENABLED=true node dist/mcp/run.js`
// (or `npm run mcp -w packages/backend` in dev). A desktop / agent MCP client
// spawns this and talks JSON-RPC over stdin/stdout. Diagnostics go to stderr.
//
// Two independent gates must pass or the process refuses to serve:
//   • MCP_SERVER_ENABLED=true   (opt-in; off by default)
//   • AI_FEATURES_ENABLED != false  (the deployment-wide external-AI kill switch)
// See docs/MCP_SERVER.md.
// ──────────────────────────────────────────────────────────────────────────

import config from '../config';
import { buildMcpServer } from './server';
import { runStdio } from './stdio';

const log = (m: string): void => { process.stderr.write(`[procela-mcp] ${m}\n`); };

// Exit codes: 78 = unavailable/misconfigured (EX_UNAVAILABLE), 77 = permission
// denied (EX_NOPERM) — chosen so a supervisor can tell "off" from "bad token".
export async function main(): Promise<number> {
  if (!config.mcpServerEnabled) {
    log('refusing to start: MCP_SERVER_ENABLED is not "true".');
    return 78;
  }
  if (!config.aiFeaturesEnabled) {
    log('refusing to start: AI_FEATURES_ENABLED=false disables every external AI surface, MCP included.');
    return 78;
  }
  const token = (process.env.PROCELA_MCP_TOKEN || '').trim();
  if (!token) {
    log('refusing to start: no PROCELA_MCP_TOKEN provided.');
    return 78;
  }

  let server;
  try {
    server = await buildMcpServer(token);
  } catch (err) {
    log(`authentication failed: ${err instanceof Error ? err.message : String(err)}`);
    return 77;
  }

  log(`ready — read-only tools: ${server.listToolNames().join(', ')}`);
  await runStdio(server, { input: process.stdin, output: process.stdout, log });
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { if (code) process.exit(code); })
    .catch((err) => { log(`fatal: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
}
