# Utility Test Data — Tidewater Utilities

Fictional investor-owned utility holding company with electric and water
subsidiaries, sized to exercise most of Procela's entity model:

- **Tidewater Utilities** (holding, Utilities industry)
  - **Tidewater Electric** — 1.4M customers, generation + T&D
  - **Tidewater Water** — 400K customers, potable + wastewater
  - **Shared Services** — IT, Finance, HR, Regulatory, Safety

## Contents

| File | Purpose | Notes |
|---|---|---|
| `organizations.csv` | Org hierarchy | Import first — everything else references orgs by name. |
| `systems.csv` | Electric + water operational systems (SCADA, GIS, CIS, AMI, hydraulic modeling) + shared corporate systems. | Import second. |
| `people-executives.csv` | C-suite and division presidents. | Assign to **Tidewater Utilities** on import. |
| `people-electric-generation.csv` | Generation operations department. | Assign to **Power Generation**. |
| `people-electric-td.csv` | Transmission & Distribution. | Assign to **Transmission & Distribution**. |
| `people-electric-customer.csv` | Electric customer ops. | Assign to **Electric Customer Service**. |
| `people-electric-engineering.csv` | Electric planning and engineering. | Assign to **Electric Engineering**. |
| `people-electric-assets.csv` | Electric reliability and asset mgmt. | Assign to **Electric Asset Management**. |
| `people-water-production.csv` | Water treatment plants. | Assign to **Water Production**. |
| `people-water-distribution.csv` | Water distribution ops. | Assign to **Water Distribution**. |
| `people-water-wastewater.csv` | Wastewater operations. | Assign to **Wastewater Operations**. |
| `people-water-customer.csv` | Water customer ops. | Assign to **Water Customer Service**. |
| `people-water-engineering.csv` | Water engineering. | Assign to **Water Engineering**. |
| `people-it.csv` | Enterprise IT / OT cybersecurity / data platform. | Assign to **Information Technology**. |
| `people-finance.csv` | Finance and regulatory accounting. | Assign to **Finance & Accounting**. |
| `people-hr.csv` | HR / labor relations / L&D. | Assign to **Human Resources**. |
| `people-regulatory.csv` | NERC CIP, EPA SDWA, rate filings. | Assign to **Regulatory Affairs**. |
| `people-safety.csv` | Safety, environmental, emergency prep. | Assign to **Safety & Environmental**. |
| `agents.csv` | AI models, pipelines, bots, service accounts — the kind an analytics utility runs. | Assign to **Tidewater Utilities** (or a more specific org if you prefer). |

## Recommended import order

1. **Organizations** — on the Organizations page, click Import, paste
   `organizations.csv`, leave the parent blank (top-level). This creates
   the whole hierarchy in one pass.
2. **Systems** — Systems page → Import → paste `systems.csv`. Scope is
   the currently-selected org in the "Working In" dropdown.
3. **People** — select the target org in the "Working In" dropdown,
   then on the People page click Import and paste the corresponding
   `people-*.csv`. Repeat for each department.
4. **Agents** — Agents page → Import → pick the target org in the
   dialog → paste `agents.csv`.

## Format notes

The backend CSV parser uses a naive comma split — it does **not**
understand quoted commas. Descriptions and titles here avoid commas
for that reason. If you edit the files, keep that in mind or the row
will silently skip or land in the wrong column.

## Why this data exists

It exercises a different industry than the default Huntington Ingalls
sample data so you can demo Procela's industry-template flow, compare
behaviour across industries, or spin up a fresh environment without
loading the defence/shipbuilding set. All names, email addresses and
headcount numbers are fictional.
