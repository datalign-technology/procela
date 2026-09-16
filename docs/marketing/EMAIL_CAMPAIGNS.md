# Procela — Email Campaigns

Ten sequences, ready to send. Copy is written to be *used*, not adapted —
replace the `{{merge_fields}}` and send.

> **Solo founder: start with Sequence 0 (warm outreach), not Sequence 1.**
> Your first pilot comes from someone you already know. Cold email is the
> background process that fills quarter two — see
> [`OPERATING_PLAN.md`](./OPERATING_PLAN.md) § 2.

**Merge fields used throughout:**
`{{first_name}}` · `{{company}}` · `{{industry}}` · `{{trigger}}` ·
`{{trigger_detail}}` · `{{peer_company}}` · `{{sender_name}}` ·
`{{demo_link}}` · `{{calendar_link}}` · `{{founding_partner_link}}`

---

## Rules that govern every email here

1. **Under 120 words.** Executives read on a phone between meetings. If it
   scrolls, it's deleted.
2. **One ask.** Never "reply, or book time, or check out our site."
3. **No images, no logos, no tracking pixels on cold sends.** They halve
   deliverability and they make a personal email look like a blast. Turn open
   tracking *off* on cold sequences — it is the single most common reason
   plain-text email lands in spam. Track replies instead; replies are the
   metric that matters.
4. **No attachments** on a cold send. Ever.
5. **The first line must be about them.** Not about us, not "I hope this
   finds you well," and not "I'm reaching out because." If the first line
   could be sent to anyone, it will be read by no one.
6. **Ask a question, not for a meeting**, on touches 1 and 2. A question is
   cheap to answer. A meeting is expensive to grant.
7. **Plain text, sent from a human mailbox**, with a real signature and a
   physical address.
8. **Every follow-up adds something.** Never "just bumping this to the top of
   your inbox" — that teaches people you have nothing to say.

---

## Sequence 0 — Warm outreach (START HERE)

*People you already know in the ICP but have never pitched. **This is where
your first pilot comes from.** Warm replies at 50–70% against cold's 3–6%;
roughly fifteen of these are worth four hundred cold emails.*

**Rules that differ from every other sequence here:**

- **Send by hand, from your own mailbox.** Never through the sequencer, never
  from the cold-sending domain. These are personal emails.
- **No sequence, no automated follow-up.** One email, then one nudge by hand
  after 8 days if nothing comes back. That's all.
- **Ask for advice, not a meeting.** People who know you will give you twenty
  minutes of counsel far more readily than twenty minutes of sales. And the
  advice conversation converts to a pilot conversation on its own, without
  you having to steer it.
- **Ten at a time.** Send ten, read the replies, revise, send the next
  fifteen. Do not burn a 40-person warm list on copy you haven't tested.

### 0a — The core warm email

**Subject:** `starting something — would value your read on it`

```
{{first_name}} —

Hope you're well. {{one_genuine_personal_line}}

I've started a company and I'd value your read on it, since you've lived
this problem from the inside.

The premise: governance programs fail because they start at the data and
wait for the business to show up. We start at the business process —
value streams, processes, activities, owners — and the data binds behind
it. And we generate the whole industry hierarchy with AI, so nobody's
first day is a blank screen.

I'm not pitching you. I'm trying to find out whether the premise holds
up against what you actually saw at {{company_or_former_company}}.

Twenty minutes in the next couple of weeks? Happy to show you what
we've built, but mostly I want to hear where you think it's wrong.

{{sender_name}}
```

**Why it works:** the ask is small and flattering, the premise is
falsifiable, and "I want to hear where it's wrong" is the one framing that
gets a genuine answer instead of a polite one. Roughly a third of these
conversations turn into a pilot conversation without you raising it — and
the ones that don't will give you the objection list that fixes your cold
copy.

### 0b — The hand-written nudge, day 8

**Subject:** `re: starting something` *(threaded)*

