# Security Policy

This document describes the security model of Procela, the controls
shipped with it, and how to report a vulnerability.

> The controls described below are implemented and shipping.
> Persistence runs on **PostgreSQL** (via Prisma) when `DATABASE_URL` is
> set, with JSON files as the zero-config local/dev default; Docker
> Compose, CI, and OIDC / SAML / MFA integration tests are all in place.
> A smaller set of operational hardening items is still in progress —
> see [Operational concerns](#operational-concerns-in-progress) at the
> end of this document and `README.md` for the backlog.

## Reporting a vulnerability

Email **security@procela.io** with a description of the issue, a
reproduction (or proof-of-concept), and the affected version /
commit. Encrypt with our PGP key if the report contains exploit
details; the key fingerprint is published at
`/.well-known/security.txt` on production deployments.

We acknowledge reports within 2 business days and aim to ship a fix
or mitigation for high-severity findings within 30 days. Please do
not open a public GitHub issue for security-sensitive reports.

## Supported versions

Procela is shipped as a continuously-delivered monorepo; we apply
security fixes only to the `main` branch. Customers running a tagged
release older than 90 days should upgrade or back-port the fix
themselves.

## Threat model overview

Procela's attacker model assumes:

  - Untrusted users on the public internet trying to brute-force
    credentials or reuse stolen ones.
  - A compromised customer device whose refresh token might be
    exfiltrated and replayed from a different network.
  - An IdP that may briefly misbehave (slow JWKS rotation, malformed
    assertions) without compromising Procela's session integrity.
  - An insider with admin access who must still be auditable.

It does **not** assume:

  - A compromised Procela server is recoverable in-place.
  - Side-channel attacks against the host kernel.
  - Hostile cloud KMS providers.

## Authentication

  - **Federated SSO** via OIDC (Microsoft Entra ID, Okta, generic)
    using Authorization Code + PKCE with JWKS verification, and SAML
    2.0 with signed assertions against a configured IdP certificate.
    Multi-IdP per install is supported for OIDC; SAML is single-IdP.
  - **Local credentials** stored as Argon2id hashes (`argon2` library
    defaults: memory cost 64 MiB, time cost 3, parallelism 4). Reset
    flows go through a single-use email-delivered token.
  - **MFA** via TOTP (RFC 6238, 30-second step, 6 digits) backed by
    `otplib`, with 10 single-use backup codes hashed at rest with
    Argon2id. The TOTP secret is encrypted at rest (see below).
  - **WebAuthn / FIDO2** for hardware keys and platform
    authenticators via `@simplewebauthn/server`, supporting both
    second-factor and discoverable-credential (passwordless) flows.
  - **SCIM 2.0** under `/scim/v2/` for IdP-driven user lifecycle
    events, bearer-token authenticated.

## Session security

  - Access tokens are short-lived JWTs (15 min in production, 8h in
    dev) signed with `JWT_SECRET`.
  - Refresh tokens are 8-hour JWTs tracked server-side by JTI.
  - **Refresh-token rotation** — every refresh revokes the previous
    JTI and mints a fresh one. A stolen token is only valid until
    the legitimate client next refreshes.
  - **Session binding** — refresh tokens are pinned to the IP subnet
    (/24 for IPv4, /64 for IPv6) and User-Agent at mint time.
    Mismatched origin on `/auth/refresh` revokes the token and
    forces a fresh sign-in.
  - **Active sessions UI** — users see every device they're signed
    in from and can revoke individual sessions or sign out
    everywhere.
  - **Idle-session timeout** — frontend auto-logs-out after
    `VITE_IDLE_TIMEOUT_MINUTES` (default 30; SOC 2 / HIPAA controls
    typically want 15) of no mouse/keyboard/scroll/touch activity.
    Activity is coordinated across browser tabs.
  - **RP-initiated logout** is supported for OIDC (id_token_hint to
    the IdP's end_session_endpoint) and SAML (SP-initiated SLO with
    NameID + SessionIndex). The IdP-initiated SLO endpoint
    (`/auth/saml/sls`) revokes matching local sessions and returns a
    signed LogoutResponse.

## Brute-force defences

Three layered controls sit in front of the credential verifier:

  - **IP-keyed rate limiter** on `/auth/login` — 5 attempts per
    minute and 20 per hour per (IP, email) pair.
  - **Per-account lockout** — 10 failed attempts inside a 30-minute
    window lock the account for 30 minutes. Tunable via
    `LOCKOUT_THRESHOLD`, `LOCKOUT_WINDOW_MS`, `LOCKOUT_DURATION_MS`.
  - **CAPTCHA challenge** after 3 IP-level failures inside 15
    minutes. hCaptcha when `HCAPTCHA_SECRET` is set, dev fallback
    otherwise.

## Authorisation

  - Role-based access control with six roles: `SUPER_ADMIN`,
    `ORG_ADMIN`, `PROCESS_OWNER`, `DATA_STEWARD`, `CONTRIBUTOR`,
    `VIEWER`.
  - **Per-org role overrides** — a Person can hold different roles
    in different orgs. Resolution at token-mint time prefers an
    org-specific entry over the person's default role.
  - **Org-scoped visibility** — every value stream, data asset, and
    system is owned by exactly one org. Visibility rolls down the
    org tree but never sideways between siblings. Editing is local
    to the owning scope; the level guard is enforced server-side.

## At-rest encryption

  - **TOTP secrets** are encrypted before persistence using either
    a local AES-256-GCM key derived from `MFA_ENCRYPTION_KEY` via
    scrypt, or one of three cloud KMS providers (`KMS_PROVIDER=
    aws-kms|azure-kv|gcp-kms`). The ciphertext envelope (`enc:v1:`,
    `enc:aws:v1:`, etc.) is self-describing so a record can be
    decrypted after the operator switches providers.
  - **OIDC client secrets and SMTP passwords** can be stored
    encrypted in `.env` using the same envelope. Operators encrypt
    once via `POST /api/v1/auth/encrypt-secret` (admin-only) and
    paste the `enc:v1:…` envelope into their env file.
  - **Per-tenant AI provider keys** — when an org sets its own AI
    provider (Settings → AI), the API key is encrypted before
    persistence with the same crypto service and envelope. It never
    rides along on org read paths — only an `apiKeyConfigured` boolean
    is returned.
  - **Password hashes** use Argon2id and are never returned to the
    client (a `publicPerson()` projection strips them on every
    read path).
  - **Backup codes** are Argon2id hashes, single-use, removed on
    consumption.

## AI data-egress control

Server-side AI calls send org context (catalog summaries, process and
data metadata) to the configured model provider. `AI_FEATURES_ENABLED`
(default on) is a single deployment kill-switch: set it to `false` and
the backend refuses every AI endpoint and the frontend hides every AI
entry point, so no catalog data leaves for an external model — the
control an on-prem / FedRAMP deployment flips to guarantee model
isolation. When AI is on, which vendor receives the data is set by
`AI_PROVIDER` (Anthropic by default) or per-tenant config, and provider
credentials are held server-side only (see At-rest encryption). AI calls
are never made from the browser.

## Audit log

  - Every create / update / delete across the catalog is captured
    with the actor, timestamp, before / after payload, and target
    entity.
  - **Hash chain** — each entry carries `prevHash` and
    `entryHash = sha256(prevHash + canonicalised content)`. Any
    in-place mutation, reordering, insertion, or deletion breaks
    the chain at the first affected row. `GET /audit/verify` walks
    the chain on demand and returns `{ valid, brokenAt, total,
    reason }`.
  - **Tombstoning on GDPR erasure** — when the right-to-be-forgotten
    cascade scrubs personal identifiers from authored entries, the
    chain is re-computed from the first modified row onward so the
    verifier still passes against the redacted log.

## GDPR — Article 17 cascade

`POST /api/v1/people/:id/forget` runs the right-to-be-forgotten
cascade. It deletes the Person record, scrubs every reference
across the data stores (ownership, stewardship, group membership,
mentions, authored comments), and tombstones audit log entries
authored by the user. The endpoint requires a typed-confirmation
phrase (`FORGET <email>`) to defend against accidental triggers and
returns a blast-radius summary. In-memory route caches are
refreshed automatically via the persistence reload registry.

## Transport and HTTP hardening

  - **HSTS** (in production) with one-year max-age and
    includeSubDomains.
  - **CSP** with explicit allowlists for scripts, styles, fonts,
    images, and connect-src.
  - **X-Frame-Options: DENY**, **X-Content-Type-Options: nosniff**,
    Referrer-Policy: strict-origin-when-cross-origin.
  - **CORS** is allowlist-based — `APP_URL` plus
    `CORS_ALLOWED_ORIGINS`. The dev fallback echoes the request
    origin; production must set at least one allowed origin or
    cross-origin browsers are blocked.

## Operational concerns (in progress)

The controls above ship today (PostgreSQL persistence with `org_id`
enforcement, Docker Compose, and OIDC / SAML / MFA integration tests are
all in place). The items below are architected for but not yet wired.
See `README.md` and `docs/STATUS.md` for the production-readiness
backlog.

  - JWT secret rotation with an overlap window.
  - MFA encryption key rotation by re-encrypting every record under
    the new key.
  - Multi-IdP SAML (OIDC already supports multiple IdPs per install).
  - CSP report-uri endpoint.
  - Subresource Integrity hash on the dynamically loaded hCaptcha
    script.

## Cryptographic primitives

  - **Password hashing**: Argon2id via `argon2`.
  - **Symmetric encryption**: AES-256-GCM (local) or cloud KMS
    envelope.
  - **Key derivation**: scrypt (N=16384, r=8, p=1) for the local
    AES master key.
  - **Audit chain**: SHA-256.
  - **JWT signing**: HS256 with `JWT_SECRET`.
  - **PKCE**: S256.
  - **TOTP**: SHA-1 HMAC, 30-second period, 6 digits (RFC 6238).
