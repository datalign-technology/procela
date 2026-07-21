# docs/

Standalone documents that don't belong in the app or the code.

| File | Purpose |
|---|---|
| [`TRAINING.md`](./TRAINING.md) | Hands-on 90-minute walkthrough of Procela. Written against the Tidewater Utilities demo fixture; the shape (Modules 1–12) applies to any customer once their own data is loaded. Served in-app at **Help → Training**. |
| [`demo-playbook.html`](./demo-playbook.html) | Presenter's runbook for the 45-minute Procela demo against the Tidewater Utilities fixture. Open in a browser or Cmd/Ctrl-P to print. |
| [`capability-matrix.md`](./capability-matrix.md) / [`.csv`](./capability-matrix.csv) | Feature checklist for sales / RFP responses. |
| [`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) | What remains between "demo-ready" and running a real customer in production — infra, secrets, ops, and roadmap, plus the fast-path subset for a single pilot. |
| [`POSTGRES_CUTOVER_PLAN.md`](./POSTGRES_CUTOVER_PLAN.md) | Engineering plan for moving persistence from JSON files to Postgres (checklist #3–#5) — current state, the boot-safety fix, and the ~10-PR sequence with critical path. |
| [`POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md`](./POSTGRES_CUTOVER_PR5_REPORT_ENGINE.md) | File-level conversion design for the riskiest cutover step — routing the report engine through repositories without per-row N+1 joins. |

For in-app help see `packages/backend/src/docs/HELP.md` (the Help page).
