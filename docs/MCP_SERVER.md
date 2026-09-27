# Procela read-only MCP server (v1)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes Procela's **governed catalog** — processes, data assets, systems,
ownership, gaps, health, and governance scope — to external AI agents (Claude
Desktop, IDE assistants, internal copilots). It lets an agent answer *"what
process depends on this data, who owns it, and is it governed?"* without a
bespoke integration.

It is the first slice of the design in
[`MCP_SERVER_DESIGN.md`](./MCP_SERVER_DESIGN.md). **Read-only, off by default.**

## What it is (and isn't)

- **Read-only.** No tools mutate anything. No row-level source data is ever
  exposed — only business metadata and context (the same thing the in-app AI
  assistant sees).
- **Just another authenticated consumer.** It reuses the backend's own
  identity (`jwt-signer`), tenant isolation (`enforceOrgScope` / org-tree
  scoping), RBAC floor (`lib/permissions`), and the hash-chained audit log. It
  can never see more than a **Viewer** on the caller's org(s) could see in-app.
- **Transport:** stdio (a local process a desktop/agent client spawns, like the
  edge connector). A hosted Streamable-HTTP transport for multi-tenant SaaS is a
  planned follow-up.

## Security model

| Control | How |
| --- | --- |
| **Two kill switches** | Starts only when `MCP_SERVER_ENABLED=true` **and** `AI_FEATURES_ENABLED != false`. An on-prem / FedRAMP "no external AI" deployment keeps it off via either. |
| **Identity** | Authenticates a Procela bearer token (`PROCELA_MCP_TOKEN`), verified with the same `jwt-signer` the REST API uses. |
| **Tenant isolation** | Every tool resolves + authorizes its target org against the token user's accessible-org set; a cross-tenant / unknown org reads as **not-found** (never revealing another tenant's existence). |
| **RBAC floor** | Every tool asserts the caller's role carries the relevant `*:read` permission before returning data. |
| **Audit** | Every tool call is written to the hash-chained audit log (`entityType: McpTool`, `action: MCP_QUERY`) with actor + org + tool + args, before data is returned. Non-bypassable. |
| **Least privilege** | Point it at a dedicated **Viewer**, org-restricted service token — never a shared admin token. Rotate it like any credential. |

## Tools (v1)

| Tool | Returns |
| --- | --- |
| `list_value_streams` | The process hierarchy (value stream → process → activity) with statuses + owners. |
| `find_processes_using_asset` | Reverse lookup: activities (and their process/value-stream path) that depend on a data asset. |
| `get_owner` | Accountable owner + stewards of a process / asset / system / domain. |
| `list_gaps` | Unmapped activities, ownerless processes, ungoverned/orphan/low-health assets, ownerless domains. |
| `asset_health` | Governance tier + measured DQ health (null when unmeasured — never fabricated). |
| `governance_scope` | Governed set vs connected-but-not-governed, per the program scope (whole catalog when no scope is defined). |
| `search_catalog` | Name search across processes, assets, systems, and domains. |

Plus a `procela://<orgId>/catalog-summary` resource (entity counts).

## Run it

```bash
# Dev (tsx, no build):
MCP_SERVER_ENABLED=true PROCELA_MCP_TOKEN=<token> npm run mcp -w packages/backend

# Production (compiled):
MCP_SERVER_ENABLED=true PROCELA_MCP_TOKEN=<token> node packages/backend/dist/mcp/run.js
```

Example Claude Desktop / MCP client config:

```json
{
  "mcpServers": {
    "procela": {
      "command": "node",
      "args": ["/path/to/procela/packages/backend/dist/mcp/run.js"],
      "env": {
        "MCP_SERVER_ENABLED": "true",
        "PROCELA_MCP_TOKEN": "<a Viewer-scoped Procela access token>"
      }
    }
  }
}
```

The process speaks JSON-RPC over stdin/stdout; diagnostics go to stderr and
never corrupt the channel. On a disabled flag or missing/invalid token it logs
the reason and exits (78 = misconfigured, 77 = auth failed).

## Environment variables

| Var | Meaning |
| --- | --- |
| `MCP_SERVER_ENABLED` | `true` to allow the server to start. Default off. |
| `AI_FEATURES_ENABLED` | `false` disables every external AI surface (MCP included), regardless of the above. |
| `PROCELA_MCP_TOKEN` | The bearer token the server authenticates as. |

## Not in v1 (planned follow-ups)

- **Streamable-HTTP transport** for the hosted multi-tenant surface (per-request
  auth behind the gateway). v1 is stdio.
- **Per-principal rate limiting / quotas** (more relevant to the HTTP transport;
  a local stdio process is single-session).
- **Write tools** (ownership assignment, etc.) — a separately-hardened later
  phase with per-tool RBAC and human-in-the-loop confirmation.
