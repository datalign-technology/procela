# Procela — Online Demo Program

Five formats, from a six-minute recording that scales infinitely to a
two-hour working session that closes a pilot. Each has a different job.

The existing 45-minute presenter script — [`../demo-playbook.html`](../demo-playbook.html)
— is the source material for all of them. Formats below are cuts of it.

---

## The asset that does the most work

**Generating the prospect's own industry hierarchy, live.** Ninety seconds,
no slide, no competitor can reproduce it, and it converts a sceptical
audience in one beat. Every format below is built around getting to that
moment as fast as possible, and then earning the right to show what comes
after it.

Rule: **never demo the stock example if you know their industry.** Ask for it
in the confirmation email and generate theirs.

---

## Format 0 — The asynchronous demo (6 minutes, recorded once)

*The highest-leverage asset in the entire plan. Make it in week 2.*

**Job:** convert a cold email into a warm reply without a calendar. Most of
the ICP will watch six minutes at 11pm before they will grant twenty minutes
at 2pm.

**Run of show:**

| Time | Beat |
|---|---|
| 0:00–0:25 | **The problem, in their language.** "When a number is wrong, how long does it take to say which process broke, what data failed it and who owns it?" No logo, no intro, no "hi I'm." |
| 0:25–2:00 | **Generate a utility hierarchy from nothing.** Show the blank state, click the wand, let it fill. Then switch the active org from Electric to Water and do it again — same code, different output. This is the beat people rewatch. |
| 2:00–3:10 | **An activity carries weight.** Open Outage triage: named Responsible, SCADA + OMS, declared predecessor and successor, criticality tier 1, RTO 4h, success measure. |
| 3:10–3:50 | **The retirement question.** Click into Customer Master → Impact panel → activity/process/value-stream counts, expand to the per-person notify list. |
| 3:50–4:40 | **Ask AI.** "Which data assets does no process use?" Answer names the orphans with clickable citations and a one-click chip to the page that fixes it. |
| 4:40–5:20 | **The executive view.** Coverage, gaps, governance tiers by division. The slide that changes a budget conversation. |
| 5:20–6:00 | **The ask.** "If you want this generated for your industry, reply with the industry. Takes me ninety seconds and it's yours whether or not we ever work together." |

**Production notes:**

- Record in the hosted demo tenant, never a laptop dev server.
- Face camera in a corner for the first 20 seconds and the last 20. Presence
  at the bookends, product in the middle.
- Host where you get per-viewer analytics (Loom, Vidyard). Knowing someone
  watched 5 of 6 minutes is the strongest buying signal you will get from a
  cold sequence — follow up within the hour.
- **Re-record it every quarter.** A stale demo is worse than none.

---

## Format 1 — "Procela in 20 Minutes" (public, biweekly)

*The always-on CTA. Every sequence can point at it. Runs whether two people
register or eighty.*

**Cadence:** every other Thursday, 1:00pm ET. Put twelve of them on the
calendar now and never move them — a recurring public demo that sometimes
gets cancelled stops being credible.

**Format:** 20 minutes demo, 10 minutes live Q&A. No slides at all.

**Run of show:**

| Min | Beat | Source |
|---|---|---|
| 0–2 | Frame the problem. Ask attendees to drop their industry in chat. | — |
| 2–5 | **Generate a hierarchy live — for an industry from the chat.** This is the moment. Do it for a real attendee's industry, not the stock one. | Playbook beat 02 |
| 5–9 | Walk one activity: owner, tier, RTO, dependencies, inputs/outputs. | Beat 03 |
| 9–12 | Data Asset 360: sensitivity tags with accept/reject, impact blast radius, notify list. | Beat 03 |
| 12–15 | Ask AI on orphan assets — citations and the navigation chip. | Beat 04 |
| 15–18 | Gap detection + executive dashboard. | Beat 08/09 |
| 18–20 | The thesis + the Founding Partner offer, 60 seconds, once. | Beat 09 |
| 20–30 | Q&A. Answer every question. Stay until they stop. | — |

**Operating notes:**

- **Two people if possible:** presenter and a chat host. The chat host
  collects industries, answers logistics, and drops links. Solo works, but
  you will miss the industry requests in chat, which is the whole hook.
