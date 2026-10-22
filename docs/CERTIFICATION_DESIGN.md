# Data Asset Certification — Design

Status: **Shipped — MVP + Phase 2.** The full workflow is live; the former
Phase 2 items (the "Certified" badge across lists, auto review task +
notifications on request, the hourly recertification sweep, and the Council
scorecard + Gap Detection integration) are all in. Section 9 records what
landed.

## 1. Problem

"Certified" is implicit today: it is the **Gold** governance tier, and Gold is
already gated on a *measured* health score at/above threshold. There is no
**act** of certifying — no request, no reviewer, no attestation, no expiry — so
an owner can't ask for sign-off and a CDO has no queue of things awaiting it.
This adds that workflow behind the board's **"Request certification"** action.

## 2. Core concept

Certification is a **reviewed promotion to Gold**, reusing the review-workflow
shape the app already uses for process activities (segregation of duties, a
pending state, an explicit approve/reject). An asset moves through a small
lifecycle; the tier flips to Gold only on approval, and the approval is an
*attestation* (who, when, until when) distinct from a raw manual tier edit.

```
 (NONE) ──request──▶ PENDING_REVIEW ──approve──▶ CERTIFIED (tier=GOLD, certifiedUntil=+12mo)
   ▲                      │                           │
   │                   reject                   revoke (tier→SILVER)
   └──────────────────────┴───────────◀───────────────┘
```

## 3. Decisions (chosen defaults)

1. **Readiness: soft-flag, not hard-block.** Anyone eligible may request even
   when the Gold bar isn't fully met; the failing checks are shown to requester
   and reviewer, and the reviewer is the real gate. The one hard guard: an asset
   with **no owner** can't be requested (certifying an unowned asset is
   meaningless).
2. **Approver: CDO / Data Governance Lead _or_ the asset's domain Data Owner.**
   Scoped to the domain so certification isn't a single CDO bottleneck, while
   keeping accountability. Segregation of duties always holds — the requester
   can never be the approver, admins included.
3. **Recertification: 12-month term; expiry flags, doesn't auto-demote.** Past
   `certifiedUntil` the asset reads "Recert due" (still Certified) rather than
   silently losing its badge. Demotion happens only on an explicit reject/revoke.
   *(Shipped: the hourly scheduler flags expired certs with a recert-due signal
   and re-opens a task.)*
4. **Manual Gold stays, but only attested certs count.** Admins may still set
   `tier = GOLD` directly (migrations, imports, legacy). The scorecard, badges
   and "Certified" signals count **`certificationStatus = CERTIFIED`** (has a
   reviewer + date), so the manual path is pragmatic but doesn't inflate the
   governance number. *(Shipped: Gap Detection nudges "Gold but not certified"
   into the flow.)*
5. **Ship the MVP first.** Self-contained, mergeable, independently useful.

## 4. Data model (additive, nullable/defaulted — existing rows migrate clean)

On `DataAsset`:

| Field | Type | Meaning |
|---|---|---|
| `certificationStatus` | `NONE` \| `PENDING_REVIEW` \| `CERTIFIED` (default `NONE`) | workflow state |
| `certificationRequestedById` / `…At` | id / timestamp | who requested, when |
| `certificationReviewedById` / `…At` | id / timestamp | who decided, when |
| `certifiedUntil` | timestamp? | recert due date (approve + 12 months) |
| `certificationNote` | text? | request justification / reviewer rationale |

The `…ById` identity is the resolved **person id** when the caller is linked to
a Person, else the auth subject — so segregation holds for admins without a
Person record too.

## 5. Readiness gate ("the Gold bar")

Computed from data the app already has, shown live on the asset so the ask is
informed (soft-flag, §3.1): owner assigned · steward assigned · in a domain ·
sensitivity classified · definition present · health score ≥ the Gold
threshold. The reviewer sees any gaps and rejects with a reason, which feeds the
backlog — the same signals Gap Detection surfaces.

## 6. RBAC + segregation

- **Request:** asset owner/steward, or an admin. Blocked when the asset has no
  owner.
- **Approve / reject:** CDO or Data Governance Lead (org-scoped DAMA role), or
  the asset's domain Data Owner (the domain's owner, or a `DATA_OWNER` role
  scoped to that domain), or an admin. Must differ from the requester.
- **Revoke:** a reviewer or admin, on a `CERTIFIED` asset.
- Every transition is written to the hash-chained audit log (before/after),
  like all mutations.

## 7. API

```
POST /api/v1/data-assets/:id/certification/request   { note? }            → PENDING_REVIEW
POST /api/v1/data-assets/:id/certification/approve    { note?, months? }  → CERTIFIED, tier=GOLD, certifiedUntil
POST /api/v1/data-assets/:id/certification/reject     { note }            → NONE (tier unchanged)
POST /api/v1/data-assets/:id/certification/revoke     { note? }           → NONE (tier → SILVER)
GET  /api/v1/data-assets/certification-queue?orgId=…                      → assets in PENDING_REVIEW
```

Each validates tenant access, RBAC, segregation and the state precondition,
stamps the fields, audits, and returns the updated asset.

## 8. UI

- **Asset detail:** a **"Request certification"** header action (owner/steward,
  when `NONE`); a status pill + **Approve / Reject** for a reviewer when
  `PENDING_REVIEW`; a "Certified · recert due <date>" line with **Revoke** when
  `CERTIFIED`. The readiness checklist renders inline.
- **Reviewer queue:** a "Pending certification" attention card + filter on the
  Data Assets list (the CDO's inbox), backed by the queue endpoint.
- **Signals (shipped):** a distinct "Certified" / "recert due" badge across the
  asset lists (registry, data domains, systems); the attested count feeds the
  Council scorecard "Certified coverage" value driver and a Gap Detection "Gold
  but not certified" check.

## 9. Phasing

Both phases have shipped.

- **MVP (#979):** fields + request/approve/reject/revoke + RBAC + segregation +
  audit + asset-detail actions + readiness checklist + the Data-Assets
  pending-certification card/filter. Demo seed ships one certified and one
  pending asset.
- **Phase 2:**
  - *Certified badge across lists (#980)* — a shared `CertifiedBadge` with a
    green "Certified", amber "recert due", and "pending" variant, on the Data
    Assets registry, Data Domains, and Systems detail lists (plus the asset
    detail). Dense relationship/graph views deliberately omit it.
  - *Review task + notifications on request (#981)* — a request opens an
    `APPROVAL` governance task assigned to the reviewer (domain Data Owner → CDO
    / Governance Lead) and fires a notification; approve/reject resolve the task
    and notify the requester. Rides the existing governance-work queue + bell.
  - *Recertification sweep (#982)* — an hourly, leader-gated scheduler job (plus
    an admin `POST …/certification/sweep-expired`) opens a `Recertify:` task +
    warning for certs past their term. Idempotent; never auto-demotes.
  - *Scorecard + Gap Detection (#983)* — a "Certified coverage" value driver on
    the Council scorecard (honours the All / Governed lens) and a "Gold but not
    certified" Gap Detection check.

### Possible follow-ups (not built)

- A seeded manual-Gold-but-uncertified demo asset so the Gap Detection check
  shows a non-empty state out of the box.
- A distinct "Certified" column in the report builder (register the fields on
  the `dataAssets` report entity).
- The badge on the remaining relationship/graph surfaces (process↔data map,
  lineage, enterprise view) if that density ever proves wanted.
