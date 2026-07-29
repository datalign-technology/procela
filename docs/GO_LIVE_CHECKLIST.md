# Procela go-live checklist

Everything below is beyond what's shipped today — the platform runs on
the JSON persistence path and is demo-ready. This document tracks what
remains between "demo-ready" and "running a real customer in
production."

Items are grouped by concern. The **[Fast path](#fast-path)** section
at the bottom lists the minimum subset needed to run a single pilot
customer.

---

## Infrastructure — must-do for any production deploy

- [ ] **1. Postgres up.** Run `deploy/terraform/` against your AWS
  account, or self-host Postgres 16+. Set `DATABASE_URL` in the
  backend's environment (a real value, not the local `.env`).
- [ ] **2. Apply migrations.** `npx prisma migrate deploy` from
  `packages/backend/` — one time per environment. CI does this per-run.
- [x] ~~**3. JSON → Postgres data migration.**~~ **Done** (cutover PR 8).
  `scripts/migrate-json-to-postgres.ts` reads `.procela-data/*.json` and
  inserts through each repo in FK-tier order, idempotently; run via
  `npm run db:migrate-json` (supports `--dry-run`).
- [x] ~~**4. Cross-file consumers still read arrays.**~~ **Done** (cutover
  **PR 9b**, increments 9b.1–9b.37). Every reader — the aggregators
  (control-tower, enterprise-view, exports, analysis, chat), the store-owning
  routes and their foreign reads (systems, process-catalog, data-quality,
  data-lineage/dbt-import), the deferred governance sync helpers
  (`syncDataQualityIssueForRule`, `sweepOverdueTasks`,
  `openAgentOwnershipIssue`), and the audit hash-chain — now goes through its
  repository. The arrays are retired: `loadStore` returns `[]` in Postgres
  mode (the last four boot-time reads — audit cursor seed, process-catalog
  counter reseed, connections legacy link-migration, governance-policies
  documentType backfill — are `hasDatabase()`-guarded, so the app boots with
  **zero** stale-read warnings). Verified by booting the backend against a
  live Postgres (clean boot, 0 warnings) and the `live-db` suite (21/21).
- [x] ~~**5. Auth cutover.**~~ **Done** (cutover PRs 3a–3e). `services/scim`,
  `routes/auth*`, account-lockout, refresh tokens, MFA/WebAuthn, and the
  auth-providers config are all repo-backed and async. Cognito / Azure AD
  OIDC/SAML provider config is still wired via env vars (see #10).

## Environment / secrets — per environment

- [ ] **6. `ANTHROPIC_API_KEY`** — the working key set locally.
- [ ] **7. `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY`** — RS256 signing.
  **Code-complete** (`services/jwt-signer.ts`): the backend signs with
  RS256 when the keypair is present and only falls back to HS256 (with a
  boot warning) when it isn't. Config-only: generate an RSA keypair and
  store the private key in Secrets Manager.
- [ ] **8. `REDIS_URL`** — real Redis for rate-limiting & sessions. The
  backend falls back to in-memory if unset (fine for dev, not for HA).
- [ ] **9. `SMTP_*`** — mail delivery for notifications / password
  reset. Currently logs to the audit trail as a fallback.
- [ ] **10. Identity provider config.** `AUTH_PROVIDER`, `COGNITO_*`
  (AWS) or `SAML_*` / OIDC issuer URLs. Sub-domain-based tenant
  white-labeling needs proper DNS + a wildcard cert.
- [ ] **11. `KMS_PROVIDER` / `MFA_ENCRYPTION_KEY`** — encryption at
  rest for TOTP secrets is **code-complete** (`services/crypto.service.ts`
  + `services/kms-providers.ts`, with tests); it encrypts when a key /
  KMS provider is configured and falls back to plaintext **only in dev**
  (with a boot warning) when neither is set. Config-only: wire AWS KMS or
  a passphrase-derived `MFA_ENCRYPTION_KEY` in each environment.

## Runtime / operations

- [ ] **12. HTTPS termination** at ALB or Nginx. Cert via ACM (AWS) or
  Let's Encrypt.
- [ ] **13. Backups.** `.procela-data` backup on JSON, or RDS automated
  backups + point-in-time recovery on Postgres.
- [ ] **14. Log aggregation** (CloudWatch / Datadog). Pino outputs
  JSON — pipe it to your log platform.
- [ ] **15. Uptime monitoring** — hit `/api/v1/health` on a schedule,
  alert on non-200.
- [ ] **16. Rate limits.** `AI_MAX_CALLS_PER_ORG_PER_HOUR` / `_DAY` —
  pick values that match your Anthropic tier.

## Product / content

- [ ] **17. Real customer data seeded.** Either import via CSV (the
  People, Systems, and Data Assets pages have Import buttons) or turn
  on real on-prem connectors (Phase 3 work — not built yet; the demo
  has stub connectors only).
- [ ] **18. Legal:** ToS, privacy policy, DPA. Content hooks exist
  (`docs/`) but the actual text is placeholder.
- [ ] **19. Support flow:** how a customer reports a bug (email, in-app
  widget, or GitHub). Not wired.
- [ ] **20. Billing** — no billing subsystem exists. If SaaS, integrate
  Stripe / whatever fits.

## Testing / hardening beyond CI

- [ ] **21. Load test.** The E2E smoke covers correctness, not
  throughput — especially the AI endpoints, which are paid per call.
- [ ] **22. Security review.** SAST / dependency audit / pen test.
  Dependency audit **triaged**: `npm audit fix` (non-breaking) cleared the
  safely-fixable advisories (19 → 9, lockfile-only, all suites green). The
  remaining 9 need deliberate major-version work and are tracked
  separately — do not auto-`--force`:
  - **vitest toolchain** (`vitest`, `vite`, `vite-node`, `esbuild`,
    `@vitest/mocker`) — dev/test only; fix is the vitest 3 → 4 major.
  - **`nodemailer`** — runtime; fix is the 9.x major (`raw`-option file
    read; low exposure unless the `raw` send option is used).
  - **`react-router` / `react-router-dom`** — frontend runtime; fixed only
    in react-router **7.18+** (v6 → v7 major; open-redirect / XSS).
  - **`xlsx` (SheetJS)** — no npm fix published; the upstream fix ships
    only via the SheetJS CDN tarball. Decide: switch install source or
    mitigate/accept.
  SAST and a pen test are still outstanding.
- [x] ~~**23. DR runbook.**~~ **Written** — [`docs/DR_RUNBOOK.md`](./DR_RUNBOOK.md)
  covers restore-from-backup (PITR / snapshot / JSON fallback), migration
  roll-back, and secret / API-key rotation, grounded in `deploy/terraform/`
  and the Prisma migration flow. Ops still owes one **rehearsal against a
  staging restore** to record real RTO/RPO and confirm the prod-hardening
  prerequisites in the runbook's §7 (PITR retention, deletion protection,
  final snapshot, `MFA_ENCRYPTION_KEY` in Secrets Manager).
- [x] ~~**24. Real Postgres integration test in CI.**~~ **Done** (cutover
  PR 10). `live-db.test.ts` now carries a `live-db business flows` suite that
  drives the converted services (report-engine join, org-scope cascade,
  settings round-trip) against real Postgres, on top of the per-repository
  round-trips. Runs in CI's `test-backend-live-db` job.

## Roadmap items still ahead of go-live

- [~] **25. Phase 3 connectors** — the on-prem agent
  ([`packages/connector/`](../packages/connector/)) is **built and
  shipped**: a Node 20 agent with Postgres / MySQL / SQL Server adapters,
  a pairing → token → heartbeat → scan loop, a Docker image, and a GHCR
  release workflow (`.github/workflows/release-connector.yml`). The
  backend side (`pair/start` · `pair/claim` · `heartbeat` · `report`)
  upserts discovered tables as Bronze `DataAsset`s, audit-only. This
  session added the agent's **first test suite** (discovery mapping,
  config normalisation, the backend HTTP contract) + a CI `Connector
  tests` job, and **column-level discovery** — the three adapters now
  also read `information_schema.columns` and `/report` upserts
  `DataAssetColumn`s (name + type, audit-only; no values cross the wire).
  **Remaining:** Oracle + dbt-manifest source types (planned), and a real
  end-to-end run against customer databases.
- [~] **26. On-prem deployment** (per the CLAUDE.md guarantee). **Helm
  chart added** — [`deploy/helm/procela/`](../deploy/helm/procela/):
  backend, Nginx-served frontend, optionally-bundled PostgreSQL + Redis,
  a `prisma migrate deploy` pre-upgrade hook, Ingress, and split
  ConfigMap/Secret. Mirrors the compose topology. The backend image now
  bundles the prisma CLI (`prisma` moved to a runtime dependency), so the
  migrate Job works with the default image. **Remaining:** a real
  `helm lint` + a smoke deploy on a cluster (couldn't run in CI's
  sandbox), and managed/HA PostgreSQL (vs the bundled single-replica
  StatefulSet) as a follow-up.
- [x] ~~**27. The ~7 rule-8 handlers left as follow-up.**~~ Converted
  in PR [#137](https://github.com/datalign-technology/procela/issues/137).
  **Done.**

---

## Fast path

What "MVP go-live for one pilot customer" looks like. Minimum to run one
customer in production:

> **1, 2, 4, 6, 7, 9, 10, 12, 13, 15, 22, 23**

Everything else can follow in month-2 iterations once you have a live
signal.
