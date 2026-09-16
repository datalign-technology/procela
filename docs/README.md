# docs/

Standalone documents that don't belong in the app or the code.

### Product & demo

| File | Purpose |
|---|---|
| [`TRAINING.md`](./TRAINING.md) | Hands-on 90-minute walkthrough of Procela. Written against the Tidewater Utilities demo fixture; the shape (Modules 1–12) applies to any customer once their own data is loaded. Served in-app at **Help → Training**. |
| [`demo-playbook.html`](./demo-playbook.html) | Presenter's runbook for the 45-minute Procela demo against the Tidewater Utilities fixture. Open in a browser or Cmd/Ctrl-P to print. |
| [`edge-connector-demo.md`](./edge-connector-demo.md) | One-command Docker demo (`docker compose --profile demo up --build`) that runs real on-prem edge connectors against a seeded source database — split by industry (a Tidewater Utilities connector scans `utility`, a Momentum Industries connector scans `shipbuilder`) to show discovery and connector-measured data quality. |

### Go-to-market & marketing

| File | Purpose |
|---|---|
| [`marketing/README.md`](./marketing/README.md) | **Start here for GTM.** The kit index, the strategy in one paragraph, and the ordered "start Monday" list for the first two weeks. |
| [`marketing/OPERATING_PLAN.md`](./marketing/OPERATING_PLAN.md) | The kit calibrated for a **solo founder with seed funding**: one pilot at a time rather than three, warm contacts before cold email, the runway clock worked backwards to a pilot-1 deadline, revised targets and industry order, a paid implementation fee as a qualification filter, an explicit cut-list, the weekly rhythm, and when to make the first hire. Where this and `GTM_PLAN.md` disagree, this wins. |
| [`marketing/GTM_PLAN.md`](./marketing/GTM_PLAN.md) | Positioning against the four incumbents, ICP and personas, target-list sourcing by industry, channel ranking, funnel math with diagnostic thresholds, the 90-day calendar, budget, and the weekly scorecard. |
| [`marketing/MESSAGING.md`](./marketing/MESSAGING.md) | The words: positioning statement, three pillars, per-persona messaging, proof points, objection handling, competitive framing, and a **claims-discipline table** binding every public claim to a *Built* row in `STATUS.md`. |
| [`marketing/EMAIL_CAMPAIGNS.md`](./marketing/EMAIL_CAMPAIGNS.md) | Ten ready-to-send sequences with full copy (**warm outreach and advisor recruitment**, cold outbound per persona, stalled-catalog play, founding-partner invite, webinar lifecycle, post-demo, POC offer, nurture), plus deliverability mechanics and CAN-SPAM / GDPR / CASL guardrails. |
| [`marketing/DEMO_PROGRAM.md`](./marketing/DEMO_PROGRAM.md) | Five online demo formats built as cuts of [`demo-playbook.html`](./demo-playbook.html) — the 6-minute async demo, the biweekly public demo, the tailored 1:1, the Gap Teardown working session, and the association webinar — with run-of-show, environment checklist, and conversion targets. |
| [`marketing/DESIGN_PARTNER_PROGRAM.md`](./marketing/DESIGN_PARTNER_PROGRAM.md) | The reduced-licensing POC offer: ten slots by industry, pilot scope, mutual commitments, success criteria, pricing anchors and discount discipline, the 90-day pilot plan, agreement structure, and partner-qualification scoring. |
| [`marketing/READINESS_GATES.md`](./marketing/READINESS_GATES.md) | What must be true before outbound starts, before the first pilot, and before the fourth concurrent pilot — drawn from `STATUS.md` and the go-live checklist. **Read before sending the first email.** |

### Go-live & operations

