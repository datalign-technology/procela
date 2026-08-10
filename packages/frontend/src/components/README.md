# Frontend shared components

The small set of primitives every page composes from. A
design-consistency review found 50+ pages hand-rolling equivalents
of these; the sweep migrated the worst offenders and shipped these
as the durable answer.

> **Rule of thumb — before you write inline CSS on a page, check
> this list.** If a primitive here covers your case, use it. Do not
> add a variant of one of these to your page.

For the concise rules (what to use, what to avoid), see the
"Frontend Design Conventions" section in `/CLAUDE.md` — this file
is the deeper reference with props, examples, and rationale.

---

## Layout

### `<Page>`

Every routed page renders inside `<Page>`. Width comes from a
preset — never inline `maxWidth` on your page's outer div.

```tsx
import Page from '@/components/Page';

export default function MyPage() {
  return (
    <Page>            {/* default — no width constraint */}
      <PageHeader title="Systems" />
      …
    </Page>
  );
}
```

Widths:

- `default` — full page width. Tables, dashboards, most operational
  surfaces.
- `narrow` — 820px, centred. Long-form reading (HelpPage,
  HelpTrainingPage).
- `wizard` — 820px, centred. Stepped flows (ValueStreamWizard,
  AssignOwnersPage, SetupHubPage).

Bottom padding via `padding` prop when the page needs breathing room
before the next screen: `<Page padding="8px 0 64px">`.

---

### `<PageHeader>`

The band at the top of every page. Title (26px) + subtitle + right-
aligned actions. Optional kicker (eyebrow) and meta row.

```tsx
<PageHeader
  kicker="Policy · POL-007"
  title="Data Retention Policy"
  subtitle="Defines how long each data class is retained."
  meta={<StatusBadge variant="success">Active</StatusBadge>}
  actions={<button className="btn-primary">Edit</button>}
/>
```

**Never hand-roll an `<h1>` at the top of a page.** The audit found
two pages doing this (AssignOwners, SetupHub) — both read a full
point smaller than every other page. Both now use PageHeader.

---

### `<FieldStack>`

The vertical-rhythm primitive. A flex column that owns the spacing
between its children from a single spacing token, so the gap between
fields is uniform no matter which fields render (a detail panel that
shows different fields per entity type / status no longer has its gaps
jump around).

```tsx
import FieldStack from '@/components/FieldStack';

<FieldStack gap="section">        {/* stacked panels — 16px */}
  <FieldStack>                     {/* form/detail rows — 8px (default) */}
    <DocField … />
    <DocRoleField … />
    <DocSystemsField … />
  </FieldStack>
  <IOPanel … />
  <DependenciesPanel … />
</FieldStack>
```

Gaps map to the `--space-*` tokens: `tight` (4px, dense chip rows /
sub-notes), `field` (8px, the default — between form fields), `section`
(16px, between panels). **Children must not add their own vertical
`margin`** — the stack owns that axis. If a child needs to sit tighter
or looser, it belongs in a different gap tier, not an ad-hoc margin.
Reference adoption: `pages/process-catalog/TreeNode.tsx`.

---

## Content containers

### `<Card>`

The standard content container. `background: var(--color-surface)`
+ `1px border` + `var(--radius-md)` + `var(--shadow-sm)` +
`padding: 16`. Do NOT repeat those five properties inline.

```tsx
import Card from '@/components/Card';

<Card>
  <SectionLabel>Governance & ownership</SectionLabel>
  <PersonPicker … />
</Card>

<Card padding="1.5rem" borderColor="#fecaca">
  {/* Destructive intent — red border */}
  <h2 style={{ color: '#991b1b' }}>Reset everything</h2>
  …
</Card>
```

Props:

- `padding` — default 16; long-form content commonly uses 24; pass 0
  to opt out (e.g. wrapping a table that supplies its own).
- `marginBottom` — for vertical stacks.
- `radius` — `sm` | `md` (default) | `lg`.
- `shadow` — `none` | `sm` (default) | `md` | `lg`.
- `borderColor` — override for destructive/warning intent
  (`#fecaca` red, `#fde68a` amber).
- `onClick` — makes the card interactive; auto-flips
  `role="button"` + keyboard focus + pointer cursor.

---

### `<SectionLabel>`