```
{{first_name}} — know you're busy, no pressure at all.

If a call's hard, the six-minute version is here: {{demo_link}}

And if this isn't your world any more, the question I'd actually love
an answer to: who's the sharpest person you know running data
governance at a utility, a defense supplier, or a manufacturer?

{{sender_name}}
```

**The referral question is the real content of this email.** A warm contact
who can't help will nearly always name someone who can, and a named
introduction from them outperforms anything else in this document.

### 0c — After a good warm conversation (same day)

```
{{first_name}} — thank you, that was genuinely useful. Three things
you said I'm taking away:

· {{their_point_1}}
· {{their_point_2}}
· {{their_point_3}}

Two asks, take either or neither:

1. We're taking four founding partners — 90 days, one value stream, one
   division. Licence free, small implementation fee that credits against
   year one. If {{their_company}} is a fit, I'd rather you had a slot
   than a stranger.

2. If it's not, who are the two people you'd send this to?

Either way I owe you one.

{{sender_name}}
```

**Two asks, explicitly optional, with the referral as a genuine alternative
rather than a consolation.** Almost nobody says no to both.

### 0d — Advisor recruitment

*Send to the 3–5 warmest contacts with the deepest industry credibility. A
former utility CDO or defense-supplier compliance lead as an advisor buys you
the buyer network the founding team doesn't have — the fastest available fix
for that gap.*

**Subject:** `advisor role — {{industry}}`

```
{{first_name}} —

Following up on our conversation. I'd like to ask you something more
concrete.

We're building out a small advisory group — three or four people who
know {{industry}} from the inside — and I'd like you to be one of them.

What it is: an hour a month, honest feedback on where we're wrong, and
introductions where you think there's a genuine fit. Nothing you'd have
to defend to anyone. Standard advisor equity, vesting over two years,
and I'd put real numbers in front of you before you decide anything.

What I'd get is the thing I can't buy: someone who can tell me in ten
seconds that I'm pitching the wrong person at a utility.

Worth a conversation?

{{sender_name}}
```

---

## Sequence 1 — Cold outbound: Head of Data Governance (primary)

*Motion A. The workhorse. 4 touches over 12 business days.*

### Touch 1 — Day 0

**Subject lines (A/B/C test these):**
- `governance program at {{company}}`
- `how much of it is still in Excel?`
- `question about {{company}}'s process documentation`

```
{{first_name}} —

{{trigger_detail}}

Blunt question: how much of your governance program still lives in
SharePoint and spreadsheets? For most teams I talk to it's 70-80%, and
it's not because nobody bought a platform — it's because the platform
started at the data, and the business owners never showed up.

We built Procela the other way round. You describe how the business
actually runs — value streams, processes, activities, owners — and the
data binds to that. Pick your industry and it generates the whole
hierarchy for you in about ninety seconds, so nobody starts at a blank
page.

Is the business-engagement problem the one you're actually fighting, or
is it something else?

{{sender_name}}
```

### Touch 2 — Day 3

**Subject:** `re: governance program at {{company}}` *(threaded reply)*

```
Following up with something concrete instead of a nudge.

Six minutes, no form: {{demo_link}}

Watch the first ninety seconds. That's a full {{industry}} process
hierarchy — value streams, processes, activities — generated from
scratch. Then it gets mapped to data assets and the gaps light up.

If it's not relevant, tell me and I'll close the file.

{{sender_name}}
```

### Touch 3 — Day 7

**Subject:** `the month-four problem`

```
{{first_name}} — one observation, then I'll stop.

Governance programs don't fail in year two. They fail in month four,
when the initial workshop energy runs out and the catalog is still 8%
populated because every entry requires a human to invent it from
nothing.

The fix isn't more discipline. It's not starting from nothing.

We generate your industry's process hierarchy, suggest the data and
systems behind each step, and let your people accept, edit or reject —
which is a fundamentally easier task than authoring.

Worth 20 minutes to see whether it holds up against {{company}}'s
reality?

{{calendar_link}}

{{sender_name}}
```

### Touch 4 — Day 12 (the permission close)

**Subject:** `closing the file`

