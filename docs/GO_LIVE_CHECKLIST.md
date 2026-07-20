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
- [ ] **3. JSON → Postgres data migration.** Write a one-shot script
  that reads `.procela-data/*.json` and inserts through each repo. Not
  built yet. Alternative: cut over on a fresh org — most customers
  won't have JSON data to preserve.
- [ ] **4. Cross-file consumers still read arrays.**
  `services/scheduler`, `services/digest.service`,
  `services/report-engine`, and `lib/org-scope` bypass the repos. On
  Postgres they see empty in-memory arrays. Must be converted before a
  Postgres cutover (multi-PR).
- [ ] **5. Auth cutover.** `services/scim` and `routes/auth*` weren't
  migrated — separate subsystem. If you're using Cognito / Azure AD,
  wire the OIDC/SAML provider config via env vars; the code already
  supports it.

## Environment / secrets — per environment

- [ ] **6. `ANTHROPIC_API_KEY`** — the working key set locally.
- [ ] **7. `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY`** — RS256 signing. The
  backend currently boots with an HS256 warning. Generate an RSA
  keypair; store the private key in Secrets Manager.
- [ ] **8. `REDIS_URL`** — real Redis for rate-limiting & sessions. The
  backend falls back to in-memory if unset (fine for dev, not for HA).
- [ ] **9. `SMTP_*`** — mail delivery for notifications / password
  reset. Currently logs to the audit trail as a fallback.
- [ ] **10. Identity provider config.** `AUTH_PROVIDER`, `COGNITO_*`
  (AWS) or `SAML_*` / OIDC issuer URLs. Sub-domain-based tenant
  white-labeling needs proper DNS + a wildcard cert.
- [ ] **11. `KMS_PROVIDER` / `MFA_ENCRYPTION_KEY`** — the backend
  currently warns "secrets stored in plaintext." Wire AWS KMS or a
  passphrase-derived key for TOTP secrets and password hashes at rest.

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
  `npm audit` currently shows 7 vulnerabilities to review.
- [ ] **23. DR runbook.** How to restore from backup, rotate a
  compromised API key, and roll back a migration.
- [ ] **24. Real Postgres integration test in CI.** The live-DB job
  we shipped runs one file (`live-db.test.ts`). Expand it to real
  business-flow coverage against Postgres.

## Roadmap items still ahead of go-live

- [ ] **25. Phase 3 connectors** — the real on-prem agent that scans
  customer DBs. UI stubs + backend registration exist; the actual agent
  binary / Docker image is future work.
- [ ] **26. On-prem deployment** (per the CLAUDE.md guarantee).
  Currently prototyped on AWS. Helm charts / k8s manifests for on-prem
  don't exist yet.
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
