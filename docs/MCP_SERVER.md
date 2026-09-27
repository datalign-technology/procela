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

- **Read-first; writes are opt-in and gated separately.** The read tools mutate
  nothing. A small set of **write tools** (assign owner, set process status,
  create governance task) exists but is registered **only when
  `MCP_WRITE_ENABLED=true`** — a third gate on top of the two below. No
  row-level source data is ever exposed — only business metadata and context
  (the same thing the in-app AI assistant sees).
- **Just another authenticated consumer.** It reuses the backend's own
  identity (`jwt-signer`), tenant isolation (`enforceOrgScope` / org-tree
  scoping), RBAC floor (`lib/permissions`), and the hash-chained audit log. A
  read can never see more than a **Viewer** on the caller's org(s) could see
  in-app, and a write requires the same `*:write` permission the REST API
  requires — an agent inherits the acting user's role and is never an
  escalation path.
- **Two transports, one core.** The protocol layer is transport-agnostic; both
  transports build the identical tool set + resource:
  - **stdio** — a local process a desktop/agent client spawns (like the edge
    connector), authenticated once per process via `PROCELA_MCP_TOKEN`.
  - **Streamable-HTTP** — the hosted, multi-tenant surface: a single `POST /mcp`
    endpoint that authenticates **per request** via `Authorization: Bearer`, so
    one endpoint serves every tenant with no shared server-side state.

## Security model

| Control | How |
| --- | --- |
| **Two kill switches** | Starts only when `MCP_SERVER_ENABLED=true` **and** `AI_FEATURES_ENABLED != false`. An on-prem / FedRAMP "no external AI" deployment keeps it off via either. |
| **Third switch for writes** | The write tools register only when `MCP_WRITE_ENABLED=true` as well. Read-only exposure needs no write grant. |
| **Identity** | Authenticates a Procela bearer token (`PROCELA_MCP_TOKEN`), verified with the same `jwt-signer` the REST API uses. |
| **Tenant isolation** | Every tool resolves + authorizes its target org against the token user's accessible-org set; a cross-tenant / unknown org reads as **not-found** (never revealing another tenant's existence). |
| **RBAC floor** | A read tool asserts the caller's role carries the relevant `*:read` permission; a write tool asserts the matching `*:write`. |
| **Audit** | Every read is written to the hash-chained audit log (`entityType: McpTool`, `action: MCP_QUERY`); every **write** is logged with the **real** entity type/id and before/after state under an `MCP_*` action, before returning. Non-bypassable. |
| **Human-in-the-loop** | Write tools carry MCP annotations (`readOnlyHint: false`, `destructiveHint`, `idempotentHint`) so a client asks the operator to confirm before calling. |
| **Least privilege** | For read-only use, point it at a dedicated **Viewer**, org-restricted service token — never a shared admin token. A token used for writes carries exactly the `*:write` its role grants, nothing more. Rotate it like any credential. |

## Read tools

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

## Write tools (opt-in — `MCP_WRITE_ENABLED=true`)

Off unless the third switch is set. Each requires the acting role's `*:write`
permission, validates the change against the same rules the REST API enforces,
persists through the same repositories, and writes a before/after audit entry.

| Tool | Does | Permission |
| --- | --- | --- |
| `assign_owner` | Set the accountable owner of a process / asset / system / domain (owner must be a person in the org). | `process:write` / `data-asset:write` / `system:write` |
| `set_status` | Move a process node between the plain lifecycle states **Draft / Active / Deprecated**, honouring the org's status workflow. Review-workflow transitions (pending review, under review, approved) stay in the app. | `process:write` |
| `create_task` | Create a governance task (stewardship / review / remediation / …), optionally assigned and linked to a catalog object. Opens `OPEN`. | `governance:write` |

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

## Run it (hosted Streamable-HTTP transport)

The main backend mounts `POST /mcp` automatically when **both** gates pass
(`MCP_SERVER_ENABLED=true` and `AI_FEATURES_ENABLED != false`) — no separate
process. Point an MCP HTTP client at it and pass a per-caller Procela access
token as a bearer:

```jsonc
{
  "mcpServers": {
    "procela": {
      "url": "https://api.procela.io/mcp",
      "headers": { "Authorization": "Bearer <a Viewer-scoped Procela access token>" }
    }
  }
}
```

Wire behaviour:

| Request | Response |
| --- | --- |
| `POST /mcp` with a JSON-RPC message (has `id`) | `200 application/json` with the JSON-RPC response. A batch (array) request returns an array. |
| `POST /mcp` with only notifications (no `id`) | `202 Accepted`, empty body. |
| `POST /mcp` with a missing / malformed / invalid bearer token | `401` + `WWW-Authenticate: Bearer` (the reason is not leaked). |
| `GET /mcp` | `405` + `Allow: POST` — v1 has no server-initiated SSE stream. |
| `DELETE /mcp` | `204` — the transport is stateless (no `Mcp-Session-Id`), so teardown is a no-op. |

Each request is authenticated and authorized on its own (identity, tenant
isolation, RBAC floor, audit — all identical to stdio). The endpoint is
rate-limited **per principal** (the token subject; IP fallback) — see
`MCP_RATE_LIMIT_MAX` / `MCP_RATE_LIMIT_WINDOW_MS`.

## Environment variables

| Var | Meaning |
| --- | --- |
| `MCP_SERVER_ENABLED` | `true` to allow the server to start. Default off. |
| `AI_FEATURES_ENABLED` | `false` disables every external AI surface (MCP included), regardless of the above. |
| `PROCELA_MCP_TOKEN` | The bearer token the **stdio** server authenticates as. (The HTTP transport takes a per-request bearer instead.) |
| `MCP_RATE_LIMIT_MAX` | Max `POST /mcp` requests per principal per window (default 120). HTTP transport only. |
| `MCP_RATE_LIMIT_WINDOW_MS` | The rate-limit window in ms (default 60000). HTTP transport only. |
| `MCP_WRITE_ENABLED` | `true` also registers the write tools (assign owner, set status, create task). Default off — the read tools work without it. |

## Not yet (planned follow-ups)

- **Server-initiated SSE streaming** on the HTTP transport (`GET /mcp`). Every
  tool is request/response today, so `GET` answers `405`.
- **More write tools** — the current set covers ownership, process status, and
  task creation. Mapping edits, tier changes, and richer status workflows are
  future additions, each behind the same `*:write` RBAC + audit + confirmation.
