# Procela — Go-to-Market Kit

Everything needed to generate interest, run demos, and convert the first
paying customers through a **founder-led, design-partner-first** motion.

This kit assumes what `docs/STATUS.md` says is true today: the product is
functionally near-complete (67 of ~80 capabilities Built), but it has never
run in production against a real customer, there is no multi-tenant SaaS
hosting, no billing subsystem, and the legal content is placeholder. That
shapes everything here. **We are not selling self-serve SaaS. We are
recruiting 6–10 design partners into white-glove, single-tenant pilots.**

---

## The documents

| Doc | What it's for |
|---|---|
| [`GTM_PLAN.md`](./GTM_PLAN.md) | Positioning, ICP, target list, channel plan, funnel math, 90-day calendar, budget, metrics |
| [`MESSAGING.md`](./MESSAGING.md) | The words. Positioning statement, per-persona value props, proof points, objection handling, competitive framing |
| [`EMAIL_CAMPAIGNS.md`](./EMAIL_CAMPAIGNS.md) | Nine ready-to-send sequences with full copy, plus deliverability and CAN-SPAM/GDPR guardrails |
| [`DEMO_PROGRAM.md`](./DEMO_PROGRAM.md) | Four online demo formats, run-of-show, tech checklist, follow-up SLA |
| [`DESIGN_PARTNER_PROGRAM.md`](./DESIGN_PARTNER_PROGRAM.md) | The reduced-licensing POC offer: tiers, pricing anchors, what each side commits, success criteria, agreement outline |
| [`READINESS_GATES.md`](./READINESS_GATES.md) | What must be true before each motion turns on. Read this before sending the first email |

Related existing material: [`../demo-playbook.html`](../demo-playbook.html)
(the 45-minute Tidewater demo script), [`../TRAINING.md`](../TRAINING.md)
(12-module product walkthrough), [`../CUSTOMER_ONBOARDING.md`](../CUSTOMER_ONBOARDING.md)
and [`../PILOT_GO_LIVE_WORKSHEET.md`](../PILOT_GO_LIVE_WORKSHEET.md)
(how a real tenant gets stood up).

---

## The strategy in one paragraph

Every data-governance tool on the market starts at the data and asks the
business to catch up. Procela starts at the business process and lets the
data follow — and it is the only platform of the five benchmarked that can
generate a client's entire industry process hierarchy with AI in ninety
seconds, live, on a first call. That ninety seconds is the whole marketing
strategy: it is a demo moment no competitor can reproduce, it works cold, it
works on a webinar, and it works in a screen-share with a stranger. So:
build a tight list of 400–600 named people in eight industries, email them a
specific and falsifiable promise, get them onto a 20-minute screen share,
generate *their* hierarchy in front of them, and close 6–10 of them into a
90-day Founding Partner pilot at a steep, time-boxed licensing discount in
exchange for a reference, a case study, and roadmap access.

---

## Start Monday — the first two weeks, in order

**Before any of this, read [`READINESS_GATES.md`](./READINESS_GATES.md).**
Two items there (real legal text, a hosted demo environment) genuinely block
outbound, and both are days of work, not weeks.

### Week 1 — infrastructure for the motion

1. **Buy a separate sending domain.** `procelahq.com` or `go-procela.com` —
   never the primary domain. Cold email burns domain reputation; keep the
   burn off the domain your product and investors use.
2. **Set up SPF, DKIM and DMARC** on it, create three mailboxes
   (`firstname@`, `firstname.lastname@`, `hello@`), and start automated
   warmup the same day. Warmup takes 14–21 days and cannot be shortcut —
   this is why it is step 2 of week 1, not week 3.
3. **Stand up the hosted demo tenant.** One always-on environment seeded
   with Tidewater Utilities and Momentum Industries, reachable at
   `demo.procela.io`, so you never demo from a laptop over hotel wifi.
   (`docs/PILOT_GO_LIVE_WORKSHEET.md`, fast path.)
4. **Replace the placeholder legal text** — ToS, privacy policy, and a real
   DPA template. You cannot sign a pilot with a utility or a defense
   supplier without these, and their procurement will ask on call two.
5. **Write the list.** 150 named contacts to start, not 1,500. Name, title,
   company, industry, and one specific *trigger* per row (see
   `GTM_PLAN.md` § Target list).

### Week 2 — assets and first contact

6. **Record the 6-minute asynchronous demo** (see `DEMO_PROGRAM.md`,
   Format 0). This is the single highest-leverage asset you will make. Every
   cold email links to it.
7. **Generate the eight industry template packs** using Procela itself —
   one PDF per supported industry, each a full value-stream hierarchy. These
   are your lead magnets, produced by the product, which is the proof.
8. **Publish the Founding Partner page** on the website with the offer, the
   ten slots, and an application form.
9. **Send the first 25 emails by hand**, personally, from your own mailbox —
   not the sequencer. Read every reply. Rewrite the copy based on what the
   first 25 tell you, *then* turn on the sequencer at 30/day/mailbox.
10. **Book the first "Procela in 20 Minutes" public demo** for three weeks
    out and start filling it.

Everything after that is in the 90-day calendar in `GTM_PLAN.md`.

---

## The one rule

**Do not sell more pilots than you can deliver.** Three concurrent design
partners is the realistic ceiling for a founder-led team until Track B
(production hardening, HA Postgres, DR rehearsal) is finished. Sell the
fourth and fifth into a scheduled *cohort* with a start date — scarcity is
honest here, and a waitlist converts better than an overloaded delivery
team. A pilot that goes badly with a utility will be known to every other
utility in the region within a quarter. This market talks.