```
{{first_name}} — assuming this isn't a priority right now, which is a
completely reasonable answer.

I'll stop emailing. Two things in case they're useful later:

- The {{industry}} process template pack we generated: {{demo_link}}
  Yours to use whether or not you ever talk to us.
- If someone else at {{company}} owns this, I'd appreciate the name.

Good luck with {{trigger}}.

{{sender_name}}
```

---

## Sequence 2 — Cold outbound: CDO / CDAO (executive)

*Shorter, more consequential, more direct. 3 touches over 10 days.*

### Touch 1 — Day 0

**Subject:** `{{company}} — who owns the data behind {{industry}} reporting?`

```
{{first_name}} —

{{trigger_detail}}

The question I'd want answered in your seat: when a number is wrong,
how long does it take to say which process was affected, what data
failed it, and who owns it?

For most organisations it's days and three meetings, because the
process map and the data catalog are different artifacts maintained by
different people.

Procela makes them one artifact. And it doesn't start with a blank
page — it generates your industry's full process hierarchy with AI,
then binds the data to it.

Worth 20 minutes?

{{sender_name}}
```

### Touch 2 — Day 4

**Subject:** `re: {{company}} — who owns the data behind {{industry}} reporting?`

```
Six minutes, if easier than a calendar invite: {{demo_link}}

The part worth your time is at 2:40 — the executive view. Coverage by
value stream, ungoverned assets supporting critical processes, and the
list of process steps with no data behind them at all.

That last one is usually the slide that changes a budget conversation.

{{sender_name}}
```

### Touch 3 — Day 10

**Subject:** `founding partner — {{industry}}`

```
{{first_name}} — last note.

We're taking ten founding partners before general availability. Ninety
days, one value stream, one division, no licence cost, and we do the
setup. In exchange we want honest feedback, a reference call, and a
written case study if it works.

Terms and what each side commits to: {{founding_partner_link}}

Two of the ten slots are reserved for {{industry}}. If there's someone
on your team who should evaluate it instead of you, send me their name
and I'll take it from there.

{{sender_name}}
```

---

## Sequence 3 — Cold outbound: VP Operations / Process Excellence

*Different pain entirely. Never mention "data governance" in touch 1.*

### Touch 1 — Day 0

**Subject:** `{{company}}'s process documentation`

```
{{first_name}} —

Your process documentation was accurate the day it was written. When
was that?

Not a dig — it's structural. Visio and Confluence produce documents,
and documents don't know when the system behind step four was
replaced, or that the person listed as responsible left in March.

Procela holds the same content as a live model: each activity carries
its owner, its criticality tier, its recovery objective, its
predecessors and successors, and the actual systems and data behind it.
When something changes, you get the list of everyone affected instead
of a meeting to figure it out.

Is keeping process documentation current a real problem at {{company}},
or have you solved it another way?

{{sender_name}}
```

### Touch 2 — Day 4

**Subject:** `re: {{company}}'s process documentation`

```
Concrete version, six minutes: {{demo_link}}

Jump to 3:10 — an outage-triage activity with a named responsible
person, two upstream systems, a declared predecessor and successor, a
four-hour recovery objective and a success measure. Then one click to
"if we retire this data asset, here are the twelve people who need to
know."

That last click is usually the one operations people react to.

{{sender_name}}
```

### Touch 3 — Day 9

**Subject:** `the retirement question`

```
{{first_name}} — one last thought.

Most organisations can tell you what a system does. Very few can tell
you, in under a minute, which business activities stop working if it
goes away — and who to notify.

That's a ninety-second answer in Procela because the process model and
the asset model are the same model.

Twenty minutes to see it against a {{industry}} example?
{{calendar_link}}

{{sender_name}}
```

---

## Sequence 4 — "Stalled catalog" (Motion B)

*For organisations known to own Collibra, Alation, Atlan or Ataccama. Do NOT
attack the incumbent — you'll insult the person who bought it.*

### Touch 1 — Day 0

**Subject:** `not replacing your catalog`