The uppercase section header used inside cards ("Governance &
Ownership", "Advanced fields", "Data Domain"). Style is
intentionally not customisable — the point is consistency.

```tsx
import SectionLabel from '@/components/SectionLabel';

<Card>
  <SectionLabel>What is this data?</SectionLabel>
  <input … />
</Card>
```

**If a label needs to look different, it's probably an `<h2>` or
`<h3>`, not a section label.** The audit found this pattern rendered
~130 times with inconsistent sizes (9/10/11/12/13) and weights
(600/700); the component ends that category.

Props:

- `marginBottom` — default 8; pass 0 for side-by-side layouts, 4
  for tight groupings.

---

## Lists

### `<TruncatedText>`

Single-line ellipsis + hover tooltip for list-row cells. Combined
with the global `table th, table td { white-space: nowrap; }` rule,
this keeps every list uniform-height.

```tsx
import TruncatedText from '@/components/TruncatedText';

<td style={{ maxWidth: 400 }}>
  <TruncatedText text={sys.description} emptyPlaceholder="--" />
</td>
```

Parent `<td>` supplies the `maxWidth`; the child clips at that width.
Do NOT `overflow: hidden` on the `<td>` directly — that requires
`display: block` which breaks table layout.

Never re-enable wrap on a list. If a cell has genuinely long
content, use TruncatedText; if you want to show more, add a detail
panel or an accordion.

---

## Interactive

### `<SecondaryButton>`

The neutral Cancel / Close / Later affordance. Do NOT hand-roll the
`transparent bg + grey border + grey text` button style.

```tsx
import SecondaryButton from '@/components/SecondaryButton';

<SecondaryButton onClick={() => setSelectedIds(new Set())}>
  Clear Selection
</SecondaryButton>
```

Props:

- `size` — `sm` (default) matches toolbars/dialogs, `md` matches
  form-submit-adjacent cancels.

The audit found the exact same 8-property inline style copy-pasted
verbatim across 18 pages. Two of those properties (`#6b7280`,
`#d1d5db`) didn't map to any CSS variable — the component swaps them
to `var(--color-text-secondary)` + `var(--color-border)`, identical
today but coupled to the palette going forward.

---

### `<WizardProgress>`

Step-bar at the top of any multi-step flow.

```tsx
import WizardProgress from '@/components/WizardProgress';

<WizardProgress
  steps={['Industry', 'Generate', 'Review', 'Apply']}
  current={loading ? 1 : template ? 2 : 0}
  activeFill={loading ? Math.min(0.95, progressChars / TOTAL) : undefined}
/>
```

`activeFill` (0..1) drives a continuous fill on the active pill —
used by the Process Wizard's Generate step so the step-bar and the
big token-progress bar underneath can't disagree.

---

## Icons

### `renderNavIcon(route, { size, strokeWidth })`

Renders the same SVG the sidebar uses for a given route, at a chosen
size. Card headers, empty-state heroes, dashboards — anywhere a menu
item is visually referenced.

```tsx
import { renderNavIcon } from '@/components/navIcons';

<span>{renderNavIcon('/systems', { size: 24 })}</span>
```

Do NOT hand-pick Unicode glyphs (⚙, ⛁, ☰, ☻, etc.) for entities
that have a sidebar entry. The Enterprise View / Gap Detection /
Dashboard Quick Actions retrofits all went through this helper.

---

## Colours

CSS variables from `styles/global.css`. Never inline hex where a
variable exists.

**Semantic — swap direct:**

| Purpose | Variable | Hex today |
|---|---|---|
| Error / destructive text | `var(--color-error)` | `#dc2626` |
| Warning text | `var(--color-warning)` | `#d97706` |
| Success text | `var(--color-success)` | `#16a34a` |

**Structural:**

- `var(--color-primary)` / `--color-primary-hover` / `--color-primary-light`
- `var(--color-text)` / `--color-text-secondary` / `--color-text-muted`
- `var(--color-bg)` / `--color-surface` / `--color-border`

**When to keep hex:** palette-object entries — `{ bg: '#fee2e2',
color: '#dc2626' }` — where the hex is paired with a companion `bg`
to define a semantic-badge colour scheme. Those should NOT be
swapped to CSS variables; if the semantic variable is retuned, the
palette entry shouldn't drift.

---

## Radius + shadow tokens

```
--radius-sm: 3px   — small chips, mini-buttons
--radius-md: 6px   — cards, dialogs, form fields  (default)
--radius-lg: 10px  — modal overlays, large panels

--shadow-sm: minimal lift  (default card look)
--shadow-md: hover-lift on interactive cards
--shadow-lg: modal / dropdown overlays
```

Never hand-roll `boxShadow: '0 20px 60px rgba(0,0,0,0.25)'`. The
audit found 5 different hand-rolled shadow values across modal
panels; use `var(--shadow-lg)` for that layer.

---

## Where to look for examples

- **`Card` in the wild** — `ResetAllDataPanel.tsx`
- **`SectionLabel` in the wild** — `DataAssetsPage.tsx` (form
  section headers, 360-view section headers)
- **`TruncatedText` in the wild** — `SystemsPage.tsx` description
  column
- **`SecondaryButton` in the wild** — `AgentsPage.tsx`,
  `ConnectionsPage.tsx`, `DataQualityPage.tsx`, `DataLineagePage.tsx`
- **`WizardProgress` in the wild** — `ValueStreamWizard.tsx`,
  `SyncConnectionWizard.tsx`
- **`renderNavIcon` in the wild** — `EnterpriseViewPage.tsx`
  (`TYPE_CONFIG`), `GapDetectionPage.tsx` (`GAP_SECTIONS`),
  `DashboardPage.tsx` (Quick Actions)

Read one of these before wiring your own; the pattern is usually a
1-1 fit.
