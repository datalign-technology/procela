// ──────────────────────────────────────────────────────────────────────────
// navConfig — the source of truth for sidebar structure.
//
// Lives outside Layout.tsx so the data tables don't bury the shell logic
// (Layout used to be ~1700 lines, most of it lookup tables). The shape
// here is:
//
//   navSections      ordered list of grouped sections rendered as the
//                    accordion in the desktop sidebar.
//   ROUTE_GROUPS     route-prefix aliases used to decide which item is
//                    "active" so /report → /reports highlights Reports.
//   GET_STARTED_ITEM the conditional "Get Started" entry pinned at the
//                    top of the rail while setup is incomplete.
//   bottomNavItems   the Settings / Help cluster pinned to the bottom.
//   MOBILE_PRIMARY   the four primary destinations pinned to the mobile
//                    bottom bar; the fifth slot is the Menu button.
//
// `openHelpWindow` lives here because both the sidebar and the top-bar
// Help button call it; keeping it next to the Help nav item makes the
// behavioural contract obvious.
// ──────────────────────────────────────────────────────────────────────────

// `label` is what shows in the sidebar; `titleLabel`, when set,
// overrides the browser tab title so a short sidebar label (e.g.
// "Structure" inside the Organizations section) can still produce a
// meaningful tab title ("Organizations").
export type NavItem = { to: string; label: string; titleLabel?: string };

// `items` is always the flat source of truth (active-state, flyout,
// collapsed icon). `subGroups`, when present, only adds labelled
// dividers in the expanded accordion so a heavy section (Governance)
// reads as Setup / Operate / Analyze instead of an 11-item wall.
export type NavSection = {
  label: string | null;
  items: NavItem[];
  subGroups?: { label: string; itemTos: string[] }[];
  adminOnly?: boolean;
};

// Opens the Help guide in a separate window. Shared by the top-bar
// Help button and the sidebar Help item so both behave identically.
// The named target means repeated clicks focus the same window
// instead of spawning duplicates.
export function openHelpWindow() {
  window.open('/help', 'procela-help', 'popup,width=1100,height=900,noopener,noreferrer');
}

// Opens the Training Guide in its own popup window, matching the Help
// guide pattern exactly — same dimensions, same chrome-stripped reading
// view, separate named target so the two windows can coexist.
export function openTrainingWindow() {
  window.open('/help/training', 'procela-training', 'popup,width=1100,height=900,noopener,noreferrer');
}

