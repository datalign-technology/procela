# Procela Training Guide — Tidewater Utilities

A hands-on walkthrough of Procela using the fictional **Tidewater
Utilities** test data. By the end you will have:

- A populated environment with two utility divisions (electric + water)
  and shared services
- Defined business processes for each division
- Linked data assets, systems, ownership, and skills
- Exercised every value-loop feature Procela ships with
- Built a real cross-entity report and watched the gaps you'd care
  about light up

Plan on **90 minutes** end-to-end the first time through. The setup
phase (Module 1) is a one-time cost; modules 2–9 can be done in any
order once setup is complete.

---

## Prerequisites

| Item | What you need |
|---|---|
| **Running dev environment** | Backend on `:3000`, frontend on `:5173` (`npm run dev` from the repo root) |
| **Signed in** | As a `SUPER_ADMIN` or `ORG_ADMIN` so you can import and create |
| **Fresh data store** | Recommended for a clean walkthrough. Use **Settings → Reset everything** to wipe before starting (super-admins only) |
| **Test data files** | `test-data/utility/` — already in the repo |

---

## Module 1 — Load the data (10 min)

This is the foundation. Every subsequent module assumes the org tree,
systems, and people listed below have been imported.

### 1.1 Organizations

1. Navigate to **Organizations** (left nav).
2. Click **Import** in the page header.
3. Paste the contents of `test-data/utility/organizations.csv`.
4. Leave the **Parent** dropdown blank (these are top-level orgs).
5. Click **Import**.

You'll see the whole hierarchy appear:

```
Tidewater Utilities (company)
├── Tidewater Electric (division)
│   ├── Power Generation
│   ├── Transmission & Distribution
│   ├── Electric Customer Service
│   ├── Electric Engineering
│   └── Electric Asset Management
├── Tidewater Water (division)
│   ├── Water Production
│   ├── Water Distribution
│   ├── Wastewater Operations
│   ├── Water Customer Service
│   └── Water Engineering
└── Shared Services (division)
    ├── Information Technology
    ├── Finance & Accounting
    ├── Human Resources
    ├── Regulatory Affairs
    └── Safety & Environmental
```

### 1.2 Systems

1. Set the **Working in…** picker (top of every page) to **Tidewater
   Utilities**.
2. Go to **Systems** → **Import**.
3. Paste `test-data/utility/systems.csv`. Import.

You'll get ~25 systems: SCADA, GIS, CIS, AMI, hydraulic modelling,
plus shared corporate systems (ERP, HRIS, data warehouse).

### 1.3 People

People are imported **one file per department**. Set the *Working in…*
picker for each, then import:

| File | Scope to |
|---|---|
| `people-executives.csv` | Tidewater Utilities |
| `people-data-owners.csv` | Tidewater Utilities |
| `people-electric.csv` | Tidewater Electric |
| `people-water.csv` | Tidewater Water |
| `people-shared-services.csv` | Shared Services |
| `people-electric-generation.csv` | Power Generation |
| `people-electric-td.csv` | Transmission & Distribution |
| `people-electric-customer.csv` | Electric Customer Service |
| `people-electric-engineering.csv` | Electric Engineering |
| `people-electric-assets.csv` | Electric Asset Management |
| `people-water-production.csv` | Water Production |
| `people-water-distribution.csv` | Water Distribution |
| `people-water-wastewater.csv` | Wastewater Operations |
| `people-water-customer.csv` | Water Customer Service |
| `people-water-engineering.csv` | Water Engineering |
| `people-it.csv` | Information Technology |
| `people-finance.csv` | Finance & Accounting |
| `people-hr.csv` | Human Resources |
| `people-regulatory.csv` | Regulatory Affairs |
| `people-safety.csv` | Safety & Environmental |

### 1.4 Agents

1. Working in… **Tidewater Utilities**.
2. **Agents** → **Import** → paste `agents.csv`.

### 1.5 Seed the skill catalog

1. Navigate to **Organizations → Skills**.
2. Click **Seed standard skills**.

About 40 DAMA-aligned skills will land. The catalog feeds the qualified-
person checks you'll exercise in Module 6.

### Checkpoint

- Switch *Working in…* to **Tidewater Electric**. The People count in
  the left nav should drop to electric-division staff.