- **Record every session**, cut three 45–90 second clips for LinkedIn from
  each. One live demo produces two weeks of social content.
- Follow up the same day — attended and no-show copy is in
  `EMAIL_CAMPAIGNS.md` § 6d/6e.

---

## Format 2 — The tailored 1:1 demo (30–45 minutes)

*Where deals are actually made.*

### Before the call — non-negotiable prep (20 minutes)

1. **Generate their industry hierarchy in advance** and have it loaded in a
   second browser tab. You will still generate one live, but if the AI call
   is slow you have the prepared one to fall back to and the meeting never
   stalls.
2. **Research one trigger** — their rate case, their CMMC date, their ERP
   migration, their audit finding — and open with it.
3. **Know who is on the call and why.** If the economic buyer isn't on it,
   your goal is not to close; it is to equip the champion to bring them.
4. **Pre-flight the environment.** Run the setup checklist from
   `../demo-playbook.html` (sign in, seeded banner, sanity-check the
   dashboard counts). Zeros on screen kill a demo dead.

### Run of show

| Min | Beat |
|---|---|
| 0–10 | **Discovery. Do not open the product.** Four questions: (1) Where does your governance program live today, honestly? (2) Who's supposed to maintain it, and do they? (3) What triggered you taking this call now? (4) What would have to be true in ninety days for this to be worth it? **Write down their exact words** — you will use them in the follow-up email and the proposal. |
| 10–13 | **Generate *their* hierarchy, live.** Narrate it. Then: "Is that close? What's wrong with it?" — the critique is engagement, and a wrong branch is a better conversation than a right one. |
| 13–25 | **Demo only what maps to their stated pain.** If they said "we can't tell who owns things" → ownership, RACI, gap detection. If they said "audit" → audit trail, segregation of duties, policy exceptions. If they said "we don't know what data we have" → connector, discovery, reconciliation. **Do not tour the product.** A feature tour is how you lose a demo you had already won. |
| 25–32 | **The moment that lands for their persona** (see `MESSAGING.md` § 3). For ops it's the impact/notify list. For a CISO it's the connector event log and metadata-only guarantee. For a CDO it's the coverage dashboard. |
| 32–40 | Q&A, plus the qualifiers they're entitled to hear before they ask (see `MESSAGING.md` § 8). Volunteering a limitation before it's discovered buys more trust than any feature. |
| 40–45 | **Next step, specific and dated.** Never "I'll follow up." Either "Let's get your VP of Ops on a 30-minute version next Tuesday" or "Let me send the ninety-day pilot scope by Thursday — who else should be on it?" |

### After the call — within four hours

Send Sequence 7a from `EMAIL_CAMPAIGNS.md`, with their generated hierarchy
attached as a link. The four-hour SLA matters more than the content.

---

## Format 3 — The Gap Teardown (30 minutes, working session)

*The highest-converting format in this document. Use it when a prospect is
interested but not ready for a pilot conversation.*

**The pitch:** *"Give me thirty minutes and your org chart. I'll build one of
your value streams live and hand you the gap report at the end. Yours to
keep, no obligation."*

**Why it works:** it is not a demo, it is unpaid consulting, and it produces
an artifact with their name on it that circulates internally without you.

**Run of show:**

1. **0–5** — Which value stream matters most right now, and why that one?
2. **5–12** — Generate the hierarchy for their industry. Edit it live against
   their corrections. Let them drive the vocabulary; use their words for the
   node names.
3. **12–20** — Add the systems they name. Map data assets to steps. Ask
   "who owns this?" for each — and note every time they hesitate. **The
   hesitations are the sale.**
4. **20–26** — Run gap detection. Show the unmapped steps, the unowned
   assets, the ungoverned assets supporting tier-one activities.
5. **26–30** — Export the gap report. Send it before the call ends.

**Then:** *"That took thirty minutes and it's a fraction of one value stream.
The ninety-day pilot does this for all of them, with your real data connected
behind it."*

---

## Format 4 — Industry webinar (45 minutes, monthly)

*Top-of-funnel. Vendor-neutral content with a product example at the end.
Pitch these to associations — EEI, AGA, AWWA, DAMA chapters, NASCIO, CHIME —
who need speakers and will promote to their membership for free.*

**Title patterns that get accepted by association program committees:**

