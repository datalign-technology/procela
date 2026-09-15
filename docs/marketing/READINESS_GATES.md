# Readiness Gates — what must be true before each motion turns on

*Read this before sending the first email.*

Marketing that outruns delivery is the most expensive mistake available to a
company at this stage. The gates below are drawn from `docs/STATUS.md` and
the go-live checklist. Each motion has a small set of genuine blockers —
most of them are days of work, not months, and two of them are currently
unstarted.

---

## Gate 1 — Before the first cold email

**Blockers. Do not start outbound until all four are done.**

| # | Requirement | Why it blocks | Where |
|---|---|---|---|
| 1 | **Real ToS, privacy policy and DPA** — not placeholder | The moment someone replies, they will visit the site. A privacy policy with lorem-ipsum energy ends the conversation, and you cannot lawfully run outbound without a published privacy notice | `STATUS.md` C3 / checklist #18 |
| 2 | **Always-on hosted demo environment** | Every email links to a demo. Demoing from a laptop fails in front of a stranger, and it will be a stranger who matters | `PILOT_GO_LIVE_WORKSHEET.md` fast path |
| 3 | **Sending domain warmed, SPF/DKIM/DMARC set** | 14–21 days of lead time that cannot be compressed. Start day 1 | `EMAIL_CAMPAIGNS.md` § Deliverability |
| 4 | **Physical postal address on every email** | CAN-SPAM requirement. Registered agent or virtual office is fine | `EMAIL_CAMPAIGNS.md` § Legal |

**Strongly recommended, not strictly blocking:**

- The 6-minute async demo recorded (`DEMO_PROGRAM.md` Format 0) — outbound
  works without it, but roughly half as well
- A one-page Founding Partner page with an application form
- A CRM, even a simple one. By week 6 a spreadsheet will be losing deals

---

## Gate 2 — Before accepting the first pilot

**These are the fast-path items from the go-live checklist. Nothing here is
optional once a real customer's data is involved.**

| # | Requirement | Status today | Action |
|---|---|---|---|
| 1 | Postgres provisioned, migrations applied | Code complete; not deployed | `deploy/terraform/` or self-host PG 16+, then `prisma migrate deploy` |
| 2 | `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (RS256) | Code complete, **falls back to HS256 with a warning** | Generate an RSA keypair → Secrets Manager. Do not ship a pilot on the HS256 fallback |
| 3 | Identity provider config (SAML/OIDC) | Code complete; per-customer config | Wire to *their* IdP during kickoff week |
| 4 | `SMTP_*` | Falls back to audit log | Real relay. Notifications are half the product's daily value |
| 5 | HTTPS termination | — | ACM or Let's Encrypt |
| 6 | Backups + PITR | — | RDS automated backups, ≥14 days |
| 7 | Uptime monitoring on `/api/v1/health` | — | Any poller, alerting to a human |
| 8 | `KMS_PROVIDER` / `MFA_ENCRYPTION_KEY` | Code complete | Populate per environment |
| 9 | **Signed pilot agreement with success criteria schedule** | Not drafted | Counsel. See `DESIGN_PARTNER_PROGRAM.md` § 7 |
| 10 | **A rehearsed restore** | Runbook written, never rehearsed | Do one restore against staging before a customer's data exists. `DR_RUNBOOK.md` §7 |

**Item 10 deserves emphasis.** The DR runbook is written but has never been
executed. The first time you run it should not be the first time you need it.

---

## Gate 3 — Before the fourth concurrent pilot

Three concurrent pilots is the founder-led ceiling. Crossing it needs the
Track B work:

| Item | Status | Track |
|---|---|---|
| Managed / HA Postgres (replace single-replica StatefulSet) | Pending | B1 |
| On-prem smoke deploy — actually `helm install` it on a live cluster | Chart lints in CI only | B2 |
| Load-test baseline captured against Postgres | Harness built, no numbers | B3 |
| External penetration test | Internal review done; third party outstanding | B4 |
| DR rehearsal performed | Runbook only | B5 |

Until then: **cohorts with start dates and a waitlist.** Say so honestly —
*"We're running partners in cohorts of three so each one gets real attention.
The next cohort starts [date]."* That is both true and a better sales
posture than unlimited availability.

---

## Gate 4 — Before claiming anything in writing

Every public claim must be traceable to a *Built* row in `STATUS.md`. The
qualifier table in [`MESSAGING.md`](./MESSAGING.md) § 8 is the authoritative
list of what needs to be said out loud, unprompted.

The five that will end a deal if discovered rather than disclosed:

1. **No SOC 2, no FedRAMP.** Never imply otherwise, never say "in progress"
   unless an auditor is actually engaged.
2. **Multi-tenant SaaS is designed, not deployed.** Sell single-tenant — with
   this ICP it is an advantage, so lead with it rather than concealing it.
3. **On-prem Helm has never been installed on a live cluster.** Say it, and
   price the pilot accordingly.
4. **API and spreadsheet source discovery is simulated.** If a prospect's
   primary source is SharePoint or Google Sheets, that is a poor-fit pilot —
   say so and keep the relationship.
5. **DQ is measured for direct database connections and text files only.**
   Warehouse, object-store and Parquet/Avro quality is simulated today.

---

## The failure mode this document exists to prevent

Generating demand is the easy half. The expensive failure is a signed pilot
you cannot deliver: a utility whose security team finds the HS256 fallback,
a defense supplier who asks for the SOC 2 report you implied existed, or a
fourth concurrent pilot that starves the other three of attention.

In utilities, defense and state government, the buyers know each other. They
sit on the same association committees and they compare notes. **One badly
handled pilot is worth more negative pipeline than a quarter of cold email
is worth positive.**

Sell what's built. Disclose what isn't. Deliver three pilots extremely well
before selling a fourth.