- Switch to **Tidewater Water**. Same again, different roster.
- This is **multi-tenant scoping** in action — every read filters by
  the active org.

---

## Module 2 — Get oriented (10 min)

### 2.1 The Working in… picker

Top of every page. This is the single most important control in
Procela. It scopes *everything* — what you see, what you can edit,
what AI runs against. Spend a minute switching between **Tidewater
Utilities**, **Tidewater Electric**, and **Tidewater Water** and
watching the Dashboard KPIs recompute.

### 2.2 Dashboard

The Dashboard's **Overview** strip shows the live KPI tiles. Each is a
hyperlink:

- **Value Streams** / **Processes** → Process Catalog
- **Data Assets** → Data Assets page
- **Systems** → Systems page
- **Coverage** → Data Mapping (where unmapped activities + unlinked
  assets surface)
- **Avg Health** → Data Assets sorted by health ascending (worst at
  top)

Skim the other dashboard sections: **My Dashboard** (your owned items),
**Program Maturity** (current governance phase), **Skill Gaps** (more
on this in Module 6).

### 2.3 The org tree

Open **Organizations → Structure**. The visualization shows the full
hierarchy you imported. Click any node — counts on the right pane
recompute, drill into a division or department to see its people.

### 2.4 People

Open **Organizations → People** with *Working in…* set to **Tidewater
Electric**. You should see the electric-division roster only. Try:

- The **Skill** filter (top toolbar) — narrow to everyone who holds a
  given competency
- The **Skill gaps** column (right side) — currently `—` for everyone
  because activities don't have required-skill data yet. We'll come
  back to this in Module 6.

---

## Module 3 — Define processes (15 min)

### 3.1 AI-generated process hierarchy for Electric

1. *Working in…* → **Tidewater Electric**.
2. Navigate to **Processes** → click the wand (**Generate processes**).
3. Procela calls Claude with the active org context. After 10–30
   seconds, a preview hierarchy appears.
4. Review: you should see electric-utility value streams — Outage
   Management, Generation, Transmission & Distribution, Customer
   Operations, Regulatory Compliance.
5. Click **Apply**.

### 3.2 Same wand, different division

1. Switch *Working in…* → **Tidewater Water**.
2. **Processes** → wand again.
3. Different output: Water Treatment, Distribution, Wastewater
   Operations, Customer Operations.

That's the active-org context driving Claude differently — same code
path, different result. The first run for each (industry + org) pair
hits Claude live; subsequent runs return the cached result instantly.
The badge on the review screen says *Specialised: <Org>*.

### 3.3 Walk the catalog

With *Working in…* on **Tidewater Electric**:

- Expand a value stream → process → sub-process → activity.
- Click an **Activity** node. The right panel shows level-specific
  fields: Owner, Responsible Role, Responsible Person, Systems,
  Required Skills, Inputs/Outputs, Status, Frequency, Risk Level.
- Try setting **Responsible Role** = `Field Operations Lead`,
  **Responsible Person** = a real person from your imported roster
  (use the picker — search by name).
- The **Status lifecycle** is Draft → Active → Deprecated. Click the
  status pill to advance it.

### 3.4 Inputs / Outputs panel

On the same activity, click **+ Add Input** in the I/O panel. The
segmented picker has three tabs:

- **Data Asset** — operational data this activity consumes
- **Governance Document** — a charter / policy / standard the activity
  references
- **Attachment** — uploaded file or URL

Try adding a Data Asset (we'll create some in Module 4).

---

## Module 4 — Register data + systems (10 min)

### 4.1 Data Assets

1. *Working in…* → **Tidewater Electric**.
2. **Data Assets** page → **+ Add data asset**.
3. Create a few real ones:

| Name | Description | Data Type | Trust Level |
|---|---|---|---|
| Outage Logs | Per-event SCADA records of distribution outages | Operational | Bronze |
| Customer Master | Service addresses, account status, billing terms | Master | Silver |
| Meter Reads | AMI 15-min interval consumption | Operational | Silver |
| Generation Output | Plant-level MWh by hour | Operational | Bronze |

4. Assign Owners and Stewards using the person picker.

### 4.2 Connect Assets to Systems

In each asset's edit form, set **System of Record** (e.g. Outage Logs
→ SCADA; Customer Master → CIS; Meter Reads → AMI). This is how
Procela knows which system carries the canonical copy.

