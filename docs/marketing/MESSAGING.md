# Procela — Messaging & Positioning Guide

*The words. Every email, demo, landing page and call should be traceable to
something on this page. Claims here are constrained to what
`docs/STATUS.md` says is actually Built — see § Claims discipline at the end.*

---

## 1. The core narrative

### The 30-second version (use on calls, in intros, on LinkedIn)

> Most organisations run two parallel worlds that never talk. The business
> side thinks in processes and outcomes. The data side thinks in systems and
> schemas. So when a report is wrong or a regulator asks a question, nobody
> can say which process was affected, what data failed it, and who owns it.
>
> Every governance tool on the market tries to fix that from the data side —
> catalog everything, then hope the business shows up. They don't show up.
>
> Procela starts from the business. You describe how your organisation
> actually works — value streams, processes, activities, owners — and then
> the data binds to it. And we don't make you start from a blank page: pick
> your industry and Procela generates the whole hierarchy in about ninety
> seconds. You edit it instead of inventing it.

### The one-sentence version

> **Procela maps your business first, then makes your data follow it.**

### The tagline options

- *"Governance that starts where the work does."*
- *"Your business, mapped. Your data, connected."*
- *"Most data tools start with the data. We start with the business."*

---

## 2. The three pillars

Every asset should carry at least one. The demo carries all three.

### Pillar 1 — Business-first, not data-first

**Claim:** Procela is the only platform of the five benchmarked with a native
value-stream → process → sub-process → activity model that data assets bind
*to*, rather than a data model the business is asked to learn.

**Proof:** the coverage matrix (`docs/STATUS.md` § Feature coverage) — process
model: Collibra Partial, Alation None, Atlan None, Ataccama Partial. Process
step ownership: only Collibra. Process→data mapping: only Collibra, Partial.

**Say it like this:** *"Your process owners will recognise the first screen
they see. That's the whole difference. Adoption isn't a change-management
program; it's the shape of the product."*

### Pillar 2 — Never a blank page

**Claim:** Select your industry; Procela's AI generates a complete process
hierarchy in about ninety seconds. Accept it, edit it, or replace it. No
incumbent has this — all four are a flat *No*.

**Proof:** live, on the call. This is not a slide. Eight industries supported:
utilities, defense & shipbuilding, healthcare, manufacturing, oil & gas,
financial services, transportation & logistics, state & local government.

**Say it like this:** *"The reason these programs die in month four is that
month one is a blank screen and a workshop calendar. We skip month one."*

### Pillar 3 — Accountability is structural, not aspirational

**Claim:** Every process, activity, system and data asset carries an owner, a
steward, a RACI position and an audit trail — enforced by the model, not by
policy documents. Gap detection surfaces what's unmapped or unowned, and the
council scorecard rolls it up by division.

**Proof:** RACI/decision rights is an *add-on* at Collibra and absent at
Alation and Atlan. SOPs, operations manuals, policy-exception registers,
maturity scoring and council scorecards are all Built here and thin or
missing there.

**Say it like this:** *"When your auditor asks who owns this and who approved
that change, the answer is a row in the system — not a person's memory and a
spreadsheet somebody has to go find."*

---

## 3. Message by persona

