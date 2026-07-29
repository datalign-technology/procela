# Procela — on-premise Helm chart

Deploys Procela to a customer-managed Kubernetes cluster: the backend
API, the Nginx-served frontend (which proxies `/api` to the backend),
and — optionally — bundled PostgreSQL and Redis. This mirrors the
`docker-compose.yml` topology and satisfies the on-premise deployment
target in the root `CLAUDE.md`. The AWS reference deployment lives in
`deploy/terraform/`; this is the on-prem equivalent.

> **Validation note:** `helm lint`/`helm template` could not be run in
> the authoring sandbox (egress policy blocks the Helm download). Run
> `helm lint deploy/helm/procela` and a `helm template … | kubectl apply
> --dry-run=server -f -` against your cluster before first use.

## Prerequisites

- Kubernetes 1.23+ and Helm 3.
- The Procela container images (`procela/backend`, `procela/frontend`)
  available to the cluster — push them to your internal registry and set
  `imageRegistry` / image repositories accordingly.
- An Ingress controller (defaults assume `ingressClassName: nginx`), or
  disable the Ingress and expose the frontend Service yourself.

### Migrations

The migration Job runs `prisma migrate deploy` as a pre-install/pre-upgrade
hook. The backend image bundles the prisma CLI and migration engine
(`prisma` is a runtime dependency), so this works out of the box. Override
`migrations.image.repository` only if you run migrations from a different
image, or `--set migrations.enabled=false` to run `prisma migrate deploy`
out-of-band yourself.

## Quick start

```bash
# 1. Create the namespace
kubectl create namespace procela

# 2. Install with your secrets (use a private values file in real life)
helm install procela deploy/helm/procela -n procela \
  --set ingress.host=procela.example.com \
  --set secrets.anthropicApiKey=sk-ant-… \
  --set-file secrets.jwtPrivateKey=./jwt_priv.pem \
  --set-file secrets.jwtPublicKey=./jwt_pub.pem \
  --set secrets.mfaEncryptionKey=$(openssl rand -hex 32) \
  --set postgresql.auth.password=$(openssl rand -hex 16)
```

For anything real, put secrets in a private values file or a pre-created
Secret (`secrets.existingSecret`) rather than on the command line.

## Common configurations

**External database / Redis** (managed by the customer):

```yaml
postgresql:
  enabled: false
externalDatabase:
  url: postgresql://procela:pw@db.internal:5432/procela?schema=public
redis:
  enabled: false
externalRedis:
  url: redis://redis.internal:6379
```

**Bring your own Secret** (avoids chart-managed secret values):

```yaml
secrets:
  existingSecret: procela-secrets   # must define DATABASE_URL, ANTHROPIC_API_KEY,
                                    # JWT_*, MFA_ENCRYPTION_KEY, SAML_IDP_CERT, SMTP_PASS
```

**SAML / OIDC SSO** (direct, no Cognito broker on-prem):

```yaml
config:
  authProvider: saml
  saml:
    entryPoint: https://idp.example.com/sso
    issuer: procela
    callbackUrl: https://procela.example.com/api/v1/auth/saml/acs
secrets:
  samlIdpCert: |
    -----BEGIN CERTIFICATE-----
    …
```

## Values reference

| Key | Default | Notes |
|---|---|---|
| `imageRegistry` | `""` | Prefix prepended to every image |
| `backend.image.repository` / `.tag` | `procela/backend` / Chart appVersion | |
| `backend.replicaCount` | `2` | Stateless — scale freely |
| `frontend.image.repository` / `.tag` | `procela/frontend` / Chart appVersion | |
| `config.*` | see `values.yaml` | Non-secret env (ConfigMap) |
| `secrets.*` | `""` | Secret env — supply at install |
| `secrets.existingSecret` | `""` | Use a pre-created Secret instead |
| `postgresql.enabled` | `true` | `false` → `externalDatabase.url` |
| `postgresql.persistence.size` | `10Gi` | PVC via `volumeClaimTemplates` |
| `redis.enabled` | `true` | `false` → `externalRedis.url` |
| `migrations.enabled` | `true` | Pre-install/upgrade hook Job |
| `migrations.image.repository` | `""` | Empty → backend image (needs prisma CLI) |
| `ingress.enabled` / `.host` / `.className` | `true` / `procela.example.local` / `nginx` | |
| `ingress.tls.enabled` / `.secretName` | `false` / `""` | |

See `values.yaml` for the full annotated list.

## Production hardening

- Override `postgresql.auth.password` and every `secrets.*` value.
- Provide an RS256 JWT keypair (`secrets.jwtPrivateKey` / `jwtPublicKey`)
  rather than the HS256 `jwtSecret` fallback.
- Set `secrets.mfaEncryptionKey` so TOTP secrets are encrypted at rest.
- For real HA/durability, consider a managed or operator-based PostgreSQL
  (e.g. CloudNativePG) instead of the bundled single-replica StatefulSet,
  which is a convenience default, not an HA database.
- Enable `ingress.tls` with a real certificate.
