# RBAC Permission Matrix

Authoritative reference for Procela's role-based authorization. The
code in `packages/backend/src/lib/permissions.ts` is the source of
truth; this document explains it.

> **Note on an earlier draft.** A first cut of this matrix used a
> six-role CRUD model (`PROCESS_OWNER` / `DATA_STEWARD` as separate
> roles, per-operation create/edit/delete, per-record "assigned"
> scoping). The shipped code uses a **five-role, read/write** model:
> `PROCESS_OWNER` and `DATA_STEWARD` were merged into **`EDITOR`**, and
> the permission catalog distinguishes only `read` vs `write` per
> resource — not create/edit/delete. This document matches the code.
> Per-record "assigned" scoping is a **layer-2** concern (see below),
> now enforced for the process catalog.

## Roles

| Role | Meaning |
|---|---|
| `SUPER_ADMIN` | Full platform access, all orgs. Wildcard `*`. |
| `ORG_ADMIN` | Full write within their org: catalog, data, governance, people, agents, audit, admin. |
| `EDITOR` | Merged former Process Owner + Data Steward. Full write over the process catalog and the data/system registry (incl. connections). No governance/people/org writes. |
| `CONTRIBUTOR` | Authors processes and collaborates (comments). Reads the rest; does not write the data registry, mappings, or governance. |
| `VIEWER` | Read-only across the catalog. |

Every role is **org-scoped**: `authenticateToken` validates any
supplied `orgId` against the caller's accessible-org set before a
handler runs (`middleware/auth.ts`), so nothing here crosses `org_id`
(`SUPER_ADMIN` excepted).

## Permission model

Permissions are `resource:action` strings with wildcard support
(`*`, `resource:*`, exact). `action` is only ever **`read`** or
**`write`** — `write` covers create, update, and delete. Reads are
kept open to every authenticated user so the catalog stays browsable;
**enforcement gates writes**, plus a few sensitive read surfaces.

## Matrix

Legend: **W** = read + write · **R** = read only · **—** = no access

| Resource bucket | Routers | VIEWER | CONTRIBUTOR | EDITOR | ORG_ADMIN | SUPER_ADMIN |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `process` | process-catalog, sops, operations-manuals | R | **W** | **W** | W | W |
| `data-asset` | data-assets, data-domains, data-lineage, data-quality, business-glossary | R | R | **W** | W | W |
| `system` | systems | R | R | **W** | W | W |
| `mapping` | mappings | R | R | **W** | W | W |
| `connection` | connections, sync-connections, dbt-cloud-connections | R | R | **W** | W | W |
| `governance` | governance-{groups,policies,controls,tasks,issues,program,calendar}, dama-roles, decision-rights, control-tower | R | R | R | **W** | W |
| `collaboration` | comments, tags, attachments | R | **W** | W | W | W |
| `org` | organizations | R | R | R | **W** | W |
| `people` | people | R | R | R | **W** | W |
| `agent` | agents, agent-executions, agent-schedules | — | — | — | **W** | W |
| `audit` | audit | — | — | — | **R** | R |
| `admin` | admin | — | — | — | **W** | W |
| `backup` | backup | — | — | — | — | **W** |

### Any-authenticated (no role gate)

These mounts require a valid token but no specific permission —
dashboards, search, the AI assistant, exports, and per-user surfaces
where every write is scoped to the caller's own records:

`dashboard`, `ai`, `chat`, `search`, `exports`, `digest`,
`notifications`, `saved-views`, `trends`, `maturity-trends`,
`enterprise-view`, `analysis`, `analysis-reports`, `gap-detection`,
`skills`, `data-model`, `reports`.

### Self-authenticating (own scheme, untouched)

`support` (self-applies auth + rate limit), `connectors` (accepts
either a user JWT or a `pct_…` connector token), `branding` (public
GET for the login theme; writes self-check auth), `scim` (static
bearer token).

## Enforcement — layer 1 (this change)

A single mount-level guard, `requireResource('<bucket>')` in
`lib/permissions.ts`, applied once per router in `index.ts`:

- It maps the HTTP method to an action — `GET`/`HEAD`/`OPTIONS` →
  `read`, everything else → `write` — and calls `hasPermission`.
- This closes the "any authenticated user can write" hole uniformly
  across ~240 write endpoints without editing each handler.
- The mount table in `index.ts` **is** the reviewable policy surface —
  one line per router.

Consequences worth knowing:

- **Read-like `POST`s** (AI `generate-template`, `suggest-sensitivity`,
  `auto-discover`, `discover`, `generate`) count as **writes** and
  require the bucket's write permission. That is intended: they are
  authoring/mutating aids and are correctly denied to `VIEWER`.
- **Connectivity reads are open** to any authenticated user for now;
  only writes are gated. If connection responses can expose secrets,
  tightening reads to `EDITOR+` is a follow-up (add `connection:read`
  to elevated roles only).
- **`data-model`** (reference schema, read cross-cutting) is left
  any-authenticated to avoid breaking the many UI surfaces that read
  it; revisit if it grows sensitive writes.

## Enforcement — layer 2 (per-record "assigned" scoping)

Layer 1 decides whether a role may write a *resource*. Layer 2 refines
that for roles whose write scope is limited to records they are
assigned to — today just **`CONTRIBUTOR`**. `EDITOR` / `ORG_ADMIN` /
`SUPER_ADMIN` have org-wide write and are exempt.

`lib/assignment.ts` provides the reusable predicate:

- `isAssignedTo(user, record)` — true when `user.sub` matches any of a
  record's assignment fields (`ownerId`, `stewardId`, `assigneeId`,
  `responsiblePersonId`, `createdBy`). A JWT's `sub` **is** the person
  id (`routes/auth.ts` mints `sub: person.id`).
- `enforceAssignment(user, record)` — returns `AppError(403)` when an
  assigned-scoped role touches a record they are not assigned to;
  passes through for exempt roles and for unauthenticated callers
  (so routers mounted without auth in unit tests are unaffected).
- `ownerOnCreate(user, suppliedOwnerId)` — on create, defaults an
  assigned-scoped creator as the owner so they can edit what they
  make.

**Coverage.** Wired into every `CONTRIBUTOR`-writable router in the
`process` bucket:

- **process catalog** — `PUT /nodes/:id`, `DELETE /nodes/:id`, `POST
  /nodes/:id/clone` (assignment checked on the source), and `POST
  /nodes` (creator-owns). Anchor: `ownerId` / `responsiblePersonId`.
- **sops** — `PUT /:id`, `DELETE /:id`, and `POST /` (creator-owns).
  Anchor: the existing `ownerPersonId` column.
- **operations-manuals** — `PUT /:id`, `DELETE /:id`, and `POST /`
  (creator-owns). These had no per-record owner, so an `ownerPersonId`
  column was added (migration
  `20260805000000_ops_manual_owner_person`, mirroring sops/glossary).
  Seeded standard manuals keep `ownerPersonId = null` — org-wide
  reference content, not editable by whoever triggered the seed.

The shared predicate now recognises `ownerPersonId` alongside
`ownerId` / `stewardId` / `assigneeId` / `responsiblePersonId` /
`createdBy`. The `collaboration` bucket (comments, tags, attachments)
is the remaining `CONTRIBUTOR`-writable surface and is a follow-up.

## Tests

`packages/backend/src/__tests__/permissions.test.ts` covers the
catalog invariants (higher roles ⊇ VIEWER reads, sensitive buckets
admin-only), `actionForMethod`, and the `requireResource` guard
(401 unauthenticated, 403 on disallowed writes, allow on reads).
