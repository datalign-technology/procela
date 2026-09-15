# Procela Founding Partner Program

*The proof-of-concept offer: a 90-day pilot at no licence cost, in exchange
for engagement, feedback and a reference — followed by deeply discounted,
rate-locked commercial terms.*

This is the primary commercial motion for the next two quarters. Everything
in `GTM_PLAN.md` and `EMAIL_CAMPAIGNS.md` funnels here.

---

## 1. Why this offer, and not a free trial

A free trial is the wrong instrument for this product and this buyer.

- The product's value appears only after a real value stream is mapped and a
  real source is connected. That is a guided exercise, not a self-serve one —
  and self-serve onboarding isn't built (`STATUS.md` Track C2).
- The buyer is a regulated enterprise. They do not evaluate by signing up;
  they evaluate by running a scoped pilot with a named sponsor.
- We need two things money can't buy right now: the first real-customer
  connector run (`STATUS.md` A1 — the open P0 that validates the entire
  Phase-3 thesis) and referenceable logos. A design-partner structure trades
  licence revenue for exactly those.

**The honest framing for the customer:** *"You're getting a platform that's
feature-complete but hasn't run in production against a real customer yet.
That's why the terms are what they are. You get founding pricing and direct
influence on the roadmap; we get the first real deployment and your honest
assessment of it."*

Say that out loud. Sophisticated buyers respect it, and it pre-empts the
discovery that would otherwise happen in their security review.

---

## 2. The offer

### Slots

**Ten total, allocated by industry:**

| Industry | Slots |
|---|---|
| Utilities (electric / gas / water) | 3 |
| Defense & shipbuilding | 2 |
| State & local government | 2 |
| Healthcare | 1 |
| Manufacturing / oil & gas / transportation | 2 |

The scarcity is real, not a tactic: three concurrent pilots is the delivery
ceiling for a founder-led team until Track B (HA Postgres, on-prem smoke
deploy, load-test baseline, external pen test, DR rehearsal) is done. Run
them as **cohorts of three with staggered start dates** and maintain a
waitlist. A waitlist converts better than an overbooked calendar, and an
overbooked calendar produces a bad pilot — which in these reference-dense
industries costs more than the revenue it earned.

### Scope of a pilot

| Dimension | Pilot scope |
|---|---|
| Duration | 90 days from kickoff |
| Breadth | **One value stream, one division** |
| Users | Up to 25 named users |
| Data sources | **One** live read-only connection (relational DB, warehouse, or dbt manifest), plus CSV import for anything else |
| Deployment | Customer's AWS account, customer's data centre, or a Procela-managed single-tenant stack — customer's choice |
| Support | Named contact, same-business-day response, weekly 30-minute working session |
| Licence cost | **$0 for the 90 days** |

**Deliberately out of scope** (protects both sides; put it in writing):

- Enterprise-wide rollout or more than one division
- Custom development or bespoke integrations
- Production system-of-record use, or reliance on Procela for a regulatory
  filing during the pilot
- Migration of an existing catalog
- Anything requiring CUI, ITAR or export-controlled data. Pilots use
  metadata and business descriptions, not regulated content.

---

## 3. What each side commits

Write these into the agreement. A pilot without a named sponsor and a weekly
slot is a pilot that dies at day 40, and the failure will look like a product
failure when it was an engagement failure.

### The customer commits

| Commitment | Detail |
|---|---|
| **Executive sponsor** | Named individual, ~2 hours/week, attends kickoff, day-45 review and day-90 readout |
| **Working lead** | A data steward or process owner, ~4 hours/week |
| **Weekly session** | 30 minutes, same slot, whole 90 days |
| **One source connection** | Read-only credentials for one database, scoped to a schema. The edge connector reads metadata only |
| **Feedback** | Honest, including the negative. A structured interview at day 30, 60 and 90 |
| **Reference rights** | Logo use, one reference call per quarter for 12 months, and a written case study — **all conditional on the pilot meeting its agreed success criteria** |

The conditionality matters. Never ask for a reference for a pilot that
didn't work, and say so up front — it makes the ask credible.

### Procela commits

| Commitment | Detail |
|---|---|
| **Deployment** | We stand up the environment. Customer's infrastructure or ours |
| **Onboarding** | Two 90-minute sessions using `docs/TRAINING.md` |
| **Data loading** | We generate the process hierarchy, import their CSVs, configure the connector |
| **Named support** | Same-business-day response, direct line to an engineer, no ticket queue |
| **Roadmap influence** | Two feature requests prioritised into the next two releases |
| **Price lock** | 50% of list for year one, rate locked 3 years with max 5% annual uplift |
| **Data portability** | Full export via documented REST API at any time, including at exit. Their process model is theirs, pilot outcome regardless |
| **No-fault exit** | Cancel any time in the 90 days, no cost, no clawback, keep the model |

---

## 4. Success criteria — agreed before kickoff

**Never start a pilot without these written down and signed off by the exec
sponsor.** An unmeasured pilot ends in "it was interesting" and no purchase
order. Pick 4–6, tailored to what they said in discovery.

