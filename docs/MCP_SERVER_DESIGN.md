# Procela MCP Server — Design & Threat Model

**Status:** Draft / Proposed (not yet scheduled)
**Audience:** Engineering, Security, Product/GTM
**Scope of this doc:** the design and security model for exposing Procela's
governed context to external AI agents over the Model Context Protocol (MCP).
It is a decision document to react to before any code lands — it does **not**
authorize implementation.

---

## 1. TL;DR

Procela's value is the **business-context layer over data**: what process a
data asset supports, who owns it, whether it's governed, and where the gaps
are. That context is exactly what an enterprise's AI agents lack. An **MCP
server turns Procela into the governance-context provider for a customer's
whole agent fleet** — Claude Desktop, IDE assistants, internal copilots, and
the customer's own agents can ask Procela "what breaks if this asset is wrong,
and who do I call?" without a bespoke integration each time.

This is **not** a hard dependency — Procela sells and governs without it — but
it is an on-strategy, defensible capability that deepens the moat (a catalog
that feeds agents is infrastructure, not a silo).

**Recommendation:** build a **read-only v1**, reusing the read model the
in-app AI assistant already assembles, enforced by the **existing** JWT + org
scoping + RBAC + hash-chained audit, **off by default** and enabled per
tenant. Write tools are a later, separately-hardened phase.

---

## 2. Goals & non-goals

### Goals
- Expose Procela's governed catalog (processes, data assets, systems,
  ownership, gaps, data quality, governance scope) to MCP-capable clients as
  **read-only tools and resources**.
- Reuse existing services so the MCP surface can never diverge from the
  in-product truth or bypass its guarantees.
- Meet the **same enterprise bar** as the rest of the platform: SSO-derived
  identity, per-tenant isolation, RBAC, tamper-evident audit, rate limiting,
  a per-tenant kill switch, and on-prem/air-gapped operability.
- Be demoable and sellable **without being on for every tenant**.

### Non-goals (v1)
- **No write/mutation tools** (no "assign owner", "create process"). Deferred
  to a later phase with its own authorization and audit review.
- **No exposure of row-level source data.** Procela governs *metadata and
  business context*; the MCP server never becomes a data-egress path for the
  customer's actual records. (The edge connector's "credentials/rows stay
  on-prem" posture applies here too — see `packages/connector/README.md`.)
- **Not** a replacement for the REST API or the in-app assistant.
- **Not** Procela *consuming* external MCP servers — see §13, separate track.

---

## 3. Background

**MCP** (Model Context Protocol) is an open protocol for exposing **tools**
(callable functions), **resources** (readable context), and **prompts** to LLM
clients in a standard way, so any compliant client can use a server without a
custom integration. Two roles matter here:

- **Provider** (this doc): Procela runs a server; external agents consume it.
- **Consumer** (§13): Procela's assistant consumes other servers.

Procela already assembles almost exactly the payload a provider would expose:
`routes/chat.ts` builds a bounded, **read-only catalog snapshot** for the
assistant — process-catalog outline, systems, orphan/unmapped assets, live DQ
status, and a **Governance Scope** section (governed vs merely catalogued).
The MCP server is, in essence, that snapshot **re-shaped as typed tools** and
governed by the same tenancy rules, rather than flattened into one system
prompt.

---

## 4. Scope & phasing

| Phase | Contents | Gate to ship |
| --- | --- | --- |
| **v1 (this design)** | Read-only tools + resources; per-tenant opt-in; full auth/isolation/audit; rate limits; on-prem packaging | Security review of this doc + threat model sign-off |
| **v2** | Write tools (ownership assignment, status changes, task creation) with per-tool RBAC and mandatory audit; human-in-the-loop confirmation semantics. **Status (shipped):** `assign_owner`, `set_status`, `create_task` in `mcp/write-tools.ts`, gated on a third switch `MCP_WRITE_ENABLED`, each requiring the acting role's `*:write`, validated against the REST rules, persisted through the same repos, and audited before/after. MCP annotations (`destructiveHint` etc.) carry the human-in-the-loop signal. See `docs/MCP_SERVER.md`. | Separate authorization design + pen test |
| **v3** | Procela as MCP **consumer** (assistant reaches customer tools) | Separate design; not covered here |

Everything below is **v1** unless stated.

---

## 5. Architecture

