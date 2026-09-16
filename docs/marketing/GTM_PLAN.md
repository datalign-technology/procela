# Procela — Go-to-Market Plan

*Horizon: 90 days from start. Motion: founder-led outbound + design partners.*

> **Read [`OPERATING_PLAN.md`](./OPERATING_PLAN.md) first.** This document
> describes the motion at team scale — its volumes, its 6–10 pilot target and
> its calendar assume several people selling and delivering. `OPERATING_PLAN.md`
> is the calibrated version for one founder with seed funding and a runway
> clock: **one pilot in 90 days, warm contacts before cold email, and a
> specific list of what to cut.** Use this document for the *thinking* —
> positioning, ICP, personas, target sourcing, channel logic, diagnostics —
> and that one for the *numbers and the order*.

---

## 1. Positioning

### The category problem

"Data catalog" is a crowded, expensive, exhausted category. Collibra,
Alation, Atlan and Ataccama have spent a decade and a billion dollars
teaching buyers what a catalog is — and teaching them that catalogs fail.
The published failure rate is brutal and every buyer has a story: they
bought the platform, the data team populated 8,000 technical assets, the
business never logged in, and the program stalled at "we have a catalog
nobody uses."

**Do not compete in that category.** Entering as "a better catalog" means
competing on connector count (they have 200+, we have ~15) and losing.

### The category we do own

Procela is a **business process and governance operating system** that
happens to connect to data. The claim is:

> Governance programs fail because they start at the data. Procela starts at
> the business process — the thing your people actually recognise — and pulls
> the data in behind it.

This is defensible because it is *architecturally* true, not a marketing
skin. Look at the coverage matrix in `docs/STATUS.md`:

| Capability | Procela | Collibra | Alation | Atlan | Ataccama |
|---|---|---|---|---|---|
| Business value-stream / process model | **Built** | Partial | None | None | Partial |
| Process step ownership | **Built** | Yes | No | No | No |
| **AI industry templates** | **Built** | **No** | **No** | **No** | **No** |
| Process → data-asset mapping | **Built** | Partial | No | No | No |
| RACI / decision rights | **Built** | Add-on | No | No | No |
| SOPs / runbooks | **Built** | Add-on | No | No | Limited |
| Operations manuals | **Built** | Yes | No | No | No |
| Council scorecard (division rollup) | **Built** | Partial | No | No | Limited |
| Policy-exceptions register | **Built** | Yes | No | No | Limited |

Nine rows where the field is thin or empty. One row — **AI industry
templates** — where all four incumbents are a flat *No*. That row is the
wedge, and it is also the demo.

### Positioning statement

> For regulated, asset-heavy organisations standing up or restarting a data
> governance program, **Procela** is the platform that maps the business —
> value streams, processes, activities, owners, RACI — and then binds the
> data and systems to it. Unlike data catalogs, which ask the business to
> learn the data team's model, Procela generates your industry's process
> hierarchy with AI in ninety seconds and makes the data follow.

### The two sales motions

**Motion A — "Program in a box" (primary).** Target: organisations in year
0–2 of a governance program, currently running it in SharePoint, Visio and
Excel. They are not comparing us to Collibra; they are comparing us to a
spreadsheet and a consultant. Deal shape: $30–75k, 60–90 day cycle, champion
is the Head of Data Governance or a newly-hired CDO. **This is where the
first ten customers come from.** It is faster, cheaper to win, and the
competitive set is "do nothing."

**Motion B — "The business layer on top" (secondary).** Target: organisations
that already bought Collibra or Alation and stalled. We do not replace it —
we sit above it and give it the business context it never had. Deal shape:
$75–150k, 6–9 month cycle, needs a political sponsor. **Do not lead with
this in the first 90 days**, but recognise it when it walks in, because the
budget is already approved and the pain is acute.

---

## 2. Ideal customer profile

### Firmographics

