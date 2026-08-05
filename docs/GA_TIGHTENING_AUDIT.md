# GA Tightening Audit — Every Field Earns Its Place

Goal for the first commercially available version: **stable, "tight," and
easy to use, deploy, and manage — every field has a purpose and adds value.**

This document is a full field-level census of the data model (63 models,
~653 columns) plus the operational surface, with a verdict on every
questionable field and a staged, migration-safe execution plan.

## Method

For each model, a field's liveness was judged by the **repo-mapper
discriminator**: `packages/backend/src/db/<model>.repo.ts` declares the
Prisma row type and maps fields in `fromPrisma()` (DB→app) and
`toPrismaData()` (app→DB). A column present in the row *type* but in
**neither** mapper is never read or written by the application = dead.
Findings were cross-checked against route/service usage and frontend
`.tsx` surfacing.

Verdict legend: **REMOVE** (dead — no purpose) · **CONSOLIDATE**
(redundant with a sibling) · **LOW-VALUE** (wired but no user value for a
tight v1) · **KEEP** (load-bearing; the ~90% not listed here).

> Each REMOVE is re-confirmed in its own migration PR before the column is
> dropped — this list is the work queue, not a blind delete script.

---

## A. Fields to REMOVE — dead columns (8 columns, 3 relations, 1 index)

| # | Model.column | Evidence | Migration notes |
|---|---|---|---|
| 1 | `Organization.identityProviderConfig` | Not in the repo row type nor either mapper; frontend type declares it, nothing reads it. 0 repo / 0 route refs. | Drop column. |
| 2 | `System.stewardId` | Schema comment: "legacy single-steward slot." In row type only, never round-tripped; superseded by `custodianIds` M2M. | Drop column **+ the `SystemSteward` relation on `Person`**. |
| 3 | `DataAsset.rejectedSensitivityTags` | Shadow array of `sensitivityTags`; row type + test fixtures only, absent from both mappers. | Drop column; update 3 test fixtures. |
| 4 | `Connection.systemId` | `@deprecated` in route, stripped in `toPublic` (never emitted), only used by a one-time JSON backfill of `connection_system_links`. | Backfill link table, drop column, **retire the now-dead frontend `conn.systemId` fallbacks** (ConnectionsPage). |
| 5 | `Person.department` | In row type but not round-tripped; absent from `StoredPerson`; every "department" hit in code is org-hierarchy, not this field. | Drop column. |
| 6 | `Person.externalId` | In row type, not round-tripped; no Person route reads it (SCIM `externalId` lives on `ScimGroup`). | Drop column **+ the orphan `@@index([externalId])`**. |
| 7 | `PersonSkill.level` | Join `createMany` omits it; no `.level` read anywhere. | Drop column. |
| 8 | `Skill.damaRoleId` | Repo comment: "we ignore it on both read and write." No route reads `Skill.damaRole`. | Drop column, **the `damaRole` relation + FK, and the reverse `DamaRole.skills` relation** (see C: `DamaRole.skills` is the unpopulated other end). |

---

## B. Fields/entities to CONSOLIDATE — redundancy

| Pair | Recommendation |
|---|---|
| `Person.role` (legacy single-role) vs `Person.orgRoles` (per-org) | `role` is a documented "holdover from the single-role model." Keep only as a fallback, or drop once `orgRoles` fully covers login/authz. |
| `Person.title` vs `Person.jobRole` | Two overlapping job-descriptor fields; `personLabel.ts` treats `title` as primary and `jobRole` as a secondary fallback. Collapse to one. |
| `System.integrationPoints` (free-text) vs `System.integrations` (structured JSON) | The structured field supersedes the free-text twin; migrate any content and retire `integrationPoints`. |
| `AnalysisReport.ownerName` (denormalized) vs `Report` (ownerId + join) | Inconsistent owner patterns across sibling models. Standardize on `ownerId` + join; drop the denormalized name. |
| `Report` vs `AnalysisReport` (model-level) | Genuinely distinct today (report-engine `definition` vs pivot-cube `config`) — **keep both for v1**, but flag as the clearest long-term model consolidation. |

