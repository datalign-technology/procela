// ──────────────────────────────────────────────────────────────────────────
// Assemble the Procela read-only MCP server for an authenticated caller:
// verify the token → build a Session → register the read-only tools and a
// catalog-summary resource, all wired to the real repo-backed catalog loader
// and governance-scope resolver.
// ──────────────────────────────────────────────────────────────────────────

import { McpServer } from './protocol';
import { createSession } from './identity';
import type { Session } from './identity';
import { buildTools } from './tools';
import { buildWriteTools } from './write-tools';
import { loadOrgCatalog, resolveOrgScope } from './catalog';
import { updateEntityOwner, updateNodeStatus, createGovernanceTask, statusModeOf } from './mutations';
import config from '../config';

export const SERVER_INFO = { name: 'procela-governance', version: '1.0.0' };

/** Build a fully-wired MCP server for a bearer token. Throws if the token is
 *  invalid (surfaced by the caller as an auth failure). Used by the stdio
 *  transport, which authenticates once per process. */
export function buildMcpServer(token: string): McpServer {
  return buildMcpServerForSession(createSession(token));
}

/** Build a fully-wired MCP server for an already-authenticated session. The
 *  Streamable-HTTP transport authenticates per request and reuses this so the
 *  wiring (tools + catalog-summary resource) is identical across transports. */
export function buildMcpServerForSession(session: Session): McpServer {
  const server = new McpServer(SERVER_INFO);

  // Read tools — tagged read-only so a client never prompts for confirmation.
  for (const tool of buildTools({ session, loadCatalog: loadOrgCatalog, resolveScope: resolveOrgScope })) {
    server.registerTool({ ...tool, annotations: { ...tool.annotations, readOnlyHint: true } });
  }

  // Write tools — registered only when the extra MCP_WRITE_ENABLED gate is on
  // (on top of the server's two switches). Each already carries its own
  // destructive / idempotent annotations for the client's human-in-the-loop.
  if (config.mcpWriteEnabled) {
    for (const tool of buildWriteTools({
      session,
      loadCatalog: loadOrgCatalog,
      updateEntityOwner,
      updateNodeStatus,
      createTask: createGovernanceTask,
      statusModeOf,
    })) {
      server.registerTool(tool);
    }
  }

  server.registerResource({
    uri: `procela://${session.defaultOrgId}/catalog-summary`,
    name: 'Catalog summary',
    description: 'Counts of value streams, processes, activities, data assets, systems and domains for your organization.',
    mimeType: 'application/json',
    read: async () => {
      session.assertMcpEnabled(session.defaultOrgId);
      const cat = await loadOrgCatalog(session.defaultOrgId);
      session.audit(session.defaultOrgId, 'resource:catalog-summary', {});
      const count = (lvl: string) => cat.nodes.filter((n) => n.level === lvl).length;
      return JSON.stringify({
        orgId: cat.orgId,
        valueStreams: count('VALUE_STREAM'),
        processes: count('PROCESS'),
        activities: count('ACTIVITY'),
        dataAssets: cat.assets.length,
        systems: cat.systems.length,
        domains: cat.domains.length,
      }, null, 2);
    },
  });

  return server;
}