- **Revenue:** $500M – $5B. Below that, no governance budget. Above that,
  procurement will take nine months and demand a SOC 2 Type II we don't have.
- **Employees:** 1,000 – 15,000.
- **Geography:** US first. (EU adds GDPR cold-contact friction; Canada adds
  CASL, which requires *express* consent and is strict. Start domestic.)
- **Data team size:** 5–40. Big enough to have a governance mandate, small
  enough that a 200-connector platform is absurd for them.
- **Deployment posture:** prefers or requires single-tenant / on-prem /
  VPC-isolated. This is a *strength* for us right now, not a weakness — the
  multi-tenant SaaS hosting isn't built, and this ICP doesn't want it anyway.

### Industry priority

Ranked by regulatory pressure × process-orientation × our template quality.

> A solo founder must also rank by **sales-cycle length**, which reorders this
> list — defense suppliers and mid-market manufacturing move to the top, state
> & local government drops out of direct selling entirely. See
> [`OPERATING_PLAN.md`](./OPERATING_PLAN.md) § 3.

| Rank | Industry | Why now | Entry trigger |
|---|---|---|---|
| 1 | **Utilities** (electric/gas/water) | Rate-case filings require auditable data provenance; AMI/smart-meter data explosion; NERC CIP; aging workforce means process knowledge is walking out the door | Rate case filing, AMI rollout, new CDO, NERC audit finding |
| 2 | **Defense & shipbuilding** | CMMC 2.0 certification deadlines; DFARS 7012; supplier data flowdown; program-level accountability is contractual | CMMC assessment date, new program award, DCMA finding |
| 3 | **State & local government** | Open-data mandates, records-retention law, ERP modernisation, and a genuine inability to answer "who owns this data" | ERP/SAP modernisation, auditor finding, new CDO/CIO |
| 4 | **Healthcare** (provider systems, payers) | HIPAA, Epic/Cerner migration chaos, M&A integration of acquired practices | EHR migration, merger, OCR audit |
| 5 | **Manufacturing** | S/4HANA migrations, supply-chain traceability, quality-system audits (ISO 9001/AS9100) | ERP migration, quality escape, new plant |
| 6 | **Oil & gas** | Asset-integrity data, environmental reporting, joint-venture data sharing | Regulatory reporting cycle, divestiture |
| 7 | **Transportation & logistics** | FMCSA/FRA data, network visibility | Merger, new TMS |
| 8 | **Financial services** | BCBS 239, CCAR — but a crowded incumbent market and the longest procurement cycle | Regulatory finding |

**Start with 1, 2 and 3.** Utilities and government are also *reference-dense*
markets — a named utility logo opens every other utility's door, because the
buyers all sit on the same association committees.

### Personas

| Persona | Title patterns | What they care about | What kills the deal for them |
|---|---|---|---|
| **Champion** | Head/Director of Data Governance, Data Governance Lead, Chief Data Steward | Proving the program is working to an exec who is losing patience. Coverage %, ownership %, a board slide | A tool their business users won't log into |
| **Economic buyer** | CDO, CDAO, VP Data & Analytics, sometimes CIO | Time-to-value, audit defensibility, not being the person who bought the last failed catalog | "Another 18-month implementation" |
| **Process sponsor** | VP Operations, Director of Process Excellence, Continuous Improvement | Process documentation that stays current; operational RTO/criticality; succession risk | Anything that looks like an IT project |
| **Blocker → ally** | CISO, Compliance, Privacy Officer | Where does data go, what leaves the network, who approved what | Cloud SaaS with unclear data handling → *lead with the edge connector: metadata only, one-way outbound HTTPS, no credentials, no data values* |
| **User** | Data steward, business analyst, process owner | Not having to learn a data model | A blank screen on day one → *lead with AI templates: it is never blank* |

### Disqualifiers — walk away fast

- No named governance owner. (Nobody to champion it; the pilot dies.)
- "We just need a catalog of our Snowflake tables." (We lose that on
  connectors. Refer them out, keep the relationship.)