- "Why data governance programs stall in the first 18 months (and what the
  ones that don't have in common)"
- "Process-first governance: what utilities can learn from operational risk
  management"
- "Answering the regulator: building an auditable line from process to data"
- "Governance for organisations that don't have a 40-person data team"

**Structure — the 70/20/10 rule:**

| Portion | Content |
|---|---|
| **70%** (30 min) | Genuinely vendor-neutral. The failure patterns, the maturity model, what to do in what order, what to measure. Useful to someone who will never buy from you. Include a slide naming when a traditional catalog *is* the right answer. |
| **20%** (9 min) | "Here's what this looks like implemented" — the Procela demo, condensed to the generate → map → gap sequence. |
| **10%** (6 min) | Q&A and a single soft CTA: the template pack, gated behind an email address. |

**Co-present with a practitioner wherever possible** — a design partner, an
advisor, a former CDO. Third-party credibility is the entire value of this
format, and a vendor talking alone gets discounted no matter how good the
content is.

**Follow-up:** attendees to Sequence 6d, registrant-no-shows to 6e, and
anyone who asked a question during Q&A gets a personal reply within 24 hours
answering it more fully. That personal reply converts better than the
webinar.

---

## Demo environment — operational requirements

The single most common way a demo fails is the environment, not the pitch.

### Must-haves before any external demo

- [ ] **Always-on hosted tenant** at a real URL. Never a laptop, never
      `localhost` over screen share, never hotel wifi with `npm run dev`.
- [ ] **Both seeded tenants loaded** — Tidewater Utilities (electric/water)
      and Momentum Industries (defense/shipbuilding) — so you can switch
      industry mid-call.
- [ ] **AI templates pre-warmed** for all eight supported industries, so the
      generation returns instantly. Keep "Regenerate from AI" available for
      the sceptic who wants to see the live path, and *offer* it — it turns a
      "that's cached" objection into a proof point.
- [ ] **A seeded edge connector showing ONLINE** with recent heartbeat and a
      populated event log. Never try to install one live.
- [ ] **White-label tenant login** working at `/login?tenant=…` — showing a
      prospect their own brand on the sign-in card is a 10-second beat with
      disproportionate impact.
- [ ] **A second browser profile** signed in as a different persona, for the
      segregation-of-duties beat (submitter cannot approve their own change).
- [ ] **Reset path rehearsed** — Settings → Reset everything → reload demo.
      Know how long it takes.

### The pre-call checklist (2 minutes, every single time)

From `../demo-playbook.html`:

1. Sign in as super-admin, load the demo tenant, wait for the seeded banner.
2. Sign out, sign back in as the demo persona.
3. **Sanity check:** dashboard shows 3 open tasks, 1 open issue, a domain
   under My Domains; the overview strip shows non-zero counts for value
   streams, data assets and systems.
4. If any of those read zero — wrong org scope. Switch "Working in…" before
   the call starts, not during it.

### If it breaks mid-call

Say what happened, plainly, and move. *"That's a cache miss on the live
generation — here's the one I ran for your industry this morning."* Then keep
going. Prospects forgive a stumble handled calmly; they do not forgive four
minutes of silent clicking.

| Symptom | Fix |
|---|---|
| Everything reads zero | Wrong "Working in…" scope. Switch org. |
| Generation hangs | Cache miss. Switch to another division, or use the pre-generated tab. |
| Auth failure | Sign out, back in as super-admin. |
| Duplicate seeded data | Re-click Load demo — it's idempotent. |
| Genuinely broken | Settings → Reset everything → reload demo. Meanwhile, talk. |

---

## Measuring the program

| Format | Primary metric | Target |
|---|---|---|
| Async demo (F0) | % of viewers reaching 4:00 | >40% |
| Public demo (F1) | Registration → attendance | >35% |
| Public demo (F1) | Attendee → 1:1 request | >12% |
| Tailored demo (F2) | Demo → proposal | >30% |
| Gap Teardown (F3) | Session → pilot conversation | >50% |
| Webinar (F4) | Registration count, then attendee → demo | >8% |

If Format 2 is below 30%, the cause is almost always the same thing: you
toured the product instead of demoing their stated pain. Re-read the run of
show and cut everything that doesn't map to what they said in the first ten
minutes.