```
{{first_name}} — this isn't a rip-and-replace pitch, so I'll be quick.

You have a catalog. It works for what it does. The question is how many
of your *business* process owners logged into it last quarter.

If the honest answer is "very few," that isn't a tooling failure — it's
that technical catalogs are built for data teams, and asking a plant
manager to browse a schema browser was never going to work.

Procela sits above it. We model the business — value streams,
processes, activities, RACI — and bind to the assets your catalog
already governs. Your catalog stays the system of record. We give it
the business context it never had.

Is business engagement the gap, or is your program past that?

{{sender_name}}
```

### Touch 2 — Day 5

**Subject:** `re: not replacing your catalog`

```
The specific integration question people ask here: we don't duplicate
your catalog. Procela discovers and links to governed assets, and
everything is exposed over a documented REST API in both directions.

Six minutes on what "the business layer" actually looks like:
{{demo_link}}

{{sender_name}}
```

### Touch 3 — Day 11

**Subject:** `the renewal conversation`

```
{{first_name}} — a practical reason to look now rather than later.

When your catalog renewal comes up, someone is going to ask what the
programme produced. "We catalogued 40,000 assets" is a weak answer.
"Here's every critical business process, its owner, and the data
coverage gap by division" is a strong one — and it's the artifact
Procela produces.

Happy to show it against your actual structure. {{calendar_link}}

{{sender_name}}
```

---

## Sequence 5 — Founding Partner invitation (warm network / referral)

*Highest conversion of anything here. One email, sent personally. No sequence.*

**Subject:** `founding partner slot — thought of you`

```
{{first_name}} —

We're taking ten founding partners for Procela before general
availability, and I wanted you to have first look.

What it is: you map one value stream — one division, up to 25 users —
over ninety days. We do the setup and the onboarding. No licence cost
for the pilot, and if you continue, year one is half price with the
rate locked for three years.

What we want back: about four hours a week from you and one steward,
honest feedback, a reference call, and a written case study if it
works. If it doesn't work, you tell us why and we part as friends.

The short version of the product: most governance tools start at the
data and wait for the business to show up. We start at the business
process and pull the data in behind it — and we generate your
industry's whole process hierarchy with AI so nobody starts from a
blank page.

Worth thirty minutes? And if it's not for you, the question I'd love
an answer to: who do you know running data governance at a utility,
a defense supplier, or a state agency?

{{sender_name}}
```

---

## Sequence 6 — Public demo (webinar) lifecycle

### 6a. Invitation — 10 days before

**Subject:** `Procela in 20 minutes — {{date}}, 1pm ET`

```
{{first_name}} —

We run a 20-minute open demo every other Thursday. Next one is
{{date}} at 1pm ET.

What you'll see:
· A full {{industry}} process hierarchy generated live, from nothing,
  in about ninety seconds
· Data assets bound to process steps, and the coverage gaps lighting up
· "If we retire this asset, who needs to know?" — answered in one click

20 minutes of demo, 10 of questions. No slides. Recorded, so register
even if you can't make it and I'll send the recording.

{{registration_link}}

{{sender_name}}
```

### 6b. Reminder — 24 hours before

**Subject:** `tomorrow, 1pm ET — bring your industry`

```
Quick reminder: {{date}}, 1pm ET. {{join_link}}

One thing that makes it better — reply with your industry and I'll
generate *your* hierarchy live instead of the stock example. Takes me
no extra time and it's a much more useful 20 minutes for you.

{{sender_name}}
```

### 6c. Reminder — 1 hour before

**Subject:** `starting in an hour`

```
{{join_link}} — see you shortly.
```

### 6d. Follow-up — attended, same day

**Subject:** `recording + the {{industry}} hierarchy from today`

```
{{first_name}} — thanks for joining.

· Recording: {{recording_link}}
· The {{industry}} hierarchy we generated: {{artifact_link}}
· Founding partner terms, since a few people asked:
  {{founding_partner_link}}

The question I'd actually like answered: what part of what you saw is
closest to a problem you have right now? That tells me whether a
tailored walkthrough is worth your time or not.

{{sender_name}}
```

