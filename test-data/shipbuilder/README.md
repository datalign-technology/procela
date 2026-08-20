# Shipbuilder Test Data — Momentum Industries

Fictional defence / military-shipbuilding holding company, sized to
exercise Procela's entity model against a heavy-industry org shape:

- **Momentum Industries** (holding, Defense & Shipbuilding industry)
  - **Momentum Tidewater Shipyard** — carriers + submarines + reactor engineering
  - **Momentum Gulf Shipyard** — surface combatants + amphibious ships
  - **Mission Technologies** — cyber/intelligence + fleet support
  - **Corporate Services** — Finance, HR, Supply Chain, Quality Assurance

This is the **default** demo tenant (the utility/Tidewater set is the
alternate industry). All names, emails, and figures are fictional.

## Two ways to load it

- **Scripted** (org tree + DAMA governance-role people, via the REST API):
  with the app running, `npm run db:seed:momentum -w packages/backend`
  (or `node packages/backend/scripts/seed-momentum-governance.js
  http://127.0.0.1:3001/api/v1`).
- **CSV import** (the broader people/systems set documented below): the
  in-app **Import** buttons on the Organizations, Systems, and People
  pages. The two overlap on the org hierarchy but aren't identical — the
  script is governance-role-focused; these CSVs carry the wider
  people/systems roster.

## Contents

| File | Purpose | Import target |
|---|---|---|
| `organizations.csv` | Full org hierarchy (company → divisions → departments). | Import **first** — everything else references orgs by name. Leave the parent blank (top-level). |
| `systems.csv` | 25 enterprise + operational systems (ERP, CRM, PLM, MES, CAD/CAM, etc.). | Import **second**. Scope is the "Working In" org. |
| `momentum-corporate-people.csv` | Corporate executives (CEO, CFO, and the rest of the C-suite). | **Momentum Industries** (enterprise). |
| `people-data-governance.csv` | The DAMA governance roster — Data Owners and stewards across the enterprise and divisions. | **Momentum Industries** (enterprise); scope each person's governance role to its division afterwards. |
| `people-tidewater.csv` | Momentum Tidewater Shipyard division leadership. | **Momentum Tidewater Shipyard** (the division). |
| `people-carrier-construction.csv` | Aircraft-carrier program people. | **Carrier Construction**. |
| `people-submarine-construction.csv` | Submarine program people. | **Submarine Construction**. |
| `people-gulf.csv` | Momentum Gulf Shipyard leadership. | **Momentum Gulf Shipyard** (the division). |
| `people-mission-tech.csv` | Mission Technologies leadership. | **Mission Technologies** (the division). |
| `people-supply-chain.csv` | Procurement / logistics people. | **Supply Chain**. |
| `people-quality.csv` | Quality-assurance people. | **Quality Assurance**. |
| `people-finance.csv` | Finance & accounting people. | **Finance & Accounting**. |
| `customer_dq_test.csv` | A tiny `id,email,age,status` customer extract with a few dirty rows — **not** an org/people import. | Use it to exercise **Data Quality** rules (null/format/range checks), not the Import buttons. |

## Recommended import order

1. **Organizations** — Organizations page → Import → paste
   `organizations.csv`, parent blank. Creates the whole tree in one pass.
2. **Systems** — Systems page → Import → paste `systems.csv`. Scope is the
   currently-selected org in the "Working In" dropdown.
3. **People** — select the target org in the "Working In" dropdown, then
   on the People page click Import and paste the matching `people-*.csv`.
   Repeat per file using the **Import target** column above.

## Format notes

People CSVs here use four columns — `Name,Email,Role,Title` — where `Role`
is the platform role (`SUPER_ADMIN` | `ORG_ADMIN` | `EDITOR` |
`CONTRIBUTOR` | `VIEWER`). There is no `Org` column, so each file lands in
the org picked in the import dialog (hence one file per target above).

The backend CSV parser is RFC-4180-compliant (quoted cells, `""` escapes,
LF/CRLF), so anything the in-app **Export** button emits round-trips back
through **Import**. These files avoid quoted cells just to stay
grep-friendly.

## Why this data exists

It's the defence/shipbuilding counterpart to the utility (Tidewater) set,
so you can demo Procela's industry-template flow and compare behaviour
across industries. See [`docs/TRAINING.md`](../../docs/TRAINING.md) for a
click-by-click walkthrough of the model (written against Tidewater; the
shape applies here once this data is loaded).
