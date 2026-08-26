import React from 'react';
import type { NavItem } from './navConfig';

// ──────────────────────────────────────────────────────────────────────────
// navIcons — the inline SVG icon set for the sidebar nav rail.
//
// All nav icons are inline SVGs in one stroke-1.9 / 24×24 line-art
// language so the sidebar reads as a single consistent icon set.
// Earlier versions mixed Segoe UI Symbol glyphs with hand-drawn
// SVGs in the same column, which produced visibly uneven weight and
// needed a font-family fallback chain on .navIcon to stop Windows
// substituting coloured emoji for codepoints like U+2638. Converting
// every item lets us drop that fallback entirely.
//
// Lives outside Layout.tsx because the icon set is a static lookup
// table (~250 lines of SVG paths) that obscures the actual Layout
// shell logic. Keyed by `NavItem.to` so the rail renders the right
// icon just from the route — no per-item glyph wiring needed.
// ──────────────────────────────────────────────────────────────────────────

// NavSvg — the single wrapper every rail icon shares. Defaults
// match the sidebar (18px, stroke 1.9). Empty-state hero and other
// larger surfaces override via `size` + `strokeWidth`; the icon
// path data stays untouched so a page's empty state renders the
// exact shape of its own rail entry, just bigger. See
// `renderNavIcon()` below.
function NavSvg({
  children,
  size = 18,
  strokeWidth = 1.9,
}: {
  children: React.ReactNode;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      {children}
    </svg>
  );
}

