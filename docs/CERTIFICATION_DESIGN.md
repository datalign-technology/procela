# Data Asset Certification — Design

Status: **MVP shipping.** Phase 2 items noted inline.

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
   *(Phase 2: the hourly scheduler flips expired certs to a recert-due signal and
   re-opens a task.)*
4. **Manual Gold stays, but only attested certs count.** Admins may still set
   `tier = GOLD` directly (migrations, imports, legacy). The scorecard, badges
   and "Certified" signals count **`certificationStatus = CERTIFIED`** (has a
   reviewer + date), so the manual path is pragmatic but doesn't inflate the
   governance number. *(Gap Detection nudges "Gold but not certified" into the
   flow — Phase 2.)*
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
- **Signals (Phase 2):** a distinct "Certified" badge across lists; the attested
  count feeds the Council scorecard and a Gap Detection "Gold but not certified"
  check.

## 9. Phasing

- **MVP (this change):** fields + request/approve/reject/revoke + RBAC +
  segregation + audit + asset-detail actions + readiness checklist + the
  Data-Assets pending-certification card/filter. Demo seed ships one certified
  and one pending asset.
- **Phase 2:** auto governance task on request + notifications; recert expiry via
  the scheduler; Council + Gap Detection integration; "Certified" badge across
  every list.
