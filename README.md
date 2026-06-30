# Procela

A platform that connects business processes to the data and systems that support them. Process owners define how the work runs, data stewards register the assets behind each step, and Procela handles the governance — ownership, RACI, gap detection, audit trail, and federated SSO.

> **Prototype state.** The architecture below describes what's designed; the current build runs against JSON files under `.procela-data/` rather than PostgreSQL. The auth, MFA, SCIM, SAML, GDPR, audit, and at-rest encryption stacks are all real; the database swap is the next bigger production-readiness item. See [`SECURITY.md`](./SECURITY.md) for the security model and `CLAUDE.md` for the full architecture intent.

## Architecture overview

Monorepo with two packages:

- **`packages/backend`** — Express + TypeScript REST API. Handles authentication (Dev / Local / OIDC / SAML), authorisation, business logic, audit logging, SCIM provisioning, AI calls.
- **`packages/frontend`** — React + TypeScript + Vite SPA. Consumes the REST API; no direct database access.

## Tech stack

| Layer       | Technology                                                     |
|-------------|----------------------------------------------------------------|
| Backend     | Node.js, Express, TypeScript                                   |
| Frontend    | React, TypeScript, Vite, Zustand                               |
| Storage     | JSON files (prototype) — designed for PostgreSQL via Prisma    |
| Cache       | Redis (optional; falls back to in-memory rate limiter)         |
| AI          | Anthropic Claude API (`claude-sonnet-4-20250514`)              |
| Auth        | Argon2id, JWT, OIDC (PKCE), SAML 2.0, SCIM 2.0                 |
| MFA         | TOTP (`otplib`), WebAuthn / FIDO2 (`@simplewebauthn`)          |
| Crypto      | AES-256-GCM (local) + AWS KMS / Azure Key Vault / GCP KMS      |
| Email       | nodemailer (SMTP)                                              |

## Prerequisites

- Node.js 20+
- npm 9+
- Anthropic API key (optional — AI features degrade gracefully without)

## Quick start

```bash
git clone <repo-url> && cd Procela
cp .env.example .env
npm install
npm run dev
```

The frontend opens at `http://localhost:5173` and the API at `http://localhost:3001`. The first run drops a `.procela-data/` directory next to the backend; that's where every entity (people, orgs, processes, data assets, audit log) lives until the database swap lands.

To enable AI-driven features (industry template generation, data suggestions, the in-app assistant) drop your Anthropic key into `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

## Available scripts

| Script          | Description                                      |
|-----------------|--------------------------------------------------|
| `npm run dev`   | Start backend (3001) and frontend (5173)         |
| `npm run build` | Build both packages for production               |
| `npm test`      | Run tests across all packages                    |
| `npm run lint`  | Lint all packages                                |

## Authentication providers

Procela ships with four sign-in flows; pick one per deployment via `AUTH_PROVIDER`:

- **`dev`** — Email + optional name, no credential check. Local development only.
- **`local`** — Email + password stored as Argon2id hashes. Includes forgot-password by email, admin-set passwords with forced-change-on-first-login, and a one-click migration that generates temporary passwords for every existing user.
- **`oidc`** — Microsoft Entra ID, Okta, or any OIDC IdP. Multi-IdP per install. Authorization Code + PKCE, JWKS verification, RP-initiated logout.
- **`saml`** — SAML 2.0 SP-initiated SSO for ADFS, Shibboleth, PingFederate. SP metadata XML at `GET /api/v1/auth/saml/metadata`. SP- and IdP-initiated SLO supported.

All four can coexist on the login page (Local + one or more federated buttons). Switch between them at runtime via `Settings → Authentication`.

### MFA

- **TOTP** via Google Authenticator / 1Password / Authy / etc., with 10 single-use backup codes.
- **WebAuthn / FIDO2** for YubiKey, Touch ID, Windows Hello, and discoverable-credential (passwordless) sign-in.

Either factor satisfies the MFA gate; users can register both. Secrets are encrypted at rest via `MFA_ENCRYPTION_KEY` (local AES-256-GCM) or `KMS_PROVIDER=aws-kms|azure-kv|gcp-kms`.

### SCIM 2.0

IdP-driven user lifecycle (create on hire, deactivate on offboard, role updates) under `/scim/v2/`. Bearer-token authenticated via `SCIM_BEARER_TOKEN`. `/Users`, `/Groups`, full filter / PATCH / soft-delete semantics.

## Security at a glance

  - Argon2id password hashing, AES-256-GCM at-rest encryption for TOTP secrets / OIDC client secrets / SMTP passwords (or cloud KMS).
  - Three-layer brute-force defence: IP rate limiter → per-account lockout → CAPTCHA challenge.
  - Refresh-token rotation + IP-subnet binding; revoked sessions surfaced in the Active Sessions UI.
  - Helmet-driven CSP, HSTS, frame-deny; CORS allowlist.
  - Idle-session timeout (default 30 min; configurable).
  - Audit log with SHA-256 hash chain and on-demand verification.
  - GDPR Article 17 cascade (`/people/:id/forget`) with typed-phrase confirmation.

See [`SECURITY.md`](./SECURITY.md) for the full threat model, crypto choices, and reporting channel.

## Project structure

```
Procela/
├── packages/
│   ├── backend/           # Express API
│   │   ├── src/
│   │   │   ├── routes/         # HTTP handlers, one per entity
│   │   │   ├── services/       # auth, MFA, SCIM, SAML, GDPR, crypto, audit
│   │   │   ├── middleware/     # authenticateToken, authorize, rate-limit
│   │   │   └── lib/            # persistence, logger
│   │   └── package.json
│   └── frontend/          # React SPA
│       ├── src/
│       │   ├── pages/          # one per top-level route
│       │   ├── components/     # shared UI
│       │   ├── stores/         # Zustand: auth, org context, role drawer
│       │   └── api/            # typed fetch client
│       └── package.json
├── .procela-data/         # JSON store (created on first run)
├── .env.example           # Environment variable template
├── CLAUDE.md              # Architecture intent + handoff doc
├── SECURITY.md            # Security policy + threat model
└── README.md
```

## Documentation

  - **[`CLAUDE.md`](./CLAUDE.md)** — full architecture intent, deployment plans, AI behaviour guidelines.
  - **[`SECURITY.md`](./SECURITY.md)** — security model, controls, vulnerability reporting.
  - **In-app Help Guide** (`Settings → Help` or `/help`) — feature walkthrough for end users covering processes, data, governance, security, and the keyboard shortcuts.

## License

MIT