### 6e. Follow-up — no-show, same day

**Subject:** `missed you — here's the 20 minutes in 6`

```
{{first_name}} — you registered and couldn't make it, which is normal.

Recording: {{recording_link}}
Shorter version, 6 minutes: {{demo_link}}

We run it again on {{next_date}} if live is better:
{{registration_link}}

{{sender_name}}
```

---

## Sequence 7 — Post-demo (1:1) follow-up

### 7a. Same day — within 4 hours. Non-negotiable.

**Subject:** `{{company}} — what we generated today`

```
{{first_name}} — good conversation. As promised:

· Your generated {{industry}} hierarchy: {{artifact_link}}
  Yours to keep and use, regardless of what happens next.
· Recording of the walkthrough: {{recording_link}}
· The three things you flagged: {{point_1}}, {{point_2}}, {{point_3}}

You mentioned {{their_stated_goal}}. Here's what a ninety-day pilot
scoped to exactly that would look like: {{founding_partner_link}}

Two questions so I don't waste your time:
1. Who else needs to see this before it's a real conversation?
2. What would have to be true at day ninety for you to call it a win?

{{sender_name}}
```

### 7b. Day 4 — the internal-champion enabler

**Subject:** `something you can forward`

```
{{first_name}} — you'll probably need to explain this to someone who
wasn't on the call.

One-pager built for that: {{one_pager_link}}. It's written for
{{their_boss_persona}}, not for me — the ask, the ninety-day scope, the
success criteria, and what it costs.

Anything in it you'd want changed before you send it on?

{{sender_name}}
```

### 7c. Day 10 — the specific re-engage

**Subject:** `{{their_specific_gap}}`

```
{{first_name}} — you said {{their_specific_pain_quote}} on our call.

I went back and mocked up what that looks like in Procela using your
structure: {{artifact_link}}

If the ninety-day pilot is right, the next step is a 30-minute scoping
call with whoever owns the data source. If the timing is wrong, tell me
when to come back and I'll do exactly that.

{{sender_name}}
```

---

## Sequence 8 — Proof-of-concept / reduced-licensing offer

*Send to qualified prospects who went quiet, or as an explicit close.*

**Subject:** `proof of concept — {{company}}`

```
{{first_name}} —

Let me make this as low-risk as I can make it.

Ninety days. One value stream, one division, up to 25 named users. No
licence cost for the pilot period. We do the deployment and the
onboarding — it runs in your AWS account or your own data centre, your
choice, so nothing has to leave your boundary.

We agree the success criteria before we start. Something like: your
priority value stream fully mapped, 80% of tier-one activities with a
named owner, every connected source discovered and reconciled, and a
gap report you can put in front of your exec team.

If we hit it, year one is 50% of list, locked for three years, and
we'd ask for a reference call and a case study. If we miss it, you owe
nothing and you keep the process model we built — it's yours either
way.

What we need from you: an exec sponsor for about four hours a week, one
data steward, and read-only access to one database.

Full terms: {{founding_partner_link}}

Is there a reason this wouldn't work, or is it a matter of timing?

{{sender_name}}
```

---

## Sequence 9 — Long-term nurture (monthly, opt-in list)

One email a month. Never a newsletter, never a product-update dump. Each one
is a single useful artifact with a one-line note.

**Rotation:**

| Month | Artifact |
|---|---|
| 1 | An industry process template pack (rotate the industry) |
| 2 | "The month-four problem" — why governance programs stall, written as an essay, not a pitch |
| 3 | The competitor coverage matrix, published honestly including the rows where we lose |
| 4 | A design-partner case study |
| 5 | "Twelve questions to ask before you buy a data catalog" — vendor-neutral, genuinely useful, we don't win all twelve |
| 6 | Product update: what shipped, what didn't, and what we cut |

**Format:**

```
{{first_name}} —

{{one_sentence_on_why_this_matters}}

{{artifact_link}}

That's it — no ask.

{{sender_name}}

---
You're getting this because we spoke about data governance. One click
to stop: {{unsubscribe_link}}
```