### 5.1 Placement
A new workspace package, **`packages/mcp-server`**, that depends on the
backend's domain services (or a shared `packages/core` if we extract one). It
does **not** re-implement data access — it calls the same repositories,
`lib/tenant-scope`, `lib/governance-scope`, and the snapshot logic factored out
of `routes/chat.ts`. Refactor note: extract the chat snapshot builder into a
reusable `buildCatalogView(orgScope)` service so both the assistant and the MCP
server share one code path (and one test surface).

### 5.2 Transport
- **SaaS / multi-tenant:** **Streamable HTTP** transport, mounted behind the
  same ALB/gateway as the API (e.g. `/mcp`), so it inherits TLS, WAF, and
  network policy. **stdio transport is not used for multi-tenant SaaS** — it
  implies a local, single-user process and has no place in a shared hosted
  surface. **Status (shipped):** `POST /mcp` is live (`mcp/http.ts`,
  `dispatchHttp` + `mcpHttpRouter`), mounted in `index.ts` behind the two
  kill-switches with a per-principal rate limiter, authenticating a bearer
  token per request. `GET` (server-initiated SSE) returns `405` — every v1 tool
  is request/response. See `docs/MCP_SERVER.md`.
- **On-prem:** the same server in the same container image, pointed at the
  customer's own IdP and network — consistent with Procela's
  deployment-flexibility principle. A single-tenant on-prem install *may*
  additionally offer a local stdio bridge for a desktop client on the same
  trusted host, but that is opt-in and out of scope for v1.

### 5.3 Reuse map (no new privileged paths)
| Concern | Reused module |
| --- | --- |
| Identity / token verification | `services/jwt-signer` (+ JWKS at `/api/v1/auth/jwks.json`) |
| Org scoping / tenant isolation | `middleware/auth.ts#enforceOrgScope`, `lib/tenant-scope` (`scopeListForRequest`, `assertOrgAccess`) |
| Governed-vs-catalogued boundary | `lib/governance-scope` (`resolveProgramScope`) |
| Read model | snapshot logic factored from `routes/chat.ts` |
| Feature kill switch | `middleware/ai-enabled.ts` (`AI_FEATURES_ENABLED`) |
| Rate limiting / quotas | `middleware/rate-limit.ts`, `middleware/ai-budget.ts` |
| Audit | `services/audit.service.ts` (hash-chained log) |

The design principle: **the MCP server is just another authenticated API
consumer.** It introduces no data path that the REST API doesn't already have,
and no way to see anything a `Viewer` in that org couldn't already see.

---

## 6. Tool & resource surface (v1, read-only)

Tools return governed **business context**, never raw records. Every tool is
implicitly scoped to the caller's authorized org set; an `orgId` argument is
validated by `enforceOrgScope` exactly as on the REST API.

**Tools**
- `list_value_streams(orgId?)` — the process hierarchy (value stream → process
  → activity), statuses, owners.