### Stage-3 outcome (on review)

Only `AnalysisReport.ownerName` was a true, mechanical redundancy and
was consolidated: the stored column is dropped and the display name is
derived from `ownerId` via a people join, matching the sibling `Report`.

The other pairs were **reviewed and kept** — on inspection they are not
dead redundancy but live product surfaces, so removing them is a product
decision, not cleanup:

- **`Person.title` vs `jobRole`** — *kept.* `jobRole` is a distinct,
  user-editable field with its own edit input, a RACI-matrix "group by
  Job Role" dimension, and a sync-wizard mapping. Title (formal title)
  and Job Role (functional descriptor) are legitimately separate in
  practice. Collapsing them removes a reporting dimension and user data.
- **`System.integrationPoints`** — *kept.* Free-text that the schema
  deliberately retains because it captures nuance the structured
  `integrations` cannot; there is no lossless free-text→structured
  migration. Removing it destroys user content.
- **`Person.role` vs `orgRoles`** — *deferred.* `role` still backs
  login / JWT / authz; dropping it is high-risk and belongs with a
  dedicated authz change, not a field-consolidation pass.

---

## C. LOW-VALUE fields — wired, but no user value for a tight v1

Each round-trips but has no UI surface and/or no functional effect. Decide
per field: **surface it** (give it real value) or **defer/remove it**.