### 4.3 Data Domains

1. **Data Domains** page → create three domains:
   - *Customer Data* (owner: a Data Owner from your imported people)
   - *Operational Data*
   - *Regulatory Data*
2. On each asset, assign it to a domain.

The domain assignments feed the Governance Groups page in Module 8.

---

## Module 5 — Connect processes to data (10 min)

### 5.1 Inline mapping on the catalog

The day-to-day mapping workflow is **inside the Process Catalog**, not
on the Mappings page.

1. Open an activity (e.g. *Outage triage*).
2. In the **Inputs / Outputs** panel, click **+ Add Input** → tab
   *Data Asset* → pick *Outage Logs*.
3. Add an output: **+ Add Output** → *Customer Master* (the activity
   updates the customer record with the outage event).

### 5.2 Cross-process review

1. Navigate to **Insights → Explore → Data Mapping**.
2. You'll see your mappings as a flat audit list. Three column highlights:
   - **Process Activity** — full breadcrumb (Value Stream → Process →
     Activity)
   - **Target** — typed tag (ASSET / DOCUMENT / ATTACHMENT) plus the
     target name and sub-detail
   - **Link Type** — `INPUT` / `OUTPUT` / `REFERENCE`
3. Try the **Batch Mapping Wizard** (top action) — matrix interface
   for creating many mappings at once.

### 5.3 Cross-division warning

This is the moment most platforms fail silently. Try this:

1. Working in… **Tidewater Water**.
2. Open a Water activity (e.g. *Water Quality Sampling*).
3. Add an input — try picking *Outage Logs* (an Electric asset).
4. Procela warns: *"Outage Logs is owned by Tidewater Electric, but
   Water Quality Sampling sits in Tidewater Water. Cross-division
   links usually mean the wrong target was picked — pick again, or
   confirm if this is genuinely a shared dependency."*

Cancel out. The default is **warn, not block** — confirming creates
the link normally.

---

## Module 6 — Exercise the skill value-loops (15 min)

The four cross-page workflows that turn the Skills catalog from data
into something operational. All four are exercised below.

### 6.1 Tag activities with required skills

1. Back on an electric activity. In the right panel, **Required
   Skills** is a multi-select.
2. Add 2–3 skills (e.g. for an outage activity: `Anomaly Detection`,
   `Stakeholder Management`).
3. Notice if an amber chip appears next to the picker: ***Responsible
   person lacks N required skills***. If so, the responsible person
   doesn't hold one of the skills you just added — this is the
   **qualified-person check**.

### 6.2 Skills on people

1. *Organizations → People* with *Working in…* = **Tidewater Electric**.
2. Open a person's detail (click their name).
3. Add a couple of skills to their profile.
4. Return to the activity panel — the amber chip should clear.

### 6.3 Find people by skill

1. People page toolbar — **Skill** dropdown.
2. Filter to `Anomaly Detection`. The roster narrows to holders.
3. Useful for staffing a new initiative.

### 6.4 Skill gaps column

Now the **Skill gaps** column on the People table is meaningful — it
shows the number of activities each person is responsible for that
require a skill they don't hold. Hover a number for the tooltip with
sample activity names.

### 6.5 Role recommendations

1. Click any DAMA role chip anywhere in the app (try **Governance →
   Roles** → click *Data Owner*).
2. The Role Detail drawer opens. Below "Skills typically needed" is
   **Best-matching people** — ranked by how many of the role's
   required skills each person already holds.
3. Click a row → jumps to that person's profile. Useful for filling
   unfilled roles.

### 6.6 Skill-gap report on the dashboard

Back to Dashboard. The **Skill Gaps** widget ranks the org's most
under-staffed required skills. Red = zero coverage (critical), amber
= tight, green = healthy. The link **Find people by skill →** jumps to
the People page.

---

## Module 7 — Assign accountability (10 min)

### 7.1 Governance Roles

1. **Governance → Roles** → **Assignments tab**.
2. Expand a category (Executive / Business / Technical) using the
   chevron. Note the **Expand all / Collapse all** controls at the
   top.
3. Click **CDO** (unfilled) → use the inline **+ Assign** → pick
   Susan Chen (from the executives import). Save.
