# Procela — Hardened Production Setup on AWS

A **step-by-step guide** to stand up Procela on AWS as a real production
system — not just the demo/reference stack. It assumes some technical
comfort (you can run a terminal and read AWS docs) but explains each
piece in plain language and links to the exact file or command.

This document is the **map**. It sequences the three deeper docs so you
run them in the right order and don't miss a hardening step:

| When | Doc | What it's for |
|---|---|---|
| Build the infrastructure | [`deploy/terraform/README.md`](../deploy/terraform/README.md) | The Terraform that creates the AWS resources |
| Load secrets + go live | [`docs/DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) | Generating/placing each secret, bringing HTTPS up |
| Track readiness | [`docs/GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) | The full "demo-ready → production" checklist |
| Run it / recover it | [`docs/DR_RUNBOOK.md`](./DR_RUNBOOK.md) | Backups, restore, secret rotation, region rebuild |

> **Why this guide exists.** The Terraform module ships as a *reference*
> deployment — deliberately small so the jump to "hardened" is auditable.
> Its own [_What this is not_](../deploy/terraform/README.md#what-this-is-not)
> section lists what production needs on top. This guide turns that list
> into an ordered, explained plan.

---

## The shape of what you're building

```
        Internet
           │
     [ Route 53 ]  DNS
           │
     [ CloudFront ] ── WAF ──►  S3 (React frontend)
           │
     [ ALB, HTTPS ]  (private, reached from CloudFront)
           │
   ┌───────┴────────┐   private subnets, 2 Availability Zones
   │  ECS Fargate   │ ── backend API containers
   └───────┬────────┘
           │  (via VPC endpoints, not the open internet)
   ┌───────┴──────────────────────────────┐
   │ RDS Postgres (Multi-AZ)   Secrets Mgr │
   │ ElastiCache Redis         KMS keys    │
   └───────────────────────────────────────┘

  Watching everything: CloudTrail · GuardDuty · Config · CloudWatch alarms
```

Terraform builds the boxes; the runbooks fill them with secrets and keep
them healthy. "Hardened" is the difference between the boxes existing and
them being locked down, encrypted, redundant, and monitored.

---

## Before you start — decisions and accounts

You'll go faster if you settle these first.

1. **AWS accounts.** For real production, use **separate AWS accounts**
   per environment (at least `prod`, ideally `dev`/`staging`/`prod`) plus
   a small **security account** that receives audit logs. One account for
   everything works for a pilot but is the first thing an auditor flags.
2. **Region.** Pick one AWS region for the deployment (e.g.
   `us-east-1`). Note: CloudFront certificates *always* live in
   `us-east-1` even if the rest is elsewhere — an AWS rule, not ours.
3. **Domain.** The public name customers will use (e.g.
   `app.yourco.com`). You need DNS you control (Route 53 is easiest).
4. **Tools on your machine:** the **AWS CLI** (logged in with admin-ish
   credentials), **Terraform 1.6+**, **Docker**, and **Node** (to build
   the frontend). 
5. **Who owns secrets.** Decide who holds the Anthropic API key, who can
   read AWS Secrets Manager, and who is on-call. Hardening is as much
   "least privilege for people" as it is infrastructure.

---

## Phase 1 — Set up remote Terraform state (do this first)

**Plain version:** Terraform keeps a "save file" (state) describing what
it built. By default it's a file on your laptop — lose it and you can't
manage the stack. Production must keep it in **S3**, with a **DynamoDB**
lock table so two people can't apply at once.

1. Create an S3 bucket (versioned, encrypted, private) and a DynamoDB
   table for locks — by hand or a tiny bootstrap module.
2. Uncomment and fill the `backend "s3"` block in
   [`deploy/terraform/versions.tf`](../deploy/terraform/versions.tf) —
   the exact snippet is in the Terraform README's
   [Remote state](../deploy/terraform/README.md#remote-state) section.
3. Run `terraform init` — it will move state to S3.

Do this **before** your first real `apply`, so prod state is never on a
laptop.

---

## Phase 2 — Prerequisites in AWS

From the Terraform README's [Prereqs](../deploy/terraform/README.md#prereqs),
create these once:

- **An ACM certificate for the ALB** in your deployment region → its ARN
  goes in `alb_certificate_arn`.
- **An ACM certificate in `us-east-1`** for CloudFront →
  `cloudfront_certificate_arn`.
- **A Route 53 hosted zone** for your domain (DNS records are created
  after apply, on purpose, so the module stays portable).
- **A backend container image in ECR.** Build and push it:
  ```bash
  docker build -t procela-backend packages/backend
  # tag + push to your ECR repo, then set app_image to that URI
  ```

---

## Phase 3 — Stand up the base infrastructure

This is the Terraform README's [Usage](../deploy/terraform/README.md#usage)
section. In short:

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # fill in ARNs, domain, sizes

terraform init
terraform plan  -out plan.tfplan
terraform apply plan.tfplan   # ~20 min (CloudFront is most of it)
```

Set these `terraform.tfvars` values for a production-shaped base (all are
real variables in
[`variables.tf`](../deploy/terraform/variables.tf)):

- `environment = "prod"`, `project_name`, `region`
- `domain_name`, `app_url`, `cors_allowed_origins`
- `alb_certificate_arn`, `cloudfront_certificate_arn`
- `desired_count` ≥ 2 (more than one backend task, across AZs)
- `db_instance_class`, `db_allocated_storage_gb`
- `db_backup_retention_days` (raise this — see Phase 5)
- `log_retention_days` (e.g. 90+ for prod)
- `enable_redis = true` (real rate-limiting needs shared Redis)
- Auth: `auth_provider` + the matching `enable_oidc`/`enable_saml`/
  `enable_scim` and issuer/client vars for your identity provider.

Then follow the README's [**After apply**](../deploy/terraform/README.md#after-apply)
steps: point DNS at CloudFront, upload the frontend build to S3 +
invalidate, and force an ECS redeploy.

---

## Phase 4 — Load secrets and confirm it's live

Terraform creates the secret *containers* with `REPLACE_ME_*`
placeholders; you fill in the real values. Follow
[`docs/DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) — the day-0 guide — for
each one:

- **Anthropic API key**, **JWT signing keys** (RS256 keypair for prod —
  the runbook shows how to generate them).
- The **DB password** and `jwt_secret` are auto-generated; `DATABASE_URL`
  is composed on apply — no action needed.
- **Apply migrations once per environment** using the one-off Fargate task the
  module ships (runs in-VPC against RDS — no bastion needed):
  `terraform output -raw migrate_run_task_command | bash`
  (or `npx prisma migrate deploy` from a machine with DB reach).
  See `docs/CUSTOMER_ONBOARDING.md` for the full tenant-onboarding runbook,
  including the first-Super-Admin bootstrap. (Go-live checklist item #2.)
- **Restart the ECS service** so tasks pick up the secret values
  (they cache on startup).

Verify: the health check passes, you can sign in through your identity
provider, and the AI features respond (the backend logs a startup model
probe — a bad key shows up there).

---

## Phase 5 — Harden it (the part that makes it production)

Everything above gives you a *working* stack. The items below are what
separate "reference" from "hardened." Each is: **what it is**, **why it
matters**, and **how**. Items marked **✅ Toggle** now have an opt-in
variable in the module (all default off — flip them in
`terraform.tfvars`, then `terraform plan` and review; the full table is
in [`deploy/terraform/README.md`](../deploy/terraform/README.md#production-hardening-toggles)).
The rest are existing variables, AWS console/CLI steps, or noted as out
of scope.

Do the **must-haves** for any production system; the **strongly-advised**
set is expected for anything holding customer data.

### 5.1 Data durability — don't lose the database

| Item | Why | How |
|---|---|---|
| **RDS Multi-AZ** | A standby copy in a second AZ fails over automatically if one data center dies. | ✅ Toggle `rds_multi_az = true`. |
| **Deletion protection + final snapshot** | Stops an accidental `terraform destroy` from wiping the DB with no backup. | ✅ Toggle `rds_deletion_protection = true` (flips deletion protection, final snapshot, and backup retention together). |
| **Longer backup retention + PITR** | Point-in-time recovery lets you rewind to any second in the window after a bad write. Requires retention > 0. | Raise `db_backup_retention_days` (existing var) to e.g. 14–35. |
| **Performance Insights** | Diagnose slow queries under load. | ✅ Toggle `rds_performance_insights = true`. |

Recovery procedures live in [`DR_RUNBOOK.md` §1](./DR_RUNBOOK.md#1-restore-the-database-from-backup).

### 5.2 Encryption — customer-managed keys (KMS)

**What:** AWS encrypts RDS, S3, Secrets Manager, and logs by default, but
with keys AWS controls. A **customer-managed key (CMK)** means *you*
control the key, its rotation, and who can use it — required by most
compliance regimes.
**How:** ✅ Toggle `enable_kms_cmk = true` — creates auto-rotating CMKs
and points RDS storage, Secrets Manager, the CloudWatch log group, and
the frontend S3 bucket at them (`deploy/terraform/kms.tf`).

### 5.3 Network isolation — shrink the attack surface

| Item | Why | How |
|---|---|---|
| **CloudFront-only ALB** | The load balancer shouldn't be reachable from the open internet — only from CloudFront. | ✅ Toggle `restrict_alb_to_cloudfront = true` locks the ALB security group to CloudFront's managed prefix list. (A *fully* private ALB via VPC origin/PrivateLink remains out of scope — see README.) |
| **Private CloudFront** | If the frontend isn't meant to be public, gate it (signed URLs/cookies + a CloudFront Function checking auth). | Out of scope — needs app-level auth wiring (see README "Still out of scope"). |
| **VPC endpoints** | Let tasks reach S3/ECR/Secrets Manager/CloudWatch *privately* instead of over the NAT — cheaper and more isolated. | ✅ Toggle `enable_vpc_endpoints = true`. |
| **NAT gateway per AZ** | The module uses one NAT to save cost; a single-AZ outage then cuts egress for the other AZ. | ✅ Toggle `enable_nat_per_az = true`. |

### 5.4 Edge protection — block bad traffic before it lands

- **AWS WAF** in front of CloudFront — filters common attacks (SQL
  injection, bad bots, rate floods). **Must-have for a public app.**
- **AWS Shield Advanced** — extra DDoS protection if your org subscribes.

**How:** ✅ Toggle `enable_waf = true` — creates a WAFv2 web ACL (AWS
managed rule groups + a `waf_rate_limit` rate rule) and attaches it to
CloudFront (`deploy/terraform/waf.tf`). Shield Advanced is a separate
AWS subscription, enabled outside this module.

### 5.5 Secrets rotation

**What:** Long-lived secrets (especially the DB password) should rotate
automatically. **How:** ✅ Toggle `enable_db_secret_rotation = true` and
pass `db_rotation_lambda_arn` (deploy AWS's SAR Postgres rotation Lambda
first — see the Terraform README "Secret rotation"). The *manual*
rotation steps for every secret are documented in
[`DR_RUNBOOK.md` §3](./DR_RUNBOOK.md#3-rotate-a-compromised-secret--api-key).

### 5.6 Observability — see what's happening

- **Access logs** on the ALB and CloudFront → a dedicated, locked-down
  log bucket. ✅ Toggle `enable_access_logs = true`.
- **Ship application logs** somewhere queryable (OpenSearch/Datadog)
  rather than only CloudWatch. Out of scope — integration-specific.
- **CloudWatch alarms** on the essentials: backend 5xx rate, ECS
  CPU/memory, RDS CPU/storage/connections, ALB unhealthy hosts — wired to
  a pager/Slack. ✅ Toggle `enable_monitoring_alarms = true` (+ optional
  `alarm_email`); subscribe a pager/Slack to the output SNS topic.

### 5.7 Threat detection & audit trail

Each has a toggle (`security.tf`); in a multi-account org you'd
typically also aggregate findings into a dedicated security account.

- **CloudTrail** — records every AWS API call (who did what). ✅ `enable_cloudtrail = true`.
- **GuardDuty** — flags suspicious activity automatically. ✅ `enable_guardduty = true`.
- **AWS Config** — tracks resource configuration drift/compliance. ✅ `enable_config = true`.
- **Security Hub** — one dashboard across the above. ✅ `enable_security_hub = true`.

> Procela also has its **own** in-app audit log (every entity change is
> hash-chained). AWS CloudTrail covers the *infrastructure* layer; the
> app audit log covers the *application* layer. You want both.

### 5.8 Delivery & environments

- **CI/CD pipeline** that, on merge to main, builds + pushes the backend
  image and syncs the frontend to S3. (The task definition already
  ignores image-tag changes so Terraform and CI don't fight — see
  `ecs.tf`.)
- **Per-environment stacks** — separate state files and AWS accounts for
  dev / staging / prod, so a mistake in one can't touch another.

---

## Phase 6 — Production-readiness check

Walk [`docs/GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) top to bottom;
it groups items by concern (infrastructure, secrets, runtime, testing).
The **[Fast path](./GO_LIVE_CHECKLIST.md#fast-path)** at the bottom is the
minimum subset for a single pilot customer — a good gate before your
first real user, with the Phase-5 hardening layered on for a true
production launch.

A quick "am I hardened?" sanity list:

- [ ] Terraform state in S3 + DynamoDB lock (Phase 1)
- [ ] RDS Multi-AZ, deletion protection, backups ≥ 14 days, PITR verified
- [ ] KMS customer-managed keys on RDS / S3 / Secrets / logs
- [ ] WAF attached to CloudFront; ALB not publicly reachable
- [ ] VPC endpoints for S3/ECR/Secrets/Logs; NAT per AZ
- [ ] CloudTrail + GuardDuty + Config + Security Hub on
- [ ] Access logs on ALB + CloudFront; alarms wired to a pager
- [ ] Secrets rotation automated (at least the DB password)
- [ ] `desired_count` ≥ 2 backend tasks; Redis enabled
- [ ] Separate prod AWS account + least-privilege human access
- [ ] A **restore drill** actually performed (see below)

---

## Phase 7 — Operate and recover

Production isn't "set and forget." Keep
[`docs/DR_RUNBOOK.md`](./DR_RUNBOOK.md) next to your Terraform state and,
before go-live, **rehearse** the three core scenarios at least once:

1. **Restore the database** from a backup / point-in-time
   ([§1](./DR_RUNBOOK.md#1-restore-the-database-from-backup)).
2. **Roll back a migration**
   ([§2](./DR_RUNBOOK.md#2-roll-back-a-database-migration)).
3. **Rotate a compromised secret**
   ([§3](./DR_RUNBOOK.md#3-rotate-a-compromised-secret--api-key)).

A backup you've never restored is a guess, not a backup.

---

## What's already coded vs. what's "code later"

Here's the honest split so you know exactly what a toggle covers and
what's left to you.

**The reference stack (always on):** base VPC + subnets, RDS Postgres,
ECS Fargate, ALB (HTTPS), CloudFront + S3 frontend, Secrets Manager
wiring, optional Redis, backup-retention and log-retention knobs,
`desired_count` scaling, and the auth-provider vars.

**Hardening — now shipped as opt-in toggles** (all default off; flip in
`terraform.tfvars`, then `terraform plan` and review): Multi-AZ,
deletion protection + final snapshot, Performance Insights, KMS CMKs,
WAF, CloudFront-only ALB + drop-invalid-headers, VPC endpoints,
NAT-per-AZ, access logs, CloudWatch alarms + SNS, DB secret rotation
(bring a rotation Lambda ARN), and GuardDuty / Security Hub / AWS Config
/ CloudTrail. The full toggle table is in
[`deploy/terraform/README.md`](../deploy/terraform/README.md#production-hardening-toggles).

**Still genuinely out of scope** (process/pipeline or app-level work, not
a single module toggle): a *fully* private ALB via CloudFront VPC origin
/ PrivateLink (the toggle above locks ingress to CloudFront IPs, which
covers the common case), private CloudFront with app-level auth, shipping
application logs to OpenSearch/Datadog, a CI/CD pipeline, and a
per-environment / per-account stack layout.

The Terraform README says it plainly: *"None of these are hard to bolt on
— the module is deliberately kept small so the delta from reference to
hardened is auditable."*