- Requires SOC 2 Type II or FedRAMP *at contract signature*. We don't have
  either yet. Get the date, log it, nurture.
- Procurement demands multi-tenant SaaS with self-serve billing. Not built.
- Budget below $25k for year one. The delivery cost of a white-glove pilot
  exceeds it.

---

## 3. Target list

**Quality over volume, hard.** 400–600 named humans, not 10,000 scraped rows.
A 500-person list where each row has a *trigger* will outperform a
10,000-person list by an order of magnitude, and it will not get your domain
blacklisted.

### Row schema

```
first_name | last_name | title | company | industry | company_size |
trigger_event | trigger_source_url | persona | sequence | sending_mailbox
```

The `trigger_event` column is mandatory. If you can't fill it, the row isn't
ready. Examples that work: *"Named CDO in March 2026"*, *"Filed rate case
with the state PUC in July"*, *"CMMC Level 2 assessment scheduled Q1"*,
*"Announced S/4HANA migration on Q2 earnings call"*, *"Posted a Data
Governance Manager req three weeks ago"*, *"Auditor flagged data lineage in
the FY25 single audit"*.

### Where to source, per industry

- **Utilities** — EEI, AGA and AWWA member directories and committee rosters;
  state PUC rate-case dockets (public, searchable, tell you exactly who is
  under pressure and when); APPA member list for municipals.
- **Defense/shipbuilding** — NDIA and SNAME chapter rosters; SAM.gov award
  notices; DIB SCC; prime-contractor supplier days.
- **State & local** — NASCIO and NASACT membership; GFOA; state CDO offices
  (most publish names); single-audit findings, which are public record.
- **Healthcare** — CHIME; HIMSS chapters; state hospital associations.
- **Cross-industry** — DAMA International local chapters (this is where the
  champion persona *literally meets monthly*), EDW conference attendee lists,
  LinkedIn Sales Navigator saved searches on title + industry + company size.

### Hiring signals are the best signal

An open req for "Data Governance Manager", "Data Steward", or "Enterprise
Process Architect" is a public announcement that (a) budget exists, (b)
nobody owns this yet, and (c) the hiring manager is the champion. Monitor
these weekly across the ICP and treat them as inbound.

---

## 4. Channels — ordered by ROI for the next 90 days

### Tier 1 — do these now

1. **Founder-led cold email.** Detail in `EMAIL_CAMPAIGNS.md`. Highest
   control, lowest cost, fastest feedback loop on messaging.
2. **Warm network / first-degree LinkedIn.** Every former colleague, every
   ex-client, every investor's portfolio. The first two design partners will
   almost certainly come from here, not from cold. Ask for an intro, not a
   meeting: *"Who do you know running data governance at a utility?"*
3. **The public 20-minute demo** (biweekly, recurring, always on the
   calendar). Detail in `DEMO_PROGRAM.md`. It converts cold email replies
   that aren't ready for a 1:1 call and it gives every sequence a
   zero-commitment CTA.
4. **LinkedIn founder posting, 3×/week.** Not "thought leadership." Post
   artifacts: a generated utility hierarchy, a gap-detection screenshot, a
   before/after RACI matrix, the competitor coverage table. Show the product
   doing something. The algorithm rewards it and the ICP lives there.

### Tier 2 — start in month 2

5. **Industry association webinars.** EEI, AGA, AWWA, DAMA chapters, NASCIO
   and state government tech associations all run member webinars and are
   chronically short of speakers. They are free, pre-qualified, and carry
   third-party credibility a paid ad never will. Pitch a *vendor-neutral*
   session ("Why governance programs stall in the first 18 months") with
   Procela as a 10-minute case example at the end.
6. **Lead-magnet content.** The eight industry template packs — generate them
   with Procela itself, publish as gated PDFs. Self-demonstrating.