| Field | Why it's low-value |
|---|---|
| `FlowRelationship.condition` | Accepted by the create API but never rendered in any view; seeds always null. `label` covers the visible annotation. |
| `Mapping.createdBy` | Hardcoded to the literal `'dev-user'` on create — no real attribution (ties to the audit-trail gap in G). |
| `GovernanceTask.resolution` | Written on completion, displayed on no screen. |
| `GovernanceTask.createdBy` | Not meaningfully set; duplicated by `AuditLog`. |
| `GovernancePolicy.lastReviewDate` | Captured by the API; UI shows only `nextReviewDate`. |
| `GovernanceControl.linkedDomainId` / `linkedSystemId` | Stored, never shown or filtered. |
| `DamaRole.skills` (relation) | Unpopulated back-end of the dead `Skill.damaRoleId` (A#8); UI uses static `requiredSkillIds`. |
| `RaciOverride.reason` | Always stores the constant `'Manual override'` — carries no distinct data. |
| `GlossaryTerm.relatedTerms` | Round-tripped but has no form field or display at all; always seeded `[]`. |
| `Sop.lastReviewedAt` | Accepted by the API but no form input or display. |
| `Agent.skillIds` | Editable in the form but **ignored** by `runAgentExecution` (runs use `node.requiredSkillIds`). Misleading — implies an effect it doesn't have. |
| `SavedView.isShared` | Defaults true, but no UI toggle and no list-filter enforcement — sharing is never actually exercised. |

---

## D. Consistency fixes (cheap, high polish-value)

- **Owner FK naming:** `ProcessNode.ownerId` and `DataDomain.ownerId` vs
  `System.ownerPersonId` / `DataAsset.ownerPersonId`. Standardize on
  `ownerPersonId` platform-wide.
- **Timestamp typing:** `ProcessVersion.changedAt` and
  `SuggestionDismissal.dismissedAt` are `String` ISO values while every
  other model uses `DateTime`. Normalize to `DateTime`.

---

## E. Correctness bugs surfaced during the audit (matter for "stable")

1. **Phantom field read** — `routes/analysis.ts:270` reads
   `deputyOwnerPersonId`, which does not exist (the column is
   `System.deputyOwnerId`). The system-deputy governance fact never
   fires. Fix the reader (or the field name).
2. **Agent-schedule persistence bypass** — the ticker's `runScheduleNow`
   persists via `saveStore('agentSchedules', …)` instead of
   `agentSchedulesRepo.update()`, so in Postgres mode
   `lastRunAt`/`runCount`/`nextRunAt` advances may not reach the DB — an
   agent could re-run or lose schedule state on restart.
3. **Stale doc** — `refresh-tokens.repo.ts` header says "No consumer is
   wired yet"; it is in fact wired into `routes/auth.ts`. Comment only.

---

## F. Real vs mocked — a "tight v1" should not ship simulated surfaces

The on-prem connector agent, dbt Cloud integration, and manual lineage are
**real**. These are **not**, and should be finished, hidden, or clearly
labelled before GA:

- **In-app direct-connect discovery** (`connector.service.ts`) — an
  explicit mock for DATABASE / API / WAREHOUSE types; only LOCAL file
  upload reads real bytes. (Real discovery today runs through the on-prem
  agent + dbt.)
- **`SyncConnection` DATABASE source** — `generateMockRows`; URL
  (CSV/JSON) sources are real.
- **`SyncConnection.schedule` auto-run** — no background runner consumes
  `enabled`/`nextRunAt`; only manual `/run`. Auto-scheduling is
  aspirational.
- **Secrets at rest** — `DbtCloudConnection.token` and
  `OidcProvider.clientSecret` are stored plaintext; route them through the
  existing KMS layer before GA.

---

## G. Deploy / manage / stability (the operational half of "tight")

- **Scheduler multi-replica safety — highest-severity.** The backend has
  **15 in-process timer sites** (governance overdue-sweep, the
  agent-schedule ticker that makes real Claude calls, weekly digest, DQ
  rule runs, dbt polling, auth-token sweepers) with **no leader-election
  or single-instance guard**. The design mandates stateless, horizontally
  scalable services — but with >1 replica every replica fires all timers,
  causing duplicated AI spend, duplicate user notifications, and races on
  `nextRunAt`. Fix: a `SCHEDULER_ENABLED` role flag, a Postgres advisory
  lock, or an external scheduler.
- **RBAC not enforced on domain writes.** The `authorize(...roles)`
  middleware exists but is applied to only **9 endpoints (all
  auth/admin/backup)**. No core domain router (process nodes, data assets,
  systems, the entire governance suite) gates writes by role — so the
  six-role model (incl. **Viewer**) isn't enforced; a Viewer's token can
  create/edit/delete catalog entities. Enforce role-based writes before
  GA.
- **Config surface has undocumented knobs.** The backend reads **60
  distinct env vars** but `.env.example` documents **49** (~11
  undiscoverable without grepping source). Only 6 are `PROD-REQUIRED`
  (good — deploy stays simple). Close the doc gap.

---

## Prioritized execution plan (staged, migration-safe)

Ordered by value-for-a-tight-v1 and independence. Each stage is its own
PR; removals re-confirm their evidence and ship the migration together.

1. **Stability first (no schema):** scheduler single-owner guard (G),
   the two correctness bugs (E1, E2), enforce RBAC on domain writes (G).
   These protect a real multi-replica deployment.
2. **Dead-column sweep (migration):** the 8 columns + 3 relations + 1
   index from A, as one reviewed migration with the type/fixture updates.
   Pure subtraction, no behavior change.
3. **Consolidation (migration):** the B pairs — collapse the duplicated
   owner/role/title/integration fields onto one representation each.
4. **Low-value decisions (C):** per field, surface-or-remove. Removals
   fold into a second small migration.
5. **Consistency (D):** owner-FK rename and timestamp retyping — one
   mechanical migration.
6. **Real-vs-mocked (F):** for each simulated surface, either finish it or
   hide/label it so GA ships only real features; move the two plaintext
   secrets to KMS.
7. **Config docs (G):** document the ~11 undocumented env vars.

**Net effect:** ~8 columns and 3 relations removed, ~5 redundant fields
consolidated, ~12 low-value fields resolved, the scheduler made
replica-safe, RBAC enforced, and no user-facing simulated features — a
tighter, stabler, more manageable v1 where every remaining field earns its
place.
