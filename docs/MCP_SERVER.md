# Procela MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that turns
Procela into the **governance-context provider for a customer's whole agent
fleet**. It exposes Procela's **governed catalog** — processes, data assets,
systems, ownership, gaps, health, and governance scope — to external AI agents
(Claude Desktop, IDE assistants, internal copilots) so an agent can answer
*"what process depends on this data, who owns it, and is it governed?"* — and,
where explicitly allowed, make audited changes — without a bespoke integration.

This is the operator + integrator guide. The design rationale and threat model
live in [`MCP_SERVER_DESIGN.md`](./MCP_SERVER_DESIGN.md); the role→permission
mapping is in [`RBAC_PERMISSION_MATRIX.md`](./RBAC_PERMISSION_MATRIX.md).

## What shipped

The full surface is built and off by default at every layer:

- **Read tools + a catalog-summary resource** — the governed catalog as typed
  queries (never row-level source data).
- **Write tools** (opt-in) — assign owner, set process status, create task —
  each RBAC-gated, validated like the REST API, and audited before/after.
- **Two transports** — hosted **Streamable-HTTP** (`POST /mcp`, per-request
  auth, multi-tenant) and local **stdio** (a spawned process, on-prem/desktop).
- **Per-tenant enablement** — an org admin opts their tenant in before its
  context is reachable, on top of the deployment kill switches.
- **Service-principal tokens** — revocable, org-scoped, role-capped bearers an
  admin mints in-app, one per agent, instead of a shared credential.

### End-to-end setup (hosted / SaaS)

1. **Operator** enables the surface for the deployment: `MCP_SERVER_ENABLED=true`
   (and keep `AI_FEATURES_ENABLED` on). Add `MCP_WRITE_ENABLED=true` only if
   agents should be allowed to make changes.
2. **Org admin** opts their tenant in at **Settings → Integrations → Agent
   access (MCP)** and mints a **service token** there (label + Viewer/Editor
   role) — copied once.
3. **Integrator** points an MCP client at `POST https://<host>/mcp` with
   `Authorization: Bearer <that token>`.

All three gates must pass; any one flips the surface (or writes) off.

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
| **Per-tenant opt-in** | On top of the deployment switches, an org must set `mcpEnabled` before its governed context is reachable — resolved up the org tree, **off by default**. An org admin toggles it in **Settings → Integrations → Agent access (MCP)**. Every tool call asserts it after resolving the org; a tenant that hasn't opted in gets a clear "not enabled" error. |
| **Identity** | Authenticates a Procela bearer token (`PROCELA_MCP_TOKEN`), verified with the same `jwt-signer` the REST API uses. |
| **Tenant isolation** | Every tool resolves + authorizes its target org against the token user's accessible-org set; a cross-tenant / unknown org reads as **not-found** (never revealing another tenant's existence). |
| **RBAC floor** | A read tool asserts the caller's role carries the relevant `*:read` permission; a write tool asserts the matching `*:write`. |
| **Audit** | Every read is written to the hash-chained audit log (`entityType: McpTool`, `action: MCP_QUERY`); every **write** is logged with the **real** entity type/id and before/after state under an `MCP_*` action, before returning. Non-bypassable. |
| **Human-in-the-loop** | Write tools carry MCP annotations (`readOnlyHint: false`, `destructiveHint`, `idempotentHint`) so a client asks the operator to confirm before calling. |
| **Service tokens** | Agents authenticate as a **service principal** — a revocable, org-scoped, role-capped grant an org admin mints in-app (Settings → Integrations → Agent access), never a shared admin token. It is looked up on every call and a revoked one is refused; it is confined to its grant org's subtree and can never reach a sibling tenant (unlike a human token, a synthetic identity is scoped explicitly, not via the email→person path). |
| **Least privilege** | A service token is capped to **Viewer** (read-only) or **Editor** (adds writes, still gated by `MCP_WRITE_ENABLED`) — never an admin role. It carries exactly the `*:read`/`*:write` its role grants. Give each agent its own token and revoke like any credential. |

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
      "headers": { "Authorization": "Bearer <a service token from Settings → Integrations → Agent access>" }
    }
  }
}
```

**Getting a token.** An org admin mints one at **Settings → Integrations →
Agent access (MCP) → Service tokens**: pick a label and a role (Viewer or
Editor), and copy the token — it is shown once and never stored. Each token is
a long-lived bearer scoped to that org (and its divisions) and capped to the
chosen role. Revoke any token from the same panel; a revoked token stops
authenticating immediately. Behind the API this is `POST/GET/DELETE
/api/v1/service-principals` (admin-gated, audited); the token is a JWT with
`type: "service"` whose `sub` is the grant id, and `mcp/identity.ts` checks the
grant on every call.

Wire behaviour:

| Request | Response |
| --- | --- |
| `POST /mcp` with a JSON-RPC message (has `id`) | `200 application/json` with the JSON-RPC response. A batch (array) request returns an array. |
| `POST /mcp` with only notifications (no `id`) | `202 Accepted`, empty body. |
| `POST /mcp` with a missing / malformed / invalid bearer token | `401` + `WWW-Authenticate: Bearer` (the reason is not leaked). |
| `GET /mcp` | `405` + `Allow: POST` — there is no server-initiated SSE stream (every tool is request/response). |
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
| `MCP_SERVICE_TOKEN_TTL` | Lifetime of a minted service token — a duration string (`365d`, `90d`, `12h`) or bare seconds. Default `365d`. Revocation is immediate regardless; this just bounds a leaked/lost token. |

Per-tenant enablement (`mcpEnabled`) is org configuration, not an env var — an
org admin sets it in the app, and it resolves up the org tree.

## Not yet (planned follow-ups)

- **Server-initiated SSE streaming** on the HTTP transport (`GET /mcp`). Every
  tool is request/response today, so `GET` answers `405`.
- **More write tools** — the current set covers ownership, process status, and
  task creation. Mapping edits, tier changes, and richer status workflows are
  future additions, each behind the same `*:write` RBAC + audit + confirmation.
