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
| `people-executives.csv` | C-suite and division presidents, plus the enterprise Data Governance Lead. | Assign to **Tidewater Utilities** on import. |
| `people-data-owners.csv` | Division-level Data Owners (Electric / Water / Shared Services). | Assign to **Tidewater Utilities** on import. Once imported, assign each person a `DATA_OWNER` governance role scoped to their respective division. |
| `people-electric.csv` | Division-level governance lead for Tidewater Electric. | Assign to **Tidewater Electric** (the division itself, not one of its departments). |
| `people-water.csv` | Division-level governance lead for Tidewater Water. | Assign to **Tidewater Water**. |
| `people-shared-services.csv` | Division-level governance lead for Shared Services. | Assign to **Shared Services**. |
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

## Governance role coverage

The data is seeded so that every organization level — the enterprise,
each division, and each department — has at least one person directly
attached whose job title is a governance role. That way the
"Working in&hellip;" picker always lands you on a scope that has a
real person to look at, and the Role Detail drawer / RACI matrix /
governance group memberships have something to show at every level.

| Level | Where the governance-titled person lives |
|---|---|
| **Enterprise** (Tidewater Utilities) | Chief Data Officer + Data Governance Lead in `people-executives.csv`; Data Owners in `people-data-owners.csv`. |
| **Division** (Electric / Water / Shared Services) | One Director Data Stewardship per division in `people-electric.csv` / `people-water.csv` / `people-shared-services.csv`. |
| **Department** (everything below the divisions) | A `Data Steward <Domain>` per department, in the matching `people-<dept>.csv` file. |

The role-to-person matrix below is unchanged; it documents which
DAMA role each named person plays. Useful when demonstrating the
Role Detail drawer, RACI matrix, and governance group memberships.

| Role | Person | File | Scope it's normally assigned at |
|---|---|---|---|
| Chief Data Officer | Susan Chen | `people-executives.csv` | Enterprise (Tidewater Utilities) |
| Data Governance Lead | Marisol Hadid | `people-executives.csv` | Enterprise |
| Data Owner | Devon Kershaw / Yusuf Bashir / Camille Petersen | `people-data-owners.csv` | Division (one each for Electric / Water / Shared Services) |
| Business Data Steward | one per department (titled `Data Steward [Domain]`) | the `people-<dept>.csv` files | Department |
| Technical Data Steward | Linnea Forsberg | `people-it.csv` | Enterprise / IT |
| Data Quality Analyst | Rashid Banerjee | `people-it.csv` | Enterprise / IT |
| Data Architect | Jocelyn Mercer | `people-it.csv` | Enterprise |
| Data Custodian | Marisa Vega | `people-it.csv` | Enterprise / IT |
| Data Engineer | Kwame Osei | `people-it.csv` | Enterprise / IT |
| Database Administrator | Ezra Bloom | `people-it.csv` | Enterprise / IT |

Data Owner is the only role where the test data deliberately includes
multiple people — one per division — because that role is normally
held at the division (or domain) level rather than the enterprise.
Other roles are scoped to a single person here just so the demo data
stays small; nothing prevents you from adding more.

## Why this data exists

It exercises a different industry than the default Huntington Ingalls
sample data so you can demo Procela's industry-template flow, compare
behaviour across industries, or spin up a fresh environment without
loading the defence/shipbuilding set. All names, email addresses and
headcount numbers are fictional.