// Plain-noun buckets so users can find things by what they ARE, not
// by which DAMA phase they belong to. The Organizations section is
// the "who" of the platform — the company structure plus the humans
// and AI agents that act within it, along with the skills those
// actors carry. Data / Systems / Governance / Insights follow as the
// other domains.
export const navSections: NavSection[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard' },
    ],
  },
  {
    // "Organizations" reads as the cross-cutting "who" of the platform:
    // the structural org tree plus the people, AI agents and skills
    // that live within it. Agents was previously parked next to
    // Settings to avoid being missed under a "People" heading; the
    // broader "Organizations" label makes the AI-bot/human pairing
    // less misleading.
    label: 'Organizations',
    items: [
      // Label is "Structure" inside the Organizations section so it
      // doesn't echo the section title — the destination is still the
      // org tree at /organizations, and the browser tab still reads
      // "Organizations · Procela" via titleLabel.
      { to: '/organizations', label: 'Structure', titleLabel: 'Organizations' },
      { to: '/people', label: 'People' },
      { to: '/agents', label: 'Agents' },
      { to: '/skills', label: 'Skills' },
    ],
  },
  {
    // Processes sits in its own unlabelled row between the "who"
    // (Organizations) and the "what runs through them" (Data /
    // Systems / Governance / Insights). It's the verb that connects
    // the actors above to the artefacts below. Only one destination,
    // so a labelled accordion section would just produce a pointless
    // "Processes › Processes" expand.
    label: null,
    items: [
      { to: '/processes', label: 'Processes' },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/data-assets', label: 'Data Assets' },
      { to: '/business-glossary', label: 'Glossary' },
      { to: '/data-dictionary', label: 'Data Dictionary' },
      { to: '/data-lineage', label: 'Lineage' },
      { to: '/data-domains', label: 'Domains' },
      { to: '/data-quality', label: 'Data Quality' },
    ],
  },
  {
    label: 'Systems',
    items: [
      { to: '/systems', label: 'Systems' },
      { to: '/connections', label: 'Connections' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/governance-program', label: 'Program' },
      { to: '/governance-groups', label: 'Groups' },
      { to: '/dama-roles', label: 'Roles' },
      { to: '/governance-policies', label: 'Documents', titleLabel: 'Governance Documents' },
      { to: '/decision-rights', label: 'Decision Rights' },
      { to: '/documentation', label: 'Documentation' },
      { to: '/governance-calendar', label: 'Calendar' },
      { to: '/governance-work', label: 'Tasks & Issues' },
    ],
    subGroups: [
      { label: 'Set up', itemTos: ['/governance-program', '/governance-groups', '/dama-roles', '/governance-policies', '/decision-rights'] },
      { label: 'Operate', itemTos: ['/documentation', '/governance-calendar', '/governance-work'] },
    ],
  },
  {
    // Cross-cutting exploration / reporting surfaces. They read across
    // Data, Systems, People, Processes and Governance — not governance
    // artefacts in their own right — so they live at the top level
    // rather than under Governance where they used to sit.
    label: 'Insights',
    items: [
      { to: '/enterprise-view',   label: 'Enterprise View' },
      { to: '/analysis',          label: 'Analysis' },
      { to: '/mappings',          label: 'Data Mapping' },
      { to: '/reports',           label: 'Reports' },
      { to: '/gap-detection',     label: 'Gap Detection' },
      { to: '/audit-log',         label: 'Audit Log' },
    ],
    subGroups: [
      { label: 'Explore', itemTos: ['/enterprise-view', '/analysis', '/mappings'] },
      { label: 'Review',  itemTos: ['/reports', '/gap-detection', '/audit-log'] },
    ],
  },
];

// "Get Started" — the Setup Hub entry. Lives in its own unlabelled section
// at the very top (above Dashboard) while setup is incomplete, and is hidden
// once the active org reaches 100% so it doesn't clutter the rail forever.
export const GET_STARTED_ITEM: NavItem = { to: '/setup', label: 'Get Started' };

export const bottomNavItems: NavItem[] = [
  // Agents moved into the Organizations section alongside People —
  // the bottom cluster now holds only the cross-cutting platform
  // controls (Settings, Help).
  { to: '/settings', label: 'Settings' },
  { to: '/help', label: 'Help' },
];

// The four primary destinations pinned to the mobile bottom bar; the
// fifth slot is the "Menu" button that opens the full grouped drawer.
export const MOBILE_PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/processes', label: 'Processes' },
  { to: '/data-assets', label: 'Assets' },
  { to: '/people', label: 'People' },
];

export const ROUTE_GROUPS: Record<string, string[]> = {
  '/setup': ['/setup'],
  '/processes': ['/processes'],
  '/data-assets': ['/data-assets'],
  '/systems': ['/systems'],
  '/business-glossary': ['/business-glossary'],
  '/data-dictionary': ['/data-dictionary'],
  '/mappings': ['/mappings'],
  '/data-lineage': ['/data-lineage'],
  '/governance-program': ['/governance-program'],
  '/governance-groups': ['/governance-groups'],
  '/data-domains': ['/data-domains'],
  '/data-quality': ['/data-quality'],
  '/dama-roles': ['/dama-roles', '/roles', '/raci'],
  '/decision-rights': ['/decision-rights'],
  '/governance-policies': ['/governance-policies'],
  '/documentation': ['/documentation', '/operations-manual', '/sops'],
  '/governance-calendar': ['/governance-calendar'],
  '/governance-work': ['/governance-work'],
  '/enterprise-view': ['/enterprise-view', '/control-tower'],
  '/reports': ['/reports', '/report', '/scorecard'],
  '/analysis': ['/analysis'],
  '/organizations': ['/organizations'],
  '/people': ['/people'],
  '/connections': ['/connections'],
  '/agents': ['/agents'],
  '/settings': ['/settings'],
};