| File | Purpose |
|---|---|
| [`PILOT_GO_LIVE_WORKSHEET.md`](./PILOT_GO_LIVE_WORKSHEET.md) | The fast-path subset (see `STATUS.md` § Go-live checklist), as an ordered tick-through operator worksheet for standing up one pilot customer on AWS. All ops/config, no code. |
| [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) | Day-0 secret & config provisioning: how to generate each secret, where it lives (AWS Secrets Manager / Helm), and how to verify the app came up configured. Covers checklist #6–#12. Opens with a **Deployment models** section (multi-tenant SaaS vs. SaaS + on-prem connector vs. fully on-premise). |
| [`DR_RUNBOOK.md`](./DR_RUNBOOK.md) | Disaster-recovery procedures — restore from backup, roll back a migration, rotate a compromised secret, full rebuild — for checklist #23. |
| [`RELEASING.md`](./RELEASING.md) | How the on-prem connector container image is released and published to GHCR — `connector-v*` tags → semver + `latest`, trunk → `edge`/`sha-*`, manual dispatch, provenance/SBOM, and the one-time package-visibility prerequisite. |

### Planning & roadmap

| File | Purpose |
|---|---|
| [`STATUS.md`](./STATUS.md) | **The single source of truth for status, roadmap and open work.** One consolidated doc: the snapshot, roadmap tracks A–E, open/partial items by priority, deferrals, recommendations, the full go-live checklist, the AWS production-hardening reference, the competitor coverage matrix, the discovery coverage survey, and the GA-audit outcome. The in-app **/roadmap** page renders it live. (Supersedes the former `ROADMAP.md`, `future-work.csv`, `capability-matrix`, `non-relational-discovery.md`, `GO_LIVE_CHECKLIST.md`, `AWS_PRODUCTION_GUIDE.md`, and GA-audit docs.) |

> **Downstream mirror — refresh by hand when STATUS.md changes materially.** The
> published **"Procela Application Roadmap"** Claude artifact
> (`claude.ai/code/artifact/5b7e9492-182e-4b91-9c35-3d5acd55b524`) is a curated,
> presentation-formatted mirror of this file's forward view (the five tracks, the
> two P0 gates) plus an appended FedRAMP High gap analysis. It is **not**
> auto-synced — it lives outside the repo, so a material change here (a track
> opening/closing, a P0 moving, a shipped item) needs a manual artifact refresh
> and a version bump. Last synced: **v1.3 · 2026-09-14** (multi-vendor AI shipped
> end-to-end). The in-app `/roadmap`
> page, by contrast, reads `STATUS.md` live and needs no refresh.

### Architecture & data model

| File | Purpose |
|---|---|
| [`POSTGRES.md`](./POSTGRES.md) | How to run the backend against Postgres locally and the repository pattern every entity follows. The cutover is complete; this is the reference shape for adding a **new** entity. |
| [`POSTGRES_CUTOVER_PLAN.md`](./POSTGRES_CUTOVER_PLAN.md) | Engineering plan (now executed) for moving persistence from JSON files to Postgres — current state, the boot-safety fix, and the ~10-PR sequence with critical path. Historical record of the cutover. |
| [`POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md`](./POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md) | File-level conversion design for the riskiest cutover step — routing the report engine through repositories without per-row N+1 joins. |
| [`DATA_OWNERSHIP.md`](./DATA_OWNERSHIP.md) | Which tables and columns are written by the interactive UI / REST API versus the on-prem edge agent (`@procela/connector`) — the four co-managed tables, their column-level split, the audit-only write stance, and how the connector (Option 2) maps onto a direct Connection (Option 1) as the metadata-only subset of the same catalog. |
| [`RBAC_PERMISSION_MATRIX.md`](./RBAC_PERMISSION_MATRIX.md) | Authoritative reference for role-based authorization. `packages/backend/src/lib/permissions.ts` is the source of truth; this explains it. |

For in-app help see `packages/backend/src/docs/HELP.md` (the Help page). The GA
tightening audit (§A–G, now closed) is summarised in `STATUS.md` § GA tightening
audit.