4. Try the same for *Data Governance Lead* → Marisol Hadid.
5. Open the **Role Detail drawer** by clicking the *CDO* badge —
   you'll see the role definition, required skills, currently-held by,
   and best-matching people.

### 7.2 Per-division Data Owners

1. *Working in…* → **Tidewater Electric**.
2. **Governance → Roles** → click **Data Owner** in the sidebar.
3. **+ Assign** → Devon Kershaw, scope = **Tidewater Electric**.
4. Repeat for Tidewater Water (Yusuf Bashir) and Shared Services
   (Camille Petersen).

Data Owner is intentionally **per-division** in this fixture; one
person isn't responsible for the whole enterprise's data.

### 7.3 Governance Groups

1. *Working in…* → **Tidewater Utilities**.
2. **Governance → Groups** → click **Generate standard structure**.
3. The DAMA hierarchy lands: Council → Office → Committee →
   Stewardship → Working Groups → Communities of Practice.
4. Click the **Data Governance Committee**.
5. The **Expected Roles** panel shows the roles the group should have.
   Notice for domain-scoped roles (Data Owner, Domain Owner, Data
   Steward, Domain Steward, Data Architect) a sub-line under each
   holder lists their owned/stewarded domains, or `no data domains
   assigned` in red if they have none.

### 7.4 RACI Matrix

1. **Governance → Roles** → **RACI Matrix tab**.
2. The matrix is auto-derived from your role assignments and
   ownership data.