### The standard set

| # | Criterion | Target | Measured by |
|---|---|---|---|
| 1 | Priority value stream fully modelled | 100% of processes and activities | Process catalog |
| 2 | Named owner on tier-1 activities | ≥ 80% | Ownership gap report |
| 3 | Data assets registered and mapped to steps | ≥ 50 assets, ≥ 70% of tier-1 steps mapped | Gap detection |
| 4 | Live source discovered and reconciled | ≥ 1 source, 100% of in-scope schema | Connector event log |
| 5 | Governance roles assigned (RACI complete for value stream) | 100% | RACI matrix |
| 6 | Gap report delivered to exec team | 1 report, presented | Day-90 readout |
| 7 | Active business users | ≥ 10 of 25 logged in during final 30 days | Audit log |
| 8 | Time to answer "what data supports process X, and who owns it" | < 2 minutes, from < 1 day today | Timed, live, at readout |

Criterion 8 is the one to fight for. It is the whole value proposition
expressed as a measurable before/after, and it is the line that goes in the
case study.

### Industry-specific additions

- **Utilities:** every activity in the value stream carries a criticality
  tier and an RTO; the rate-case-relevant data assets are traced to source.
- **Defense:** CMMC-relevant data flows documented with ownership; supplier
  data dependencies mapped.
- **Government:** records-retention policy attached to each asset class;
  audit-finding remediation traceable.
- **Healthcare:** PHI-bearing assets classified with sensitivity tags
  accepted or rejected by a named steward.

---

## 5. Pricing

> **These are anchors to validate, not settled prices.** Test them in the
> first ten discovery calls. The number you are looking for is the one nobody
> flinches at and nobody accepts instantly. Update this section monthly with
> what you actually learn — see `GTM_PLAN.md` § 8.

### List price (the anchor the discount is measured against)

You cannot offer "50% off" without a list price. Publish or at least state
one consistently.

| Tier | Annual list | Includes |
|---|---|---|
| **Governance Starter** | **$36,000** | 1 division, up to 50 named users, 2 source connections, standard support |
| **Standard** | **$78,000** | 3 divisions, up to 200 users, 10 connections, edge connector, SSO/SCIM, priority support |
| **Enterprise** | **$150,000+** | Unlimited divisions and users, unlimited connections, on-prem or dedicated single-tenant, custom SSO, named CSM |

**Context:** Collibra and Alation enterprise deals commonly land between
$150k and $500k+ annually. Positioning Standard at $78k is deliberate — it
sits below the threshold that triggers a full competitive RFP at most
mid-market organisations, while being high enough to signal enterprise
seriousness. Both properties matter.

### Founding Partner terms

| Period | Price | Note |
|---|---|---|
| Days 0–90 (pilot) | **$0** | Full functionality within the scoped division |
| Year 1 (if they continue) | **50% of list** | Standard tier → $39,000 |
| Years 2–3 | **50% of list, locked** | Max 5% annual uplift |
| Year 4+ | Renegotiated at then-current list | With a stated loyalty discount floor |

**Expansion is where the real revenue is.** A pilot at one division that
succeeds becomes an enterprise agreement at renewal. Price the pilot to get
in; price the expansion at value.

### Discount discipline

- **Never discount below 50% of list.** Below that, the Founding Partner
  designation stops meaning anything and every subsequent deal anchors to the
  floor you set here.
- **Trade discount for something every time** — a multi-year term, a case
  study, a reference call, payment up front, a logo, an introduction to a
  peer organisation. A discount given for nothing teaches the buyer the price
  was fiction.
- **Time-box it.** Founding Partner terms are available until the tenth slot
  is filled or a stated date, whichever comes first. Then they are gone, and
  they must actually go — a deadline you extend is a deadline nobody believes
  again.

### Practical note on billing