7. **Partner channel — boutique consultancies.** Regional data-governance and
   utility-consulting shops are already selling the *strategy*; they have no
   tooling to leave behind. Offer 20% year-one referral, or 30% resale. One
   good partner can out-produce all cold email.

### Tier 3 — month 3+, or only when funded

8. Conference sponsorship (EDW, Gartner D&A, industry-specific). Attend
   before you sponsor. A $2k attendee badge with 30 pre-booked meetings beats
   a $25k booth every time.
9. Paid search. The intent keywords ("data governance platform") are owned by
   incumbents at brutal CPCs. Skip it.
10. Analyst relations (Gartner/Forrester). Real, but a 12–18 month investment.
    Log it for next year; a briefing now is still worth 45 minutes.

---

## 5. Funnel math

Honest, conservative numbers for a well-targeted founder-led motion. Use
these to set expectations and to tell you which stage is actually broken.

### Outbound, per month at steady state

```
600 contacts emailed (3 mailboxes × 30/day × 20 working days ≈ 1,800 sends
                      across a 4-touch sequence = ~450–600 unique people)
  → 55%  open rate                          ≈ 330 opens
  → 6%   reply rate                         ≈ 36 replies
  → 35%  of replies positive                ≈ 12 positive replies
  → 65%  convert to a booked call           ≈ 8 discovery calls
  → 60%  advance to a tailored demo         ≈ 5 demos
  → 40%  advance to pilot proposal          ≈ 2 proposals
  → 50%  close                              ≈ 1 design partner / month
```

### Public demo, per session (biweekly)

```
150 registrations (email + LinkedIn + list)
  → 35% attend                              ≈ 52 attendees
  → 12% request a 1:1                       ≈ 6 tailored demos
  → 35% advance to proposal                 ≈ 2 proposals
```

### Blended 90-day target

> Team-scale. The solo-calibrated version — 250 contacts, 20 calls, **1 pilot**
> — is in [`OPERATING_PLAN.md`](./OPERATING_PLAN.md) § 2.

| Metric | Target |
|---|---|
| Unique contacts reached | 1,500 |
| Discovery calls | 45 |
| Tailored demos | 25 |
| Pilot proposals issued | 12 |
| **Design partners signed** | **6–10** |
| Referenceable case studies | 2 |

### Diagnostic thresholds

If a rate falls below the floor, fix *that* stage before adding volume:

| Rate | Floor | If below, the problem is |
|---|---|---|
| Open rate | 40% | Deliverability (domain warmup, spam words) or subject lines |
| Reply rate | 3% | Targeting or the first line. Not the CTA |
| Positive reply share | 20% | Wrong persona or an unbelievable promise |
| Call → demo | 50% | Discovery call is pitching instead of diagnosing |
| Demo → proposal | 30% | Demo isn't personalised — you're not generating *their* hierarchy |
| Proposal → close | 40% | Offer, price, or you're missing the economic buyer |

---

## 6. The 90-day calendar

Anchored to a start on **Mon 21 Sep 2026**. Phases matter more than dates.

### Phase 1 — Weeks 1–3: build the machine

| Week | Deliverable |
|---|---|
| 1 | Sending domain + SPF/DKIM/DMARC + 3 mailboxes + warmup started. Hosted demo tenant live at `demo.procela.io`. Real ToS/privacy/DPA drafted. First 150 list rows with triggers. |
| 2 | 6-minute async demo recorded. Founding Partner page published with application form. First 25 emails sent **by hand**. First 3 warm-network intro asks. |
| 3 | Copy revised from the first 25 replies. Eight industry template packs generated and published. First public demo scheduled for week 5 and promotion opened. LinkedIn posting begins (3×/week). |

**Gate to Phase 2:** ≥3 replies from the hand-sent 25, ≥1 discovery call
held, demo tenant survived a real screen-share with a stranger.

### Phase 2 — Weeks 4–8: turn on volume