3. Click any cell to cycle R → A → C → I → clear as a manual override.
4. Look for **validation warnings** — rule violations (no R, no A,
   multiple A's) surface inline.

---

## Module 8 — Build a real report (10 min)

The Report Builder (shipped recently). This is where you produce real
artifacts for stakeholders.

### 8.1 First report: Activities by Risk

1. **Insights → Review → Reports** → **+ New report**.
2. **Starting entity**: Processes.
3. **Columns**: tick `Name`, `Level`, `Status`, `Risk Level`.
4. Under **Joined fields → Responsible Person**: tick `Name`.
5. Under **Joined fields → Required Skills**: tick `Name`.
6. **Filters**: add → field = `Level`, op = `equals`, value =
   `ACTIVITY`.
7. **Sort**: Risk Level descending.
8. The preview pane refreshes live (350 ms after each edit).
9. **Name**: *Activities by Risk*, **Description**: *All electric +
   water activities ranked by risk*. **Visibility**: Shared with org.
10. Save.

### 8.2 Second report: Data Assets without Owners

1. **+ New report** again.
2. Entity: Data Assets.
3. Columns: `Name`, `Description`, `Governance Tier`, `Health Score`.
4. Under **Joined fields → Owner**: tick `Name`.
5. Filter: `Owner ID` is empty.
6. Sort by `Health Score` ascending.
7. Save as *Ownerless data assets*.

### 8.3 What just happened

Every Report Builder report reads from the same **Logical Data Model**
(LDM) that the in-app pickers expose. When Procela later moves to
Postgres, the same LDM will translate to database views that Power BI
/ Tableau / Cognos can connect to with standard SQL credentials. The
business model is the source of truth on both paths.

---

## Module 9 — Find and fix gaps (10 min)

### 9.1 Gap Detection

**Insights → Review → Gap Detection** surfaces:

- **Unmapped activities** — activities with no data link
- **Ungoverned assets** — assets below Silver / Gold tier supporting
  critical processes
- **Ownerless items** — entities with no owner assigned

Each gap clicks through to the item where you can resolve it.

### 9.2 Data Mapping orphans

If you regenerated the process hierarchy in Module 3 (or deleted
activities), the Data Mapping page may show an orphan banner: *"N
orphan mappings found"*. Click **Delete all orphans** to clean them.

### 9.3 Skill Gaps revisited

Dashboard → **Skill Gaps** should now show real values now that
activities have required-skill data and people have skills.

### 9.4 Cross-page coherence

Test this end-to-end:

1. From Dashboard, click the **Coverage** KPI tile.
2. You land on Data Mapping with the unmapped-activity banner.
3. Click an unmapped activity → drops you into Process Catalog on
   that node.
4. Add a data-asset input from the panel.
5. Return to Data Mapping → the count went down by one.

The same data, different views — that's the Procela model.

---

## Module 10 — Governance program + documents (10 min)

### 10.1 Generate governance processes

1. *Working in…* → **Tidewater Utilities** (parent company).
2. **Processes** → **Generate governance processes** (separate wand
   from the operational one).
3. This creates a *governance* value stream alongside the operational
   ones — Phase 1 Foundation, Phase 2 Design, Phase 3 People &
   Process, Phase 4 Operationalisation.

### 10.2 Governance Documents

1. **Governance → Documents**.
2. The seed includes a **Charter** (CHA-001), **Data Policies**
   (POL-001), **Data Standards** (STD-001), and a few starter
   documents.
3. Add controls to a Policy: expand the row → controls panel. Each
   control has a type (Preventive / Detective / Corrective) and an
   automation mode (Human / Agent / Hybrid).

### 10.3 Governance Program Maturity

**Governance → Governance Program** shows the current phase + auto-
computed completion status. **Phase 1** is Foundation Definition;
the program can't launch until it's complete (the platform pops a
confirmation if you try to advance early, listing exactly what's
missing).

---

## Quick reference

### The Procela model in one paragraph

Procela's data model has three layers that meet in the middle. The
**business layer** (Value Streams → Processes → Sub-Processes →
Activities → Tasks) describes what the business does. The **data
layer** (Data Assets, Systems, Data Domains) describes what powers
it. **Mappings** are the bridge — they link activities to the data
assets / governance documents / attachments they consume or produce.
Wrapping all three are people (with their **skills** and **DAMA
roles**), grouped into **Governance Groups**, governed by
**Documents** (charters, policies, standards), and held accountable
via the **RACI Matrix**.

### Where things live

| If you're looking for… | Go to |
|---|---|
| The business model | Processes (Process Catalog) |
| Data registries | Data Assets, Systems, Data Domains |
| Cross-process audit of links | Insights → Data Mapping |
| Who does what | Organizations → People, Governance → Roles |
| Standing committees | Governance → Groups |
| Policies + standards | Governance → Documents |
| Reports + scorecards | Insights → Reports |
| Pivot exploration | Insights → Analysis |
| Where are the gaps? | Dashboard → Gaps section + Insights → Gap Detection |
| Help / shortcuts | Bottom-left nav → Help; press `?` for keyboard shortcuts |

### Keyboard shortcuts to know

- `?` — open the shortcut overlay
- `g then d` — go to Dashboard
- `g then p` — go to Processes (Catalog)
- `g then a` — go to Data Assets
- `g then s` — go to Systems
- `g then o` — go to People
- `g then r` — go to Reports
- `/` — focus search (on supported pages)

### Three things to demo to a stakeholder

1. **Generate processes for two divisions side-by-side.** Same wand,
   same code; the electric output is electric-utility, the water
   output is water-utility. That's active-org context driving AI.
2. **Cross-page link traversal.** From a Data Asset, *Where Used* →
   process steps consuming it. From a person, click a role chip →
   drawer. The cross-references make the business-process-first
   model tangible.
3. **RACI auto-derivation.** Assignments on the Catalog → RACI rows
   auto-derived → validation warnings flag rule violations (no R, no
   A, multiple A's).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Dashboard KPIs show 0 after import | Wrong *Working in…* scope. Switch to the org you imported into. |
| Can't see imported people on People page | Same as above — *Working in…* picker. People are scoped per org. |
| AI process generation hangs > 30 s | First run for an (industry + org) is a live Claude call. Subsequent runs hit the cache. Check the *Cached* / *Fresh from AI* badge. |
| Cross-division link warning won't dismiss | It's a soft warn, not block — confirm it to create the link, cancel to skip. |
| Orphan mappings appear after wand re-run | Regenerating processes mints new UUIDs. Use **Delete all orphans** on Data Mapping. |
| Sign-in hangs in dev mode | `REDIS_URL` set in `.env` without Redis running. Either unset it or start Redis. |
| New typecheck / test failure on trunk | CI runs on push; check the GitHub Actions tab for the actual error. Locally: `npm run lint --workspaces && npm test`. |

---

## What to read next

- `CLAUDE.md` (repo root) — the product brief; what Procela is for
- `test-data/utility/README.md` — companion to this guide; the data
  reference
- In-app **Help** page — feature-by-feature reference (this guide is
  a workflow walkthrough; Help is a manual)