---

## Deliverability — the part that decides whether any of this works

Great copy in the spam folder is worth nothing. Do all of this.

### Domain and authentication

- **Separate sending domain.** `procelahq.com`, `go-procela.com` — never the
  primary. Cold email will damage reputation; keep that damage away from
  transactional mail and investor correspondence.
- **SPF, DKIM and DMARC** configured before the first send. Set DMARC to
  `p=none` initially, monitor reports, then move to `quarantine`.
- **Custom tracking domain** if you use link tracking. Shared tracking
  domains from sequencer tools are widely blacklisted.

### Warmup and volume

- **14–21 days of automated warmup** per mailbox before any real send. There
  is no way around this.
- **Ceiling of 30–50 sends per mailbox per day**, forever. Three mailboxes
  gives you ~100–150/day, which is ample for a 600-row quality list.
- **Ramp** — week 1: 10/day. Week 2: 20/day. Week 3: 30/day.
- **Random 60–180 second intervals**, business hours in the recipient's
  timezone, weekdays only.

### Content hygiene

- Open tracking **off** on cold sequences. Reply rate is the real metric.
- No images, no attachments, no link shorteners, one link maximum per email.
- Avoid: "free," "guarantee," "act now," "limited time," "click here,"
  ALL CAPS, multiple exclamation marks, red text.
- Plain text or the simplest possible HTML. A designed template announces
  itself as a blast.

### Hygiene that protects the list

- **Verify every address** before sending (ZeroBounce, NeverBounce). Keep
  bounce rate under 2%; above 5% providers start filtering the domain.
- **Suppress immediately:** every unsubscribe, every "not interested," every
  bounce, and every colleague of someone who asked to stop.
- **Pause the whole sequence on reply.** Nothing destroys goodwill faster
  than an automated follow-up to a human answer.
- **Monitor weekly:** Google Postmaster Tools, plus a seed-inbox test into
  Gmail, Outlook and one corporate Exchange tenant before each new segment.

---

## Legal compliance

**This is not legal advice — have counsel review the program before the first
send.** The operational requirements:

### CAN-SPAM (US) — applies to every email here

- Accurate `From`, `Reply-To` and routing information.
- Subject line that reflects the content. No bait.
- A **valid physical postal address** in every commercial email, cold ones
  included. A registered agent or virtual office address is acceptable.
- A clear opt-out mechanism, honoured **within 10 business days**. In
  practice: same day, automatically.
- You are liable for what a vendor sends on your behalf. Read the sequencer's
  settings yourself.

> Note: B2B cold email *is* lawful under CAN-SPAM. It is opt-out, not opt-in.
> The requirements above are the price of that.

### GDPR (EU/UK) — why the plan starts US-only

Cold B2B email to EU recipients relies on the "legitimate interest" basis,
which requires a documented balancing test, a privacy notice at first
contact, and immediate honouring of objections. Several member states apply
stricter national ePrivacy rules on top. It is doable but it is real work.
**Recommendation: US-only for the first 90 days.** Revisit with counsel if
the pipeline pulls you to Europe.

### CASL (Canada) — treat as prohibited for cold

CASL requires **express or a narrow implied consent**, with penalties up to
CAD $10M. Implied consent exists for a published business address where the
message relates to the recipient's role, but the exemptions are narrow and
the enforcement is real. **Do not cold-email Canadian prospects** without
counsel signing off on the specific basis.

### Public-sector recipients

State and local government inboxes are frequently subject to public-records
law — assume anything you send could be published. Some agencies prohibit
unsolicited vendor contact outside a procurement process entirely, and
violating that can disqualify you from bidding. **Check the agency's
procurement rules before adding it to the list.** For any active
solicitation, contact only through the designated channel.

### Defense contractors

Nothing special for email itself, but be careful never to ask for or invite
CUI, ITAR-controlled or export-controlled information over email or in a
demo environment. Say so explicitly in pilot scoping.