| Persona | Opening line that lands | What to demo | What to avoid |
|---|---|---|---|
| **CDO / CDAO** | "Your program's problem isn't tooling, it's that the business never shows up. We invert the order of operations." | Executive dashboard → coverage %, gap summary, governance tier breakdown. Then generate their industry hierarchy live. | Connector counts. You'll lose. |
| **Head of Data Governance** | "How much of your governance program currently lives in Excel and SharePoint?" (It's most of it. Always.) | RACI matrix, governance tasks and issues, council scorecard, policy exceptions, maturity score. | Starting with the AI. Start with their actual daily pain. |
| **VP Operations / Process Excellence** | "Your process documentation was accurate the day it was written. When was that?" | Activity detail: Responsible person, criticality tier, RTO, success measure, predecessors/successors, inputs/outputs. | Any language that makes it sound like an IT project. |
| **CIO** | "You can run this entirely inside your own network. The connector sends metadata only — never data values, never credentials." | Edge connector events, Helm/Terraform deploy story, SSO/SCIM/SAML, audit log, encryption at rest. | AI-first framing. Lead with control. |
| **CISO / Compliance / Privacy** | "One-way outbound HTTPS. Metadata only. Nothing leaves your perimeter that you haven't scoped." | Connector event log, RBAC matrix, audit export, sensitivity classification with per-tag accept/reject, `AI_FEATURES_ENABLED=false` for air-gapped deployments. | Overclaiming certifications. See § Claims discipline. |
| **Data steward (user)** | "You won't be asked to start from nothing." | Suggest-and-confirm flows: AI-suggested data/systems per step, tier-promotion suggestions, discovered-asset reconciliation. | Governance theory. They live it. |

---

## 4. Proof points — the specific, falsifiable ones

Vague claims get ignored; specific claims get replies. Use these.

- **Ninety seconds to a full industry process hierarchy** — generated live,
  eight industries, editable in place.
- **Same code, different context** — switch the active org from Electric to
  Water and the same generator returns treatment, distribution and
  wastewater instead of SCADA and outage management. (Demo beat 02.)
- **Metadata only** — the on-prem edge connector scans PostgreSQL, MySQL, SQL
  Server, Oracle and dbt manifests inside the customer's network and reports
  asset names, row counts and freshness. No data values, no credentials,
  one-way outbound HTTPS, and an alert if it stops calling home.
- **Real discovery, not simulated** — Postgres, MySQL, SQL Server, Oracle,
  Redshift, Snowflake, BigQuery, Databricks, MongoDB, S3, Azure Blob, GCS,
  SFTP, and local CSV/JSON/Parquet/Avro all run genuine introspection.
  (API and spreadsheet sources are still simulated — say so if asked.)
- **Column-level lineage from query history** — Snowflake `QUERY_HISTORY`
  parsed to table-to-table *and* column-to-column edges, reconciled into the
  governed catalog, and surfaced in the impact blast radius.
- **"If we retire this asset, who needs to know?"** — the Impact panel gives
  activity, process and value-stream counts, expandable to a per-person
  notify list. The change-comms distribution list on tap.
- **Segregation of duties enforced** — a submitter cannot approve their own
  change. Not a policy; the button is disabled.
- **Grounded AI** — the assistant answers only from your catalog, with
  clickable inline citations back to the row, and a one-click navigation chip
  to the page that solves the problem. It will not invent an asset.
- **Your AI vendor, your choice** — Anthropic, OpenAI (including Azure and
  self-hosted OpenAI-compatible endpoints), Google Gemini or AWS Bedrock,
  selectable per deployment *or* per tenant with the key encrypted at rest.
  Or `AI_FEATURES_ENABLED=false` and the whole AI surface disappears while
  the rest of the platform works unchanged.
- **Your brand, not ours** — per-tenant white-label sign-in with the
  customer's name, glyph and SSO button.

---

## 5. Objection handling

### "We already have Collibra / Alation / Atlan."

> Good — keep it. Those are excellent at cataloguing technical assets, and
> replacing one is a project nobody wants. The question I'd ask is: how many
> of your business process owners logged into it last month? Procela sits
> above it. We map the business, and your catalog stays the system of record
> for the technical layer. The two aren't competing for the same job.

*(Then requalify: is there a political sponsor for adding a tool? If not,
nurture and move on. This is Motion B, and it's a longer cycle.)*

### "You only have fifteen connectors. They have two hundred."

> True, and if your requirement is breadth of technical connectors you should
> buy one of them. Our connectors cover the relational and warehouse sources
> that hold the data behind actual business processes — Postgres, MySQL, SQL
> Server, Oracle, Redshift, Snowflake, BigQuery, Databricks, Mongo, and cloud
> object storage. What we do that they don't is tell you which *process*
> breaks when one of those goes wrong.

### "You're a startup. What if you're not here in three years?"

> Fair, and I'd ask it too. Three concrete things: the platform runs in your
> infrastructure — Docker, Helm, your own Postgres, your own AWS account — so
> you aren't dependent on our uptime. Everything is exposed over a documented
> REST API, so your data is extractable, not hostage. And the Founding
> Partner agreement includes a source-escrow clause. *(Confirm escrow is
> actually arranged before saying this — see § Claims discipline.)*

### "We don't have budget this year."

> That's the normal answer, and it's part of why the Founding Partner program
> exists: ninety days at no licence cost, one value stream, one division,
> scoped to a result we agree on up front. If it doesn't produce that result,
> you walk and you've spent a few hours a week. If it does, you have a
> working artifact and a number to take into next year's budget cycle — which
> is a much easier conversation than a slide deck.

### "How is this different from Visio / Confluence / our spreadsheets?"

> Those are documents. They were accurate the day they were written. Procela
> is a live model: the activity that says its RTO is four hours is the same
> record the regulator's answer comes from, the same record that fires a task
> when it slips, and the same record that tells you which twelve people to
> notify if the asset behind it is retired. A diagram can't do any of that.

### "Is our data going to a third-party AI model?"

> Only if you want it to. Three options. One: use your own AI vendor —
> Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock, or a self-hosted
> OpenAI-compatible endpoint inside your network — configured per tenant with
> the key encrypted at rest. Two: turn AI off entirely with a single
> environment variable; the endpoints refuse and the UI hides every AI entry
> point, and everything else works. Three: note that the AI operates on
> business *metadata* — process names, asset names, descriptions — not on
> data values, in either case.

### "What about SOC 2 / FedRAMP / StateRAMP?"

> We don't have them yet, and I'm not going to pretend otherwise. Here's
> what we do have: SAML 2.0 and OIDC SSO, SCIM provisioning, MFA including
> WebAuthn, Argon2id, AES-256-GCM at rest with AWS KMS / Azure Key Vault /
> GCP KMS support, RBAC, a full audit trail, CodeQL SAST on every commit and
> a completed internal application-security review. An external penetration
> test is on the near-term plan. And because you can run it entirely inside
> your own boundary, most of the shared-responsibility surface is yours
> already. If certification is a hard gate for you, tell me the date you need
> it by and I'll tell you honestly whether we'll make it.

### "Ninety seconds sounds like marketing."

> It is, and it's also literal. Give me your industry right now and I'll do
> it while we're on this call.

*(This is the best objection you will ever get. Always take it.)*

---

## 6. Competitive framing

**The rule: never attack. Reframe the job.**

| They say | Don't say | Do say |
|---|---|---|
| "Collibra is the leader." | "Collibra is bloated and expensive." | "It is, for the technical catalog job. The job we do is upstream of that one." |
| "Alation has the best lineage." | "Ours is better." | "Their lineage is excellent. Ours answers a different question: not just which table feeds which, but which *process* stops working." |
| "Atlan is more modern." | anything | "Agreed, it's a nice product. It's also data-first. If your problem is that the business isn't engaged, a better data-first product doesn't solve it." |
| "Ataccama has stronger DQ." | "We have DQ too." | "Best in the market at it, genuinely. We measure quality against direct database connections with five rule types, and we tie a failing rule to the business activity it breaks. Different granularity of answer." |

**The reframe that wins:** *"The question isn't which catalog is best. It's
whether a catalog is what's failing. If your business process owners aren't
in the tool, buying a better tool for the data team won't change that."*

---

## 7. Boilerplate

### Short (email signature, directory listings, 50 words)

> Procela is a business-first data governance platform. Organisations map how
> their business actually works — value streams, processes, activities,
> owners — and Procela binds the data and systems behind each step, then
> governs it: ownership, RACI, gap detection, data quality, lineage and a
> full audit trail.

### Medium (website about, press, 100 words)

> Most data governance programs fail because they start at the data and ask
> the business to catch up. Procela inverts that. Process owners describe
> their work in plain business language — accelerated by AI-generated
> industry templates that produce a full process hierarchy in about ninety
> seconds — and data assets, systems and quality rules bind to each step.
> The result is a governance program the business recognises: every process
> has an owner, every asset has a domain, every dependency is declared, and
> every change is auditable. Procela runs in the cloud or entirely inside
> your own network, with SSO, SCIM and metadata-only source discovery.

---

## 8. Claims discipline

Marketing copy that outruns the product ends a deal in the security review,
not before it. Bind every claim to `docs/STATUS.md`.

**Safe to claim without qualification** — anything marked *Built*: the process
model, AI industry templates, process→data mapping, gap detection, RACI,
governance tasks/issues/policies, maturity and council scorecards, the
glossary, systems registry, connection profiles, real database connectors and
discovery, manual + auto-extracted + column-level lineage, impact analysis,
the DQ rules engine and scorecards, classification, the conversational
assistant, SSO/RBAC/org hierarchy, the audit log, the edge connector,
multi-vendor AI.

**Must be qualified** — say the qualifier out loud, unprompted, in security
and procurement conversations:

| Claim | The honest qualifier |
|---|---|
| "We discover any source." | API and spreadsheet sources (SharePoint, Google Sheets) are **simulated** today. Everything else listed is real introspection. |
| "We measure data quality everywhere." | Measured for direct database connections and text file formats. Warehouse, object-store, Parquet/Avro, API and spreadsheet DQ is currently simulated. |
| "Full profiling." | Row count and freshness today. Null %, distinct, min/max and histograms are **Partial**. |
| "Compliance reporting." | Audit log is queryable and exportable. Pre-built SOX/GDPR/HIPAA report templates are **Partial**. |
| "Approval workflows." | A task lifecycle state machine ships, including segregation of duties. Multi-stage BPMN approver routing does not. |
| "Multi-tenant SaaS." | **Designed, not deployed.** Sell single-tenant. This is a strength with this ICP — lead with it. |
| "On-prem deployment." | Helm chart exists, lints and template-renders in CI; it has not yet been installed on a live cluster. Say "validated in CI, and your pilot would be the first live install — which is part of why you're getting founding-partner terms." |
| "Anomaly detection / BI integration / data contracts / data products / usage-based ranking." | **Not started.** Do not imply a date you haven't committed to in `STATUS.md`. |
| "SOC 2 / FedRAMP / pen-tested." | No SOC 2, no FedRAMP. Internal app-sec review done; external pen test outstanding. Never fudge this one. |

**The rule:** if a prospect could discover the qualifier in a trial and feel
misled, say it first. In this ICP — utilities, defense, government —
credibility compounds and a single overclaim travels further than any
campaign you will run.
