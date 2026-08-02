# Procela — Secrets & Deployment Runbook

**Status: DRAFT for ops review.** This runbook is generated from the
repo's actual config surface (`.env.example`, `deploy/terraform/`,
`deploy/helm/`) and should be validated against a real environment
before a production cutover.

This is the **day-0 provisioning** guide: how to generate each secret,
where to put it (AWS Secrets Manager / a Kubernetes Secret), and how to
verify the app came up configured. It covers go-live checklist items
**#6–#12** (secrets + HTTPS bring-up).

Related docs — do not duplicate them here:

- **Rotating** an already-live secret → [`DR_RUNBOOK.md`](./DR_RUNBOOK.md) §3.
- **Restore / DR / migration roll-back** → [`DR_RUNBOOK.md`](./DR_RUNBOOK.md).
- The full readiness checklist → [`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md).
- Terraform specifics → [`deploy/terraform/README.md`](../deploy/terraform/README.md).
- Helm specifics → [`deploy/helm/procela/README.md`](../deploy/helm/procela/README.md).

---

## 0. How Procela reads config

- All config is environment variables (12-factor). The authoritative
  catalog with inline notes is [`.env.example`](../.env.example).
- **Nothing here is required for the app to *boot*.** Every unset
  secret has a safe dev fallback and logs a warning; the *feature*
  degrades rather than the process crashing. The table in §1 names the
  degrade for each. "PROD-REQUIRED" means: leaving it unset ships a real
  security or availability hole, not a crash.
- Two secrets can be stored **envelope-encrypted** rather than in
  cleartext (`OIDC_CLIENT_SECRET`, `SMTP_PASS`) — see §5.
- Frontend `VITE_*` vars are **build-time** (baked into the static
  bundle), not runtime — set them before `vite build`, not in the
  server's environment.

---

## 1. Secret & config catalog

Required column: **P** = PROD-REQUIRED, **C** = conditionally required
(only when the named feature/provider is used), **·** = optional.

| Variable | Req | If unset (the degrade) | AWS: Secrets Manager id | On-prem: Helm value |
|---|:--:|---|---|---|
| `DATABASE_URL` | P | falls back to JSON-file persistence | `〈prefix〉/app/database_url` | `secrets.*` → rendered, or `postgresql.*` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | P | drops to HS256 with `JWT_SECRET` (+ boot warning) | `〈prefix〉/app/jwt_private_key` · `…/jwt_public_key` | `secrets.jwtPrivateKey` · `secrets.jwtPublicKey` |
| `JWT_SECRET` | P | uses the insecure default → **forgeable sessions** | `〈prefix〉/app/jwt_secret` | `secrets.jwtSecret` |
| `ANTHROPIC_API_KEY` | P | AI features (templates, suggestions, assistant) disabled | `〈prefix〉/app/anthropic_api_key` | `secrets.anthropicApiKey` |
| `MFA_ENCRYPTION_KEY` **or** `KMS_PROVIDER` | P | TOTP secrets stored **plaintext** (prod refuses to start) | add to Secrets Manager + `ecs.tf` (see §3) | `secrets.mfaEncryptionKey` |
| `REDIS_URL` | P | rate limiter becomes per-instance → brute-force protection broken across replicas | add to Secrets Manager + `ecs.tf` | `redis.*` / `configMap` |
| `APP_URL` | P | password-reset / support email links point nowhere | plain env | `config.*` ConfigMap |
| `CORS_ALLOWED_ORIGINS` | P | dev fallback echoes the request origin (unsafe) | plain env | ConfigMap |
| `SMTP_HOST/PORT/USER/PASS/SECURE`, `MAIL_FROM` | P | password reset + support fall back to audit-log only | `SMTP_PASS` → secret; rest plain env | `secrets.smtpPass` + ConfigMap |
| `SUPPORT_EMAIL` | · | "Report a problem" reports are audit-logged, not emailed | plain env | ConfigMap |
| `AUTH_PROVIDER` + provider block | C | `dev` provider (any email logs in — **never** for prod) | plain env (`cognito` in `ecs.tf`) | ConfigMap |
| `COGNITO_*` / `OIDC_*` | C | required when `AUTH_PROVIDER=oidc`/cognito | plain env; `OIDC_CLIENT_SECRET` → secret | ConfigMap / `secrets.*` |
| `SAML_ENTRY_POINT/ISSUER/IDP_CERT/CALLBACK_URL` | C | required when `AUTH_PROVIDER=saml` | `SAML_IDP_CERT` → secret; rest plain | `secrets.samlIdpCert` + ConfigMap |
| `SCIM_BEARER_TOKEN` | C | SCIM endpoints return 401 (no IdP user provisioning) | secret | `secrets.*` (add) |
| `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET` | · | login CAPTCHA accepts any token (no bot protection) | `HCAPTCHA_SECRET` → secret | ConfigMap / `secrets.*` |
| `S3_BUCKET` / `S3_REGION` (`STORAGE_PROVIDER=s3`) | C | uses local disk (lost on container replace) | plain env | ConfigMap |

> **Coverage gap to close before prod (AWS):** `deploy/terraform/ecs.tf`
> today injects only `DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`,
> `JWT_SECRET`, `ANTHROPIC_API_KEY`. The other PROD-REQUIRED secrets
> (`MFA_ENCRYPTION_KEY`, `REDIS_URL`, `SMTP_PASS`, plus the IdP block)
> still need a Secrets Manager entry **and** a line in the task's
> `secrets = [ … ]` / `environment = [ … ]`. The Helm chart already
> wires the secret ones — the Terraform side is the follow-up.

---

## 2. Generate the secrets

Run these once per environment; treat the output as sensitive.

```bash
# JWT_SECRET — HMAC fallback (64 chars, no specials)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-64

# MFA_ENCRYPTION_KEY — 32+ char master key for at-rest TOTP encryption
openssl rand -base64 48 | tr -d '/+=' | cut -c1-44

# SCIM_BEARER_TOKEN — long random string shared with the IdP
openssl rand -hex 32

# JWT RS256 keypair (PREFERRED over HS256) — PEM private + public
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
```

Not generated locally:

- **`ANTHROPIC_API_KEY`** — from the Anthropic Console (`sk-ant-…`).
- **SMTP creds** — from your mail provider (SES SMTP, SendGrid, etc.).
- **IdP config** (`COGNITO_*` / `OIDC_*` / `SAML_*`) — from Entra ID /
  Okta / Cognito. SAML: the IdP consumes Procela's SP metadata at
  `GET /api/v1/auth/saml/metadata`.
- **`hCaptcha`** — site key + secret from the hCaptcha dashboard.

---

## 3. Deploy on AWS (ECS Fargate + Terraform)

Terraform (`deploy/terraform/`) creates the Secrets Manager entries;
the sensitive values are set **out-of-band** so no material lands in
Terraform state.

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in region, db_name, etc.
terraform init && terraform apply               # creates RDS, ECS, ALB, and the secret containers

# The secret ids follow `〈prefix〉/app/…` where 〈prefix〉 is your
# local.name_prefix (e.g. `procela-prod`). put-secret-value also accepts
# an ARN — `terraform output -json secret_arns` lists them.

# Populate the placeholder secrets (created empty by design):
aws secretsmanager put-secret-value --secret-id '〈prefix〉/app/anthropic_api_key' \
  --secret-string 'sk-ant-…'
aws secretsmanager put-secret-value --secret-id '〈prefix〉/app/jwt_private_key' \
  --secret-string "$(cat jwt-private.pem)"
aws secretsmanager put-secret-value --secret-id '〈prefix〉/app/jwt_public_key' \
  --secret-string "$(cat jwt-public.pem)"
# db_password, database_url, and jwt_secret are generated by Terraform —
# no action needed unless you rotate them (see DR_RUNBOOK §3).

# For each remaining PROD-REQUIRED secret, add a Secrets Manager entry +
# a line to ecs.tf `secrets`/`environment`, then re-apply. Then roll the
# service (names come from the stack's outputs):
aws ecs update-service \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw ecs_service_name)" \
  --force-new-deployment
```

`ignore_changes = [secret_string]` on the JWT/API-key entries means a
later `put-secret-value` (or a rotation) is **not** reverted by the next
`terraform apply`.

HTTPS terminates at the ALB — attach an ACM cert (checklist #12).

---

## 4. Deploy on-prem (Helm / Kubernetes)

The chart (`deploy/helm/procela/`) renders a Kubernetes `Secret` from
`values.secrets.*`, **or** consumes one you create yourself
(`secrets.existingSecret`). Prefer `existingSecret` in production so real
values never sit in a values file.

```bash
# Option A — pre-create the Secret (recommended)
kubectl create secret generic procela-secrets \
  --from-literal=DATABASE_URL='postgresql://procela:…@db:5432/procela?schema=public' \
  --from-literal=JWT_SECRET="$(cat jwt_secret.txt)" \
  --from-file=JWT_PRIVATE_KEY=jwt-private.pem \
  --from-file=JWT_PUBLIC_KEY=jwt-public.pem \
  --from-literal=ANTHROPIC_API_KEY='sk-ant-…' \
  --from-literal=MFA_ENCRYPTION_KEY="$(cat mfa_key.txt)" \
  --from-literal=SMTP_PASS='…'

helm upgrade --install procela deploy/helm/procela \
  --set secrets.existingSecret=procela-secrets \
  --set config.appUrl=https://procela.example.com \
  # …non-secret config via --set config.* / ConfigMap…

# Option B — chart-managed Secret (fine for staging): pass secrets.* via
# a --values file kept OUT of git, never inline on the command line.
```

A `prisma migrate deploy` pre-upgrade hook runs migrations; the backend
image bundles the Prisma CLI so the default image is sufficient. HTTPS
terminates at the Ingress / a fronting Nginx (checklist #12).

---

## 5. Envelope-encrypting a secret (optional, defence-in-depth)

`OIDC_CLIENT_SECRET` and `SMTP_PASS` accept either plaintext or an
`enc:v1:…` envelope encrypted with `MFA_ENCRYPTION_KEY`, so the value at
rest in Secrets Manager / the K8s Secret isn't the live credential.

Requires `MFA_ENCRYPTION_KEY` (or a `KMS_PROVIDER`) set and an
admin token; returns 503 if no encryption backend is configured.

```bash
curl -s -X POST "$API/api/v1/auth/encrypt-secret" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"plaintext":"my-smtp-password"}'
# → { "success": true, "data": { "ciphertext": "enc:v1:…" } }
# Paste that enc:v1:… value in as SMTP_PASS / OIDC_CLIENT_SECRET.
```

---

## 6. Per-environment secret checklist

Maps to the GO_LIVE_CHECKLIST **fast path** (#6, 7, 9, 10; plus 8, 11, 12).

| # | Item | dev | staging | prod |
|---|---|:--:|:--:|:--:|
| — | `AUTH_PROVIDER` ≠ `dev` | dev ok | **yes** | **yes** |
| 7 | RS256 JWT keypair (not HS256 default) | — | yes | **yes** |
| — | `JWT_SECRET` non-default | — | yes | **yes** |
| 11 | `MFA_ENCRYPTION_KEY` / KMS set | — | yes | **yes** |
| 8 | `REDIS_URL` (HA rate limiting) | — | yes | **yes** |
| 6 | `ANTHROPIC_API_KEY` | as needed | yes | **yes** |
| 9 | SMTP block complete | — | yes | **yes** |
| 10 | IdP (`COGNITO_*`/`OIDC_*`/`SAML_*`) | — | yes | **yes** |
| — | `APP_URL` + `CORS_ALLOWED_ORIGINS` real | localhost | yes | **yes** |
| 12 | HTTPS / TLS cert (ALB or Ingress) | — | yes | **yes** |
| — | hCaptcha keys (bot protection) | — | optional | recommended |

---

## 7. Verify the environment came up configured

```bash
# AI wired? (no secret is echoed — just a boolean)
curl -s "$API/api/v1/health/config"        # → { "aiConfigured": true }

# Liveness
curl -s "$API/api/v1/health"               # → { "status": "ok", … }
```

Then check the boot logs for readiness warnings — each missing
PROD-REQUIRED secret logs a specific line (e.g. "SMTP not configured —
outbound mail will fall back to the audit log", "signing with HS256 —
set JWT_PRIVATE_KEY for RS256"). A clean prod boot has **none** of them.

Smoke: sign in via the real IdP, trigger a password reset (confirm the
email arrives, not just an audit entry), and submit a "Report a problem"
(confirm it reaches `SUPPORT_EMAIL`).

---

## 8. Hygiene

- **Never commit real values.** `.env` and `deploy/terraform/*.tfvars`
  are git-ignored; keep Helm secret values files out of git too.
- **Least privilege:** the ECS task role reads only `〈prefix〉/*`
  secrets (see `deploy/terraform/iam.tf`); scope any added secret the
  same way.
- **Recovery window:** Secrets Manager entries use a 7-day recovery
  window — a deleted secret is restorable for a week.
- **Rotation is a separate procedure** — when a secret is compromised or
  on a schedule, follow [`DR_RUNBOOK.md`](./DR_RUNBOOK.md) §3
  (put-secret-value → force-new-deployment → verify → confirm the old
  credential is dead). Do not rotate by editing Terraform.