- `find_processes_using_asset(assetId | assetName)` — reverse lookup: which
  processes/activities depend on a data asset. *(The "what breaks if this is
  wrong?" question.)*
- `get_owner(entityType, entityId)` — accountable owner / steward for a
  process, asset, system, or domain.
- `list_gaps(orgId?, kind?)` — unmapped activities, ungoverned/low-tier
  assets, ownership gaps, orphan assets — the Gap Detection view, honoring the
  All / In-scope lens.
- `asset_health(assetId)` — governance tier + measured DQ status (or "not
  measured", never a fabricated score — mirrors the assistant's rule).
- `whats_in_scope(orgId?)` / `whats_ungoverned(orgId?)` — the governance-scope
  boundary (governed set vs connected-but-not-governed).
- `lineage_for(assetId)` — captured lineage where present.
- `search_catalog(query, types?)` — visibility-aware search across the
  governed catalog.

**Resources** (stable, addressable read context an agent can subscribe to)
- `procela://{orgId}/catalog-summary` — the bounded snapshot (same content the
  assistant uses), for agents that want context rather than a specific query.
- `procela://{orgId}/gaps` and `procela://{orgId}/scorecard` — periodically
  refreshed governance posture.

**Prompts** (optional) — a couple of canned, org-grounded prompts
("Summarize this org's top governance risks") to give thin clients a starting
point.

Tool schemas are **versioned** (see §11) so we can evolve them without breaking
a customer's deployed agents.

---

## 7. AuthN / AuthZ & tenant isolation (the load-bearing section)

Tenant isolation is the whole game: **a governance product leaking one
tenant's context to another over a new surface is an existential failure.**

- **Authentication.** The MCP server accepts a bearer token verified through
  the existing `services/jwt-signer` (RS256/HS256 per boot config), the same
  tokens the REST API accepts, published via JWKS. We align the client
  handshake to the **current MCP Authorization spec** (OAuth 2.1
  authorization-code + PKCE for interactive clients; client-credentials for
  service agents), brokered by the customer's IdP (Cognito/Azure AD/Okta/SAML
  via the existing `AuthService` abstraction). **No new, weaker auth path.**
- **Authorization / scoping.** Every tool call runs through the same
  `enforceOrgScope` logic: any `orgId` the call supplies is validated against
  the caller's accessible-org set (`people.getVisibleOrgIds`); a non-super-admin
  reaching outside its tree gets denied *before* a handler runs. Tools that
  don't take an `orgId` operate over the caller's authorized set only.
- **RBAC floor.** v1 tools require at least **Viewer** on the target org; the
  server never returns more than that role can see in-app. When an agent acts
  on behalf of a user, it inherits **that user's** role — an agent cannot be a
  privilege-escalation shortcut. (See `docs/RBAC_PERMISSION_MATRIX.md`; the MCP
  surface is added to that matrix as part of this work.)
- **Least privilege for service agents.** A headless agent authenticates as a
  dedicated **service principal** with a **Viewer-scoped, org-restricted**
  grant — never a shared admin token. Grants are revocable and rotate like any
  other credential.

---

## 8. Audit

Every MCP tool call is written to the **existing hash-chained audit log**
(`services/audit.service.ts`) with actor (user or service principal), org,
tool, arguments, and outcome — tamper-evident and exportable, because
enterprise security teams **will** ask *"what did the agent read, on whose
authority, and when?"* Audit is **mandatory and non-bypassable**: a tool call
that cannot be audited is refused, not silently served. Read-heavy agent
traffic is high-volume, so entries use the existing async queue
(`persistAuditEntryWithRetry` / `flushAuditQueue`) and we add MCP-specific
audit-query filters for reviewers.

---

## 9. Enablement & configuration

- **Off by default.** The MCP surface is disabled unless explicitly enabled.
- **Per-tenant opt-in.** An **Org Admin** enables it for their org (a Settings
  toggle + a generated service-principal grant), so it's a **sold,
  configurable feature**, not a global switch.
- **Deployment kill switches.** Honors `AI_FEATURES_ENABLED=false` (the
  `requireAiEnabled` gate) and a new deployment flag
  `MCP_SERVER_ENABLED=false` — so a FedRAMP / air-gapped / "no external AI
  surface" deployment can refuse the whole surface at the edge, independent of
  per-tenant settings. Both gates must pass.
- **Config via env** (12-factor, no hardcoded values): `MCP_SERVER_ENABLED`,
  bind path/port, per-tenant allowlist source, rate-limit/quota knobs.

---

## 10. Non-functional requirements

- **Rate limiting & quotas.** Reuse `middleware/rate-limit.ts` and the
  `ai-budget` accounting; agents can be chatty, so per-principal and per-tenant
  ceilings are required to protect the shared tier and to bound cost.
- **Response bounding.** Tool outputs are size-capped (as the assistant
  snapshot already truncates long catalogs) to prevent unbounded payloads.
- **Schema versioning.** Tool/resource schemas carry a version; breaking
  changes ship a new version while the prior one is supported for a deprecation
  window, so a customer's deployed agents don't break under them.
- **Observability.** Structured logs + metrics per tool (latency, error rate,
  denials), and alerting on anomalous cross-org denial spikes (a probing
  signal).
- **Error model.** Stable, branchable error codes mirroring the API
  (`AI_DISABLED`, `MCP_DISABLED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`),
  and errors never leak another tenant's existence (a forbidden asset id reads
  as not-found, not "exists but denied").

---

## 11. Threat model

**Trust boundary:** an external, semi-trusted AI client on the far side of the
MCP endpoint, driven by an LLM that may be steered by untrusted input (the
"confused deputy" risk). Everything the server returns may end up in a model's
context and influence downstream actions.

