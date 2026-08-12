# UI Consistency Audit — findings backlog

A systematic scan of `packages/frontend/src` across five dimensions
(colour tokens, typography, component reuse / spacing, accessibility,
loading & responsive), run after the list-consistency series (DataTable
sweep) and the visual-primitive + error-state polish (#296, #297).

The design rules being audited against live in `/CLAUDE.md` (Frontend
Design Conventions) and `packages/frontend/src/components/README.md`.

**Status key:** ✅ done · ⏳ in progress · ☐ open

Line numbers are indicative (from the scan) — locate by content, as they
drift with edits.

---

## P0 — Quick wins  ✅ (this PR)

| # | Finding | Where | Fix | Status |
|---|---------|-------|-----|--------|
| 1 | `var(--color-danger, #ef4444)` — `--color-danger` is not a defined token, so it always renders the raw red fallback | `DashboardPage`, `ExecutiveReportPage`, `ScorecardPage` (page-level error divs) | → `var(--color-error)` | ✅ |
| 2 | DataTable list wrapped in `overflow:'hidden'` → a wide table clips with no scroll (12 peer pages use `auto`) | `SystemsPage`, `BusinessGlossaryPage` | → `overflow:'auto'` | ✅ |
| 3 | Hand-rolled 28px page title (rest of app is 26px `PageHeader`) | `HelpTrainingPage` | → `<PageHeader>` | ✅ |
| 4 | Icon-only buttons with no accessible name | `SopsPage` reorder ▲/▼, `DocFields` remove-× | add `aria-label` (+ `aria-hidden` glyph) | ✅ |
| 5 | Hand-rolled off-brand **blue** "N selected" bars (brand is teal) | `ProcessCatalogPage`, `GovernanceGroupsPage`, `OperationsManualPage`, `OrganizationsPage` | → `<BulkActionBar>` | ✅ |

---

## P1 — Accessibility (highest user impact)

- **☐ A1 [HIGH] Keyboard-inaccessible controls.** `<div/span/tr onClick>`
  used as controls with no `role="button"`, `tabIndex`, or key handler —
  keyboard/SR users cannot reach them. Load-bearing cases: org-tree
  select (`PeoplePage`), domain 360 (`DataDomainsPage`), EnterpriseView
  node inspect, gap/section toggles (`GapDetectionPage`,
  `GovernanceProgramPage`), and **every inline-edit trigger** (Systems,
  DataAssets, PersonDetail, DocFields, IOPanel, TreeNode, ValueStreamWizard,
  Comparison). Model to copy: `components/InfoTip.tsx`, `Card.tsx`
  (`onClick` auto-flips role/keyboard). *Largest a11y gap; a real sweep.*
- **☐ A2 [MED] Form labels not associated.** 292 `<label>` but only 3
  `htmlFor`; ~250 styled sibling labels announce no field name. All CRUD
  forms. Fix: `id` + `htmlFor` (or wrap, or `aria-label`).
- **☐ A3 [MED] Unlabeled filter/search controls.** Hand-rolled
  selects/search without `aria-label` (`SopsPage`, `GovernanceCalendarPage`,
  `PeoplePage`) vs the shared `FilterBar` which wires it.
- **☐ A4 [MED] Hand-rolled modals** missing `role="dialog"`/`aria-modal`/
  focus-trap/Esc — ~12 spots (Agents, Skills, Connections, DataDomains,
  Login, DataQualityRulesModal, LinkConnectionModal, OnboardingWizard,
  SyncConnectionWizard, ConnectorsSection). The shared `<Modal>` provides
  all of it.

## P2 — Shared-component adoption gaps (biggest by volume)

- **⏳ C1 [HIGH] Button primitive under-adopted.** *(Correction: the audit
  first read this as "no shared button primitive" — a `<Button>` primitive
  **already exists** at `components/Button.tsx` with primary/secondary/danger/
  ghost variants + sm/md sizes + loading/fullWidth. It was just adopted by
  only **3 files**; the scan matched on a CSS class and missed the
  component.)* The real gap: `btnPrimary`/`btnSecondary` `CSSProperties`
  objects are still hand-rolled in **29 files** (~150 call sites). `Button`'s
  `secondary` variant already matches `btnSecondary` exactly, so adoption is
  a faithful swap. **Done:** `Button` given a test (was untested) + enhanced
  to forward native props (`title` etc.) so it's a true drop-in; documented
  in the README; **SkillsPage** migrated as the reference. **Remaining:** the
  other 28 files — a batched worktree-agent sweep like the DataTable series.
- **☐ C2 [HIGH] Hand-rolled `Card`.** surface + border + radius + shadow
  repeated inline across ~20 pages; drives the padding **16-vs-20** drift.
  → adopt `<Card>`.
- **☐ C3 [MED] Hand-rolled `SectionLabel`.** ~35 uppercase eyebrow labels
  across ~12 pages at 4 sizes (10/11/12/13) × 2 weights × 3 letter-spacings;
  primitive adopted by only 2 files. → adopt `<SectionLabel>`.
- **☐ C4 [MED] `FieldStack` not adopted.** Per-field `marginTop/Bottom`
  (928 occurrences, 55 files); only 3 files use the rhythm primitive. →
  adopt on the long form pages.

## P2 — Colour tokenisation (retune / brand risk)

- **☐ D1 [MED] `var(--color-primary-light, #dbeafe)`** — blue fallback for
  a teal token; 16 filter-pill occurrences → drop the fallback.
- **☐ D2 [MED] Lone destructive/semantic colours not tokenised.** Standalone
  `#ef4444`/`#dc2626` destructive-button backgrounds, and success/warning/
  error status ternaries duplicating tokens (~15 spots: Dashboard,
  ExecutiveReport, Scorecard, GapDetection, TreeNode, IOPanel, DataQuality
  widgets, ToastContainer). *Palette-object bg+fg badge pairs are the
  documented exception and correctly stay hex.*
- **☐ D3 [LOW] Blue info/help callout panels** in a teal-brand app
  (`ProcessCatalogPage`, `GovernanceGroupsPage` banners) → `--color-primary*`.
- **☐ D4 [LOW] Modal shadow/radius drift** — one-off `boxShadow`/
  `borderRadius` on overlays instead of `--shadow-lg`/`--radius-lg`
  (DataDomains, Connections, Login).

## P2 — Typography

- **☐ T1 [MED] Modal/dialog title size drift** — same semantic level
  rendered 14/15/16 × weight 600/700 across pages (Skills, People,
  DecisionRights, Sops, DataDomains). → one shared modal-title size.
- (T2 = the `SectionLabel` adoption above, C3.)

## P3 — Loading & responsive / minor

- **☐ E1 [MED] `ProcessDataMapPage`** fetches with no loading affordance —
  the SVG pops in. Add a skeleton/spinner branch.
- **☐ E2 [MED] Loading-text vs `SkeletonRows`** — non-list surfaces
  hand-roll a "Loading…" line with drifting copy (`...` vs `…`); no shared
  `<Spinner>`. → introduce `<Spinner label>` and standardise wording.
- **☐ E3 [MED] `TruncatedText` gaps** — long free-text cells rendered raw
  (`MappingsPage` Notes, `DecisionRightsPage` description); `DataAssetsPage`
  reinvents the ellipsis+title inline. → `<TruncatedText>`.
- **☐ E4 [LOW] Skeleton shape drift** — `ConnectionsPage`/`DataAssetsPage`
  skeletons show far fewer columns than the real table.
- **☐ E5 [LOW] `⚙` glyph for the Agent entity** (has a `/agents` sidebar
  route) → `renderNavIcon('/agents')` (GovernanceGroups, DamaRoles,
  GovernanceGroupDetail); hand-rolled tables with no overflow wrapper
  (`OrphanAssetsPage`, `AuditLogPage`).

---

## Themes / recommended sequencing

1. **P0 quick-wins** — ✅ this PR.
2. **`<Button>` primitive + adopt across 23 pages** (retires
   `btnPrimary`/`btnSecondary`) — highest-volume consistency win.
3. **Accessibility PR(s)** — A1 keyboard controls + A2 form labels
   (highest *user* impact).
4. **`Card` / `SectionLabel` / `FieldStack` adoption** + **colour
   tokenisation** — parallelisable sweeps (the extract-then-sweep shape of
   the DataTable series).
5. **`<Spinner>` primitive** + loading/`TruncatedText` cleanup.

Two genuine *new-primitive* gaps the earlier series didn't cover: a
**`Button`** and a **`Spinner`**. Everything else is *adoption* of
primitives that already exist, or colour tokenisation.