export const NAV_ICONS: Record<string, React.ReactNode> = {
  '/': (
    <NavSvg>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </NavSvg>
  ),
  '/setup': (
    <NavSvg>
      <path d="M5 21 V5 a1 1 0 0 1 1-1 h9 l-1.5 3 L15 10 H6" />
      <circle cx="5" cy="21" r="0.6" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/processes': (
    <NavSvg>
      <rect x="2.5" y="9" width="7" height="6" rx="1.2" />
      <path d="M9.5 12 L15 12" />
      <path d="M13 9.8 L15 12 L13 14.2" />
      <rect x="15" y="9" width="6.5" height="6" rx="1.2" />
    </NavSvg>
  ),
  // Process ↔ Data Map: two short stacks of rows on either side
  // with a curved connector between them — a stripped-down version
  // of the bipartite visualization the page renders.
  '/processes/data-map': (
    <NavSvg>
      <rect x="2.5" y="5.5"  width="5" height="2.5" rx="0.5" />
      <rect x="2.5" y="10.5" width="5" height="2.5" rx="0.5" />
      <rect x="2.5" y="15.5" width="5" height="2.5" rx="0.5" />
      <rect x="16.5" y="5.5"  width="5" height="2.5" rx="0.5" />
      <rect x="16.5" y="10.5" width="5" height="2.5" rx="0.5" />
      <rect x="16.5" y="15.5" width="5" height="2.5" rx="0.5" />
      <path d="M7.5 6.7 C11 6.7 13 16.7 16.5 16.7" />
      <path d="M7.5 11.7 C11 11.7 13 6.7 16.5 6.7" />
    </NavSvg>
  ),
  '/organizations': (
    <NavSvg>
      <rect x="9" y="2.8" width="6" height="5" rx="1" />
      <path d="M12 7.8 L12 11.5" />
      <path d="M4.5 11.5 L19.5 11.5" />
      <path d="M4.5 11.5 L4.5 14.5" />
      <path d="M19.5 11.5 L19.5 14.5" />
      <path d="M12 11.5 L12 14.5" />
      <rect x="1.5" y="14.5" width="6" height="5" rx="1" />
      <rect x="9" y="14.5" width="6" height="5" rx="1" />
      <rect x="16.5" y="14.5" width="6" height="5" rx="1" />
    </NavSvg>
  ),
  '/people': (
    <NavSvg>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </NavSvg>
  ),
  '/agents': (
    <NavSvg>
      <path d="M12 2.5 L12 4.8" />
      <circle cx="12" cy="2.2" r="0.9" />
      <rect x="4.5" y="6.5" width="15" height="11" rx="2.2" />
      <circle cx="9" cy="11.5" r="1.1" />
      <circle cx="15" cy="11.5" r="1.1" />
      <path d="M9.5 14.5 L14.5 14.5" />
    </NavSvg>
  ),
  '/skills': (
    <NavSvg>
      <path d="M8.5 3 L7 9.5" />
      <path d="M15.5 3 L17 9.5" />
      <path d="M12 4.2 L10.5 8" />
      <path d="M12 4.2 L13.5 8" />
      <circle cx="12" cy="15" r="5.2" />
    </NavSvg>
  ),
  '/data-assets': (
    <NavSvg>
      <ellipse cx="12" cy="5.2" rx="7" ry="2.4" />
      <path d="M5 5.2 V12 C5 13.33 8.13 14.4 12 14.4 C15.87 14.4 19 13.33 19 12 V5.2" />
      <path d="M5 12 V18.8 C5 20.13 8.13 21.2 12 21.2 C15.87 21.2 19 20.13 19 18.8 V12" />
    </NavSvg>
  ),
  // Orphan Assets: the same data-asset cylinder shape (so its
  // membership in the Data family is unambiguous at a glance), with
  // a small detached "?" floating above it — the orphan signal.
  // Cylinder is shrunk slightly to make room for the question mark
  // in the top-right quadrant so neither glyph crowds the other.
  '/data-assets/orphans': (
    <NavSvg>
      <ellipse cx="10" cy="9" rx="5.5" ry="1.9" />
      <path d="M4.5 9 V14.5 C4.5 15.55 6.96 16.4 10 16.4 C13.04 16.4 15.5 15.55 15.5 14.5 V9" />
      <path d="M4.5 14.5 V20 C4.5 21.05 6.96 21.9 10 21.9 C13.04 21.9 15.5 21.05 15.5 20 V14.5" />
      <path d="M18 4.2 C18 3 19 2.2 20 2.2 C21 2.2 22 3 22 4.1 C22 5.4 20 5.7 20 7.2" />
      <circle cx="20" cy="9.4" r="0.7" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/business-glossary': (
    <NavSvg>
      <path d="M4 4 H14 A3 3 0 0 1 17 7 V20 H7 A3 3 0 0 1 4 17 Z" />
      <path d="M4 17 A3 3 0 0 1 7 14 H17" />
      <path d="M8 8 H13" />
    </NavSvg>
  ),
  '/data-lineage': (
    <NavSvg>
      <circle cx="4.5" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="19.5" cy="12" r="2.2" />
      <path d="M6.7 12 L9.8 12" />
      <path d="M14.2 12 L17.3 12" />
    </NavSvg>
  ),
  '/data-domains': (
    <NavSvg>
      <path d="M3 6 H10 L11.5 8 H21 V19 H3 Z" />
      <path d="M3 10 H21" />
    </NavSvg>
  ),
  '/data-quality': (
    <NavSvg>
      <path d="M12 3 L5 6 V12 C5 16 8 19 12 21 C16 19 19 16 19 12 V6 Z" />
      <path d="M8.5 12 L11 14.5 L15.5 9.5" />
    </NavSvg>
  ),
  '/systems': (
    <NavSvg>
      <rect x="3.5" y="4" width="17" height="6" rx="1" />
      <rect x="3.5" y="14" width="17" height="6" rx="1" />
      <circle cx="7" cy="7" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/connections': (
    <NavSvg>
      <circle cx="6.5" cy="12" r="3" />
      <circle cx="17.5" cy="12" r="3" />
      <path d="M9.5 12 L14.5 12" />
    </NavSvg>
  ),
  '/governance-program': (
    <NavSvg>
      <rect x="3" y="4" width="18" height="4" rx="0.6" />
      <rect x="5" y="10" width="14" height="4" rx="0.6" />
      <rect x="7" y="16" width="10" height="4" rx="0.6" />
    </NavSvg>
  ),
  '/governance-groups': (
    <NavSvg>
      <circle cx="7" cy="8.5" r="2.5" />
      <circle cx="17" cy="8.5" r="2.5" />
      <circle cx="12" cy="15.5" r="2.5" />
    </NavSvg>
  ),
  '/dama-roles': (
    <NavSvg>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12 H20" />
      <path d="M18 12 V14.5" />
      <path d="M15 12 V14" />
    </NavSvg>
  ),
  '/governance-policies': (
    <NavSvg>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 8 H16" />
      <path d="M8 12 H16" />
      <circle cx="15" cy="17" r="2" />
    </NavSvg>
  ),
  '/decision-rights': (
    <NavSvg>
      <path d="M12 4 V20" />
      <path d="M8 20 H16" />
      <path d="M5 7 H19" />
      <path d="M12 5 L12 7" />
      <path d="M5 7 L3 11.5 H7 Z" />
      <path d="M19 7 L17 11.5 H21 Z" />
    </NavSvg>
  ),
  '/documentation': (
    <NavSvg>
      <path d="M6 3 H15 L19 7 V21 H6 Z" />
      <path d="M15 3 V7 H19" />
      <path d="M9 12 H16" />
      <path d="M9 16 H13" />
    </NavSvg>
  ),
  '/governance-calendar': (
    <NavSvg>
      <rect x="4" y="5" width="16" height="15" rx="1.5" />
      <path d="M4 9 H20" />
      <path d="M9 3 V7" />
      <path d="M15 3 V7" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/governance-work': (
    <NavSvg>
      <rect x="5" y="5" width="14" height="16" rx="1.5" />
      <rect x="9" y="3" width="6" height="3" rx="0.6" />
      <path d="M8 12 L10 14 L14 10" />
      <path d="M8 17 H15" />
    </NavSvg>
  ),
  '/enterprise-view': (
    <NavSvg>
      <path d="M3 21 H21" />
      <rect x="4" y="9" width="6" height="12" />
      <rect x="14" y="5" width="6" height="16" />
    </NavSvg>
  ),
  '/analysis': (
    <NavSvg>
      <path d="M3 21 H21" />
      <rect x="5" y="14" width="3" height="6" />
      <rect x="11" y="9" width="3" height="11" />
      <rect x="17" y="5" width="3" height="15" />
    </NavSvg>
  ),
  '/mappings': (
    <NavSvg>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12 L12 4 A8 8 0 0 1 20 12 Z" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/reports': (
    <NavSvg>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 17 L11 13 L14 15 L17 9" />
    </NavSvg>
  ),
  '/gap-detection': (
    <NavSvg>
      <path d="M12 3 L21 20 H3 Z" />
      <path d="M12 10 V14" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  '/audit-log': (
    <NavSvg>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7 V12 L15 14" />
    </NavSvg>
  ),
  // Council Scorecard: a report card — rows of measures each with a
  // status mark on the right, the per-division rating the council reads.
  '/council-scorecard': (
    <NavSvg>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M7 9 H12" />
      <path d="M7 13 H12" />
      <path d="M7 17 H12" />
      <circle cx="16" cy="9"  r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
  // Governance Exceptions: a shield (a control) with a bar through it —
  // a control deliberately waived for a time.
  '/governance-exceptions': (
    <NavSvg>
      <path d="M12 3 L19 6 V11 C19 15.8 15.9 19.3 12 21 C8.1 19.3 5 15.8 5 11 V6 Z" />
      <path d="M9 12 H15" />
    </NavSvg>
  ),
  '/settings': (
    <NavSvg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3 L12 6" />
      <path d="M12 18 L12 21" />
      <path d="M3 12 L6 12" />
      <path d="M18 12 L21 12" />
      <path d="M5.6 5.6 L7.7 7.7" />
      <path d="M16.3 16.3 L18.4 18.4" />
      <path d="M5.6 18.4 L7.7 16.3" />
      <path d="M16.3 7.7 L18.4 5.6" />
    </NavSvg>
  ),
  '/help': (
    <NavSvg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5 C9.5 7.8 10.6 7 12 7 C13.4 7 14.5 7.8 14.5 9 C14.5 10.5 12 11 12 13" />
      <circle cx="12" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
    </NavSvg>
  ),
};

export function navIconNode(item: NavItem | undefined): React.ReactNode {
  if (!item) return null;
  return NAV_ICONS[item.to] ?? null;
}

/**
 * renderNavIcon — render the same icon the sidebar uses for a
 * given route, at a chosen size. Used by empty-state hero blocks,
 * card headers, and anywhere else that wants "this page's icon"
 * but bigger than 18 px.
 *
 * Since every NAV_ICONS entry is a `<NavSvg>…</NavSvg>` element,
 * we can just clone-and-override the props. The path data stays
 * identical to the rail entry — no risk of the empty-state icon
 * drifting from the sidebar icon.
 *
 * Returns null when the route has no icon registered; callers
 * can fall back to their own default.
 */
export function renderNavIcon(
  route: string,
  opts: { size?: number; strokeWidth?: number } = {},
): React.ReactNode {
  const base = NAV_ICONS[route];
  if (!React.isValidElement(base)) return null;
  const { size = 36, strokeWidth = 1.7 } = opts;
  return React.cloneElement(base as React.ReactElement<{ size?: number; strokeWidth?: number }>, {
    size,
    strokeWidth,
  });
}

// Section accordion chevron. Inline SVG (not a text glyph) so it
// shares the same stroke language as the rail icons and stops
// depending on the symbol-font fallback chain.
export function NavChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{
        opacity: 0.55,
        transition: 'transform 0.15s',
        transform: open ? 'rotate(90deg)' : 'none',
        flexShrink: 0,
      }}
    >
      <path d="M9 5 L15 12 L9 19" />
    </svg>
  );
}

// Mobile bottom-bar "Menu" trigger. Inline hamburger so it matches
// the rest of the SVG icon set.
export const NAV_MENU_ICON = (
  <NavSvg>
    <path d="M4 7 H20" />
    <path d="M4 12 H20" />
    <path d="M4 17 H20" />
  </NavSvg>
);
