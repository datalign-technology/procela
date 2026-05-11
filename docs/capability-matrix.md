# Capability Matrix

Live tracking of Procela's feature coverage against the four primary
benchmarks: **Collibra**, **Alation**, **Atlan**, and **Ataccama**.

The source of truth is [`capability-matrix.csv`](./capability-matrix.csv) —
open it in Excel or Google Sheets (File → Import → Upload) for the
filterable, sortable view.

## Status legend

| Status | Meaning |
|---|---|
| **Built** | Implemented and verified end-to-end in this codebase. |
| **Partial** | Working for one path; another path still missing. |
| **Stubbed** | UI / data model in place, but the underlying execution is simulated. |
| **Designed** | Schema or architectural decision made, implementation pending. |
| **Not Started** | No code yet. |

## Priority legend

| Priority | Meaning |
|---|---|
| **P0** | Required to ship a credible MVP / production v1. |
| **P1** | Important — table stakes against incumbents in target markets. |
| **P2** | Differentiator or nice-to-have; can ship without. |
| **P3** | Deferred — long-term parity, not pursuing now. |

## How to use

1. **Update the CSV** when a feature changes status. Commit the
   change so the diff explains what moved.
2. **Filter by Priority** to see the next batch of work — sort by
   `Priority` ascending, then by `Procela_Status` to surface P0/P1
   items still in `Not Started` / `Stubbed`.
3. **Filter by Category** when scoping a sprint to a particular
   area (e.g. lineage extraction, real connectors).
4. **The `Gap_To_Close` column** is the concrete next-step note
   per row — handy when triaging into a backlog.

## Quick summary (snapshot)

| Category | Built | Partial / Stubbed | Not Started |
|---|---|---|---|
| Catalog | 6 | 0 | 0 |
| Data assets | 9 | 1 | 0 |
| Glossary | 3 | 0 | 0 |
| Systems | 3 | 0 | 1 |
| Connections | 3 | 2 | 0 |
| Lineage | 1 | 1 | 2 |
| Data quality | 3 | 0 | 1 |
| Governance | 9 | 0 | 1 |
| Domains | 2 | 0 | 0 |
| Discovery | 2 | 0 | 1 |
| AI | 4 | 0 | 1 |
| Auth | 2 | 0 | 2 |
| Audit | 1 | 1 | 0 |
| Infrastructure | 3 | 0 | 3 |
| UX | 4 | 0 | 0 |
| Misc | 0 | 0 | 3 |

Where it actually matters: of the **P0** items, the open ones are
real database connectors, auto-extracted lineage, SSO, Postgres
backend, and live SaaS hosting. Everything else is shipable wins or
strategic defers.
