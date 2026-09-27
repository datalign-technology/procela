// ──────────────────────────────────────────────────────────────────────────
// Assemble the Procela read-only MCP server for an authenticated caller:
// verify the token → build a Session → register the read-only tools and a
// catalog-summary resource, all wired to the real repo-backed catalog loader
// and governance-scope resolver.
// ──────────────────────────────────────────────────────────────────────────

import { McpServer } from './protocol';
import { createSession } from './identity';
import { buildTools } from './tools';
import { loadOrgCatalog, resolveOrgScope } from './catalog';

export const SERVER_INFO = { name: 'procela-governance', version: '1.0.0' };

/** Build a fully-wired MCP server for a bearer token. Throws if the token is
 *  invalid (surfaced by the caller as an auth failure). */
export function buildMcpServer(token: string): McpServer {
  const session = createSession(token);
  const server = new McpServer(SERVER_INFO);

  for (const tool of buildTools({ session, loadCatalog: loadOrgCatalog, resolveScope: resolveOrgScope })) {
    server.registerTool(tool);
  }

  server.registerResource({
    uri: `procela://${session.defaultOrgId}/catalog-summary`,
    name: 'Catalog summary',
    description: 'Counts of value streams, processes, activities, data assets, systems and domains for your organization.',
    mimeType: 'application/json',
    read: async () => {
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