| # | Threat | Vector | Mitigation |
| --- | --- | --- | --- |
| T1 | **Cross-tenant data disclosure** | Agent supplies another org's id, or a bug omits scoping | Mandatory `enforceOrgScope` on every call; default-deny; forbidden ⇒ *not-found*; automated cross-tenant isolation tests as a release gate |
| T2 | **Privilege escalation via agent** | Agent token carries more than the acting user | Agent inherits the user's role; service principals are Viewer-scoped, org-restricted; no shared admin tokens |
| T3 | **Token / credential theft** | Leaked bearer token or service grant | Short-lived tokens; revocable + rotating grants; JWKS-verified; no long-lived secrets in tool args; TLS-only |
| T4 | **Prompt injection via returned content** | Malicious text stored in a catalog field (asset description, etc.) returned to a model that then acts on it | Treat all catalog text as **data, not instructions**; the server never executes returned content; document to customers that tool output is untrusted; v1 is read-only so blast radius is disclosure, not action |
| T5 | **Data exfiltration at scale** | Agent enumerates the whole catalog rapidly | Per-principal rate limits + quotas; response bounding; audit + anomaly alerting; (metadata only — no row data ever crosses, capping the worst case) |
| T6 | **Denial of service** | Flood of expensive tool calls | Rate limiting, quotas, timeouts, and payload caps; MCP traffic isolated from the interactive API tier so it can't starve the UI |
| T7 | **Audit gaps / repudiation** | Calls not logged, or log tampered | Non-bypassable audit; a call that can't be audited is refused; hash-chained, tamper-evident, exportable log |
| T8 | **Confused-deputy write (future)** | An agent tricked into a mutation | v1 has **no writes**; v2 writes require per-tool RBAC + explicit human-in-the-loop confirmation + mandatory audit |
| T9 | **Surface enabled where prohibited** | External AI surface active in an air-gapped/FedRAMP install | Two independent kill switches (`MCP_SERVER_ENABLED`, `AI_FEATURES_ENABLED`), both default-safe; documented for procurement |

---

## 12. Packaging & deployment

- Ships in the **same container image**; the MCP process runs alongside (or as
  a sibling to) the API, behind the same gateway, TLS, and network policy.
- **On-prem:** points at the customer's own IdP and stays inside their network;
  no dependency on any Procela-hosted service. Same containers, customer
  infrastructure — the platform's standing deployment principle.
- **Network posture:** outbound is not required of the server; it's an inbound
  authenticated surface, off unless enabled, and carveable out entirely by the
  kill switch for the strictest deployments.

---

## 13. Related but out of scope — Procela as MCP *consumer*

Letting Procela's **own** assistant reach a customer's tools/source systems via
MCP is a separate track. Procela already reaches source systems through its
connector architecture (direct-connect + the on-prem edge connector), so this
is an *additional adapter*, not a gap. It has a different threat model
(Procela's assistant consuming untrusted external tools) and is not part of
this design.

---

## 14. Open questions / decisions needed

1. **Package boundary** — extract a shared `packages/core` for the read model,
   or have `packages/mcp-server` depend on `packages/backend`? (Prefer
   extracting `buildCatalogView` at minimum.)
2. **Interactive vs service-agent auth** — support both from v1, or ship
   service-principal (client-credentials) first and add interactive OAuth once
   the MCP client-auth ecosystem settles?
3. **Pricing / packaging** — is the MCP surface a tier feature, an add-on, or
   included? (GTM decision; affects the per-tenant enablement UX.)
4. **Resource subscriptions** — support MCP resource change-notifications in
   v1, or poll-only to start?
5. **Rate-limit defaults** — starting ceilings per principal / per tenant.

---

## 15. Alternatives considered

- **REST/OpenAPI only (status quo).** Works, but every agent integration is
  bespoke; loses the "any compliant client, zero integration" leverage that
  makes this strategic.
- **A custom "agent API".** Reinvents MCP without the ecosystem — more work,
  less reach.
- **Do nothing.** Viable near-term; the risk is being the RFP checkbox we lose
  in 12–18 months as buyers standardize on agent-queryable governance context.

---

## 16. Success criteria

- A third-party MCP client (e.g. Claude Desktop) can, against a demo tenant,
  answer "what processes depend on asset X and who owns it?" with **no bespoke
  integration** — and **cannot** see another tenant's anything.
- Every call is in the exportable audit log.
- The surface is off by default, enabled per tenant, and refused entirely under
  the deployment kill switch.
- Isolation tests (cross-tenant, role-floor) run as a release gate.