| Week | Deliverable |
|---|---|
| 4 | Sequencer live at 30/day/mailbox on utilities segment only. List to 300 rows. |
| 5 | **First public "Procela in 20 Minutes."** Recorded and cut into three LinkedIn clips. Defense/shipbuilding segment added to outbound. |
| 6 | First pilot proposal issued. Association webinar pitches sent (EEI, AGA, 3 DAMA chapters, NASCIO). List to 450 rows. |
| 7 | **Second public demo.** State & local segment added. First partner conversation with a boutique consultancy. |
| 8 | **Target: first design partner signed.** Kickoff scheduled. Mid-point review of all six funnel diagnostics; rewrite whatever is below floor. |

**Gate to Phase 3:** ≥1 signed pilot, ≥15 discovery calls held, reply rate
above 3%.

### Phase 3 — Weeks 9–12: convert and prove

| Week | Deliverable |
|---|---|
| 9 | Pilot #1 in delivery. **Third public demo.** "Stalled catalog" sequence (Motion B) launched against Collibra/Alation users. |
| 10 | Pilots #2–3 signed. First association webinar delivered. First case-study interview with pilot #1 at day 30. |
| 11 | **Fourth public demo**, industry-specific (utilities deep dive). Referral program live with 2 partners. |
| 12 | Quarter close: 6–10 signed, 2 case studies drafted, next-quarter list built to 1,000 rows, pricing validated against 10 real conversations. |

---

## 7. Budget

A deliberately lean stack. Everything here is optional above the first four.

| Item | Monthly | Notes |
|---|---|---|
| Sending domain + Google Workspace × 3 mailboxes | $60 | Non-negotiable |
| Cold email sequencer (Instantly / Smartlead) | $100 | Includes warmup |
| Contact data (Apollo / Sales Navigator) | $150 | Sales Nav is better for this ICP |
| Demo environment hosting (AWS, single small stack) | $250 | Per `deploy/terraform/` |
| Webinar platform (Zoom Webinar or Livestorm) | $90 | Zoom Meetings works for <100; upgrade when registrations exceed it |
| CRM (HubSpot Starter or Attio) | $50 | Do **not** run this in a spreadsheet past week 6 |
| Scheduling (Cal.com / Calendly) | $15 | |
| Video recording/editing (Loom, Descript) | $40 | |
| **Total** | **~$755/mo** | ~$2,300 for the quarter |
| Legal — ToS/privacy/DPA review | $3–6k one-time | The one thing not to cheap out on |
| Optional: design for the template-pack PDFs | $1–2k one-time | |

Everything else — content, list-building, demos — is founder time.

---

## 8. Metrics and operating rhythm

### The weekly scorecard — seven numbers, every Monday

```
1. Contacts added to list (target 100/wk)
2. Emails sent
3. Reply rate %  /  positive reply count
4. Discovery calls held (target 4/wk)
5. Tailored demos held (target 2/wk)
6. Proposals outstanding
7. Pilots signed (cumulative)
```

Track them in one spreadsheet tab. If a number doesn't move for two weeks,
that stage is the constraint and it gets the whole week's attention.

### Monthly review — five questions

1. Which industry segment has the highest positive-reply rate? Double it.
2. Which subject line won? Kill the losers.
3. What objection came up most? It belongs in `MESSAGING.md` by Friday.
4. What did people ask for that we don't have? It belongs in `STATUS.md`.
5. What is the actual price people didn't flinch at? Update the anchors in
   `DESIGN_PARTNER_PROGRAM.md`.

### Leading indicators that the strategy is working

- Prospects use the phrase "business-first" or "process-first" back at you
  unprompted.
- Someone forwards the async demo internally without being asked.
- A prospect asks "can you generate ours?" before you offer.
- A second person from the same company registers for a public demo.

### Lagging indicator that it isn't

- Deals stall at "we already have Collibra" → you're in Motion B without
  the political sponsor. Requalify.
- Demos go well and then go quiet → no economic buyer in the room. Change
  the discovery script, not the demo.