There is no billing subsystem (`STATUS.md` C1, backlog #20). For ten pilots
that is fine — **invoice manually on a standard MSA + order form**. Do not
build billing for this. Revisit only if the motion turns self-serve, which
this plan explicitly recommends against for now.

---

## 6. The 90-day pilot plan

| Phase | Days | What happens | Gate |
|---|---|---|---|
| **Kickoff** | 0–7 | Environment stood up (`PILOT_GO_LIVE_WORKSHEET.md` fast path). SSO wired. Exec sponsor session: confirm success criteria, pick the value stream. | Users can log in via their own SSO |
| **Define** | 7–21 | Generate the industry hierarchy. Working sessions to edit it into their reality. Assign owners. | Value stream modelled end to end |
| **Connect** | 21–45 | Register systems and data assets. Map assets to steps, accepting or overriding AI suggestions. Install the edge connector against the one agreed source. | Source discovered; assets reconciled into the catalog |
| **Day-45 review** | 45 | Exec sponsor session against the success criteria. **Honest mid-point.** If it's off track, say so and fix the engagement now. | Written status against each criterion |
| **Govern** | 45–75 | RACI complete. Governance tasks and issues in use. DQ rules on the top assets. Gap detection run and triaged. | Gap report drafted |
| **Prove** | 75–90 | Gap report finalised. Case-study interview. Day-90 readout to the exec team, including the timed "what data supports process X" demonstration. | Criteria scored; commercial conversation opened |
| **Convert** | 90–105 | Proposal issued within 5 days of readout. Reference and case study collected if criteria met. | Signed order form, or a documented reason it didn't convert |

**Two hard rules:**

1. **The day-45 review is not optional and is not a status email.** It is a
   live session with the exec sponsor. Most pilots that fail were visibly
   failing at day 45 and nobody said it.
2. **The commercial conversation opens at day 75, not day 90.** A readout
   with a proposal already in flight converts; a readout followed by "so,
   what do you think?" enters a budget cycle and dies.

---

## 7. Agreement structure

Have counsel draft these. The outline of what each needs to contain:

### Pilot agreement (the 90 days)

- Scope: one value stream, one division, 25 users, one source, 90 days
- Licence: no fee, non-exclusive, non-transferable, pilot use only
- **Data handling:** what the connector reads (metadata only — asset names,
  row counts, freshness timestamps), what it never reads (data values,
  credentials), transport (one-way outbound HTTPS), where data resides, and
  whether any AI provider is invoked — plus the option to run with
  `AI_FEATURES_ENABLED=false` or the customer's own AI vendor and key
- **Success criteria as a schedule**, signed by the exec sponsor
- Mutual NDA
- **Reference and case-study rights, conditional on criteria being met**,
  with customer approval of any published text
- IP: customer owns their process and data models; Procela owns the platform;
  aggregated and anonymised learnings are Procela's
- No-fault termination by either side with 10 days' notice, no cost
- **Data export on exit**, in a documented format, within 15 days
- Liability capped at a nominal amount — it is an unpaid pilot; do not accept
  enterprise liability terms for zero revenue
- Explicit exclusion of CUI / ITAR / export-controlled / PHI data values

### Commercial agreement (year one onward)

Standard SaaS MSA plus order form, with these specifics:

- Founding Partner pricing schedule and the 3-year rate lock with 5% cap
- Named-user or division-based metric (pick one; be consistent across all
  ten partners or you will never be able to publish a price)
- Support SLA — response times, not uptime, if self-hosted
- Uptime SLA **only if Procela-hosted**, and only one you can actually meet.
  Do not sign 99.9% before the DR rehearsal is done (`STATUS.md` B5)
- Security addendum: SSO/SCIM/MFA/encryption-at-rest/audit, **and an honest
  statement of what certifications do not yet exist**, with any committed
  dates you are genuinely willing to be held to
- DPA where personal data is in scope
- Source escrow clause if you're offering it — **arrange the escrow before
  promising it** (`MESSAGING.md` § 5)
- Roadmap-influence commitment: two prioritised requests per release cycle

---

## 8. What a good design partner looks like

Score prospects before offering a slot. **A bad design partner costs more
than no design partner** — they consume the delivery capacity that would have
produced a reference, and they generate a story that travels.

| Signal | Green | Red |
|---|---|---|
| Sponsor | Named exec who'll take the weekly slot | "We'll find someone" |
| Trigger | Dated external pressure — audit, rate case, CMMC deadline, migration | "General interest in modernising" |
| Program maturity | Year 0–2, currently in spreadsheets | Just bought a catalog last quarter |
| Data source | One clean relational source they can grant read-only access to in 2 weeks | "Security would need 6 months" |
| Reference willingness | Yes, conditional on success — no hesitation | "We never do references" |
| Procurement | Can sign a no-fee pilot without a full RFP | Requires SOC 2 Type II at signature |
| Scope behaviour | Accepts one value stream, one division | Wants enterprise rollout in 90 days |
| Culture | Will tell you what's broken | Polite, agreeable, non-committal |

**Three greens minimum, and a named sponsor is mandatory.** More than two
reds: politely decline the slot and offer the waitlist. Declining a bad
pilot is the highest-leverage decision in this entire program.

---

## 9. Turning a pilot into marketing

The pilot is not just revenue — it is the content engine for the next two
quarters. Plan the artifacts from day one, with consent captured in the
agreement.

| Artifact | Collected at | Used for |
|---|---|---|
| Baseline metrics (time to answer "who owns this", % processes documented, % assets with owners) | Day 0 — **capture these before you start or you have no before** | The case study's numbers |
| Quotes on the day-one problem | Kickoff | Email copy, landing page |
| Screenshot of their generated hierarchy (anonymised) | Day 14 | LinkedIn, demo |
| Day-45 mid-point quote | Day 45 | Nurture sequence |
| Gap report (anonymised, structure only) | Day 75 | Lead magnet |
| Final metrics vs baseline | Day 90 | The case study |
| Reference call willingness | Day 90 | Closing future deals |
| Written case study | Day 90–105 | Everything |

**The case-study structure that works:** the trigger (why now), the before
state with a number, what they did in 90 days, the after state with the same
number, and one quote from the exec sponsor about what changed. One page.
Nobody reads two.
