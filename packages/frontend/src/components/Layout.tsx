import { useEffect, useCallback, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';
import Breadcrumbs from './Breadcrumbs';
import ChatPanel from './ChatPanel';
import SessionTimeout from './SessionTimeout';
import ToastContainer from './ToastContainer';
import RoleDetailDrawer from './RoleDetailDrawer';
import ShortcutsModal from './ShortcutsModal';
import ShortcutsHint from './ShortcutsHint';
import OnboardingWizard from './OnboardingWizard';
import CommandPalette from './CommandPalette';

import DensityToggle from './DensityToggle';
import TerminologyToggle from './TerminologyToggle';
import { useAuthStore } from '@/stores/authStore';
import { useOrgContext } from '@/stores/orgContext';
import { useBrandingStore } from '@/stores/brandingStore';
import { apiClient } from '@/api/client';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { usePermissions } from '@/hooks/usePermissions';
import { useIsMobile } from '@/hooks/useMediaQuery';

// `label` is what shows in the sidebar; `titleLabel`, when set,
// overrides the browser tab title so a short sidebar label (e.g.
// "Structure" inside the Organizations section) can still produce a
// meaningful tab title ("Organizations").
type NavItem = { to: string; label: string; icon: string; titleLabel?: string };
// `items` is always the flat source of truth (active-state, flyout,
// collapsed icon). `subGroups`, when present, only adds labelled
// dividers in the expanded accordion so a heavy section (Governance)
// reads as Setup / Operate / Analyze instead of an 11-item wall.
type NavSection = {
  label: string | null;
  items: NavItem[];
  subGroups?: { label: string; itemTos: string[] }[];
  adminOnly?: boolean;
};

// All nav icons are inline SVGs in one stroke-1.9 / 24×24 line-art
// language so the sidebar reads as a single consistent icon set.
// Earlier versions mixed Segoe UI Symbol glyphs with hand-drawn
// SVGs in the same column, which produced visibly uneven weight and
// needed a font-family fallback chain on .navIcon to stop Windows
// substituting coloured emoji for codepoints like U+2638. Converting
// every item lets us drop that fallback entirely.
function NavSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      {children}
    </svg>
  );
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  '/': (
    <NavSvg>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
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
  '/business-glossary': (
    <NavSvg>
      <path d="M4 4 H14 A3 3 0 0 1 17 7 V20 H7 A3 3 0 0 1 4 17 Z" />
      <path d="M4 17 A3 3 0 0 1 7 14 H17" />
      <path d="M8 8 H13" />
    </NavSvg>
  ),
  '/data-dictionary': (
    <NavSvg>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M9 3.5 V20.5" />
      <path d="M12 8 H16" />
      <path d="M12 12 H16" />
      <path d="M12 16 H15" />
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

function navIconNode(item: NavItem | undefined): React.ReactNode {
  if (!item) return null;
  return NAV_ICONS[item.to] ?? null;
}

// Section accordion chevron. Inline SVG (not a text glyph) so it
// shares the same stroke language as the rail icons and stops
// depending on the symbol-font fallback chain.
function NavChevron({ open }: { open: boolean }) {
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
const NAV_MENU_ICON = (
  <NavSvg>
    <path d="M4 7 H20" />
    <path d="M4 12 H20" />
    <path d="M4 17 H20" />
  </NavSvg>
);

// Opens the Help guide in a separate window. Shared by the top-bar
// Help button and the sidebar Help item so both behave identically.
// The named target means repeated clicks focus the same window
// instead of spawning duplicates.
function openHelpWindow() {
  window.open('/help', 'procela-help', 'popup,width=1100,height=900,noopener,noreferrer');
}

// Plain-noun buckets so users can find things by what they ARE, not
// by which DAMA phase they belong to. The Organizations section is
// the "who" of the platform \u2014 the company structure plus the humans
// and AI agents that act within it, along with the skills those
// actors carry. Data / Systems / Governance / Insights follow as the
// other domains.
const navSections: NavSection[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: '\u25A3' },
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
      // doesn't echo the section title \u2014 the destination is still the
      // org tree at /organizations, and the browser tab still reads
      // "Organizations \u00b7 Procela" via titleLabel.
      { to: '/organizations', label: 'Structure', icon: '\u2616', titleLabel: 'Organizations' },
      { to: '/people', label: 'People', icon: '\u263B' },
      { to: '/agents', label: 'Agents', icon: '\u2699' },
      { to: '/skills', label: 'Skills', icon: '\u2727' },
    ],
  },
  {
    // Processes sits in its own unlabelled row between the "who"
    // (Organizations) and the "what runs through them" (Data /
    // Systems / Governance / Insights). It's the verb that connects
    // the actors above to the artefacts below. Only one destination,
    // so a labelled accordion section would just produce a pointless
    // "Processes \u203A Processes" expand.
    label: null,
    items: [
      { to: '/processes', label: 'Processes', icon: '\u26C1' },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/data-assets', label: 'Data Assets', icon: '\u2B22' },
      { to: '/business-glossary', label: 'Glossary', icon: '\u2261' },
      { to: '/data-dictionary', label: 'Data Dictionary', icon: '\u2263' },
      { to: '/data-lineage', label: 'Lineage', icon: '\u2192' },
      { to: '/data-domains', label: 'Domains', icon: '\u229E' },
      { to: '/data-quality', label: 'Data Quality', icon: '\u2714' },
    ],
  },
  {
    label: 'Systems',
    items: [
      { to: '/systems', label: 'Systems', icon: '\u2338' },
      { to: '/connections', label: 'Connections', icon: '\u26A1' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/governance-program', label: 'Program', icon: '\u2637' },
      { to: '/governance-groups', label: 'Groups', icon: '\u2616' },
      { to: '/dama-roles', label: 'Roles', icon: '\u263C' },
      { to: '/governance-policies', label: 'Policies', icon: '\u00A7' },
      { to: '/decision-rights', label: 'Decision Rights', icon: '\u2696' },
      { to: '/documentation', label: 'Documentation', icon: '\u2611' },
      { to: '/governance-calendar', label: 'Calendar', icon: '\u2637' },
      { to: '/governance-work', label: 'Tasks & Issues', icon: '\u2605' },
    ],
    subGroups: [
      { label: 'Set up', itemTos: ['/governance-program', '/governance-groups', '/dama-roles', '/governance-policies', '/decision-rights'] },
      { label: 'Operate', itemTos: ['/documentation', '/governance-calendar', '/governance-work'] },
    ],
  },
  {
    // Cross-cutting exploration / reporting surfaces. They read across
    // Data, Systems, People, Processes and Governance \u2014 not governance
    // artefacts in their own right \u2014 so they live at the top level
    // rather than under Governance where they used to sit.
    label: 'Insights',
    items: [
      { to: '/enterprise-view',   label: 'Enterprise View',   icon: '\u29c9' },
      { to: '/analysis',          label: 'Analysis',          icon: '\u229e' },
      { to: '/mappings',          label: 'Process Coverage',  icon: '\u21c4' },
      { to: '/reports',           label: 'Reports',           icon: '\u2630' },
      { to: '/gap-detection',     label: 'Gap Detection',     icon: '\u26a0' },
      { to: '/audit-log',         label: 'Audit Log',         icon: '\u29d6' },
    ],
    subGroups: [
      { label: 'Explore', itemTos: ['/enterprise-view', '/analysis', '/mappings'] },
      { label: 'Review',  itemTos: ['/reports', '/gap-detection', '/audit-log'] },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  // Agents moved into the Organizations section alongside People \u2014
  // the bottom cluster now holds only the cross-cutting platform
  // controls (Settings, Help).
  { to: '/settings', label: 'Settings', icon: '\u2638' },
  { to: '/help', label: 'Help', icon: '\u003F' },
];

// The four primary destinations pinned to the mobile bottom bar; the
// fifth slot is the "Menu" button that opens the full grouped drawer.
const MOBILE_PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '\u25A3' },
  { to: '/processes', label: 'Processes', icon: '\u26C1' },
  { to: '/data-assets', label: 'Assets', icon: '\u2B22' },
  { to: '/people', label: 'People', icon: '\u263B' },
];

const ROUTE_GROUPS: Record<string, string[]> = {
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

interface Notification {
  id: string;
  orgId: string;
  userId: string | null;
  type: 'INFO' | 'WARNING' | 'ACTION';
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
}

// Full-screen mobile navigation drawer. Opened from the "Menu" button
// in the bottom bar; shows the complete navigation with section
// headings preserved, so a phone user can find any page without
// sideways-scrolling a 30-icon strip.
function MobileNavDrawer({ sections, bottomItems, pathname, onClose }: {
  sections: NavSection[];
  bottomItems: NavItem[];
  pathname: string;
  onClose: () => void;
}) {
  const isActive = (to: string) => {
    const group = ROUTE_GROUPS[to];
    return group
      ? group.some((r) => pathname === r || pathname.startsWith(r + '/'))
      : (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));
  };
  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 20px', fontSize: 15, textDecoration: 'none',
    color: active ? 'var(--color-primary)' : 'var(--color-text)',
    fontWeight: active ? 600 : 400,
    background: active ? 'var(--color-bg)' : 'transparent',
  });
  const linkRow = (item: NavItem) => {
    // Help opens the guide in a separate window, matching the top-bar
    // Help button — not in-app navigation.
    if (item.to === '/help') {
      return (
        <button
          key={item.to}
          type="button"
          onClick={() => { onClose(); openHelpWindow(); }}
          style={{ ...rowStyle(false), width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ width: 22, textAlign: 'center', fontSize: 16 }}>{navIconNode(item)}</span>
          {item.label}
        </button>
      );
    }
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        onClick={onClose}
        style={rowStyle(isActive(item.to))}
      >
        <span style={{ width: 22, textAlign: 'center', fontSize: 16 }}>{navIconNode(item)}</span>
        {item.label}
      </NavLink>
    );
  };
  return (
    <div
      role="dialog"
      aria-label="Navigation menu"
      style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', flexDirection: 'column', background: 'var(--color-surface)' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Menu</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation menu"
          style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--color-text-muted)', lineHeight: 1, padding: 4 }}
        >×</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 24 }}>
        {sections.map((section, i) => (
          <div key={section.label || `s${i}`} style={{ paddingTop: section.label ? 8 : 0 }}>
            {section.label && (
              <div style={{
                padding: '12px 20px 4px', fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)',
              }}>{section.label}</div>
            )}
            {section.items.map(linkRow)}
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 8, paddingTop: 8 }}>
          {bottomItems.map(linkRow)}
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { activeOrgId, setActiveOrg, setOrgs, clearActiveOrg, refreshKey, triggerRefresh } = useOrgContext();
  const { branding, fetch: fetchBranding } = useBrandingStore();
  const { isAdmin, role } = usePermissions();

  const visibleSections = navSections.filter((s) => !s.adminOnly || isAdmin);

  // Apply the customer's theme (company name, logo, colors) as early as
  // possible. The store also fetches from /login via brandingStore bootstrap;
  // re-fetching on mount here keeps the shell in sync when an admin updates
  // branding without requiring a full reload.
  useEffect(() => { fetchBranding(); }, [fetchBranding]);
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string; type: string; parentId: string | null; label: string }>>([]);

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Accordion nav: which section is expanded (one at a time)
  const activeSectionLabel = (() => {
    for (const section of navSections) {
      if (!section.label) continue;
      const match = section.items.some((item) => {
        const groupRoutes = ROUTE_GROUPS[item.to];
        return groupRoutes
          ? groupRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
          : location.pathname === item.to;
      });
      if (match) return section.label;
    }
    return null;
  })();
  // Set of expanded accordion sections. Multi-open: navigating to a
  // section *adds* it to the open set rather than replacing the
  // previous one, so bouncing People → Data → People no longer
  // collapses the section you came from. The user can still close any
  // section by clicking its header.
  const [expandedNavSections, setExpandedNavSections] = useState<Set<string>>(
    () => new Set(activeSectionLabel ? [activeSectionLabel] : []),
  );
  const prevPathnameRef = useRef(location.pathname);

  // Auto-expand the active section when navigating; never auto-close.
  useEffect(() => {
    if (location.pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = location.pathname;
    if (activeSectionLabel && !expandedNavSections.has(activeSectionLabel)) {
      setExpandedNavSections((prev) => new Set(prev).add(activeSectionLabel));
    }
  }, [location.pathname, activeSectionLabel, expandedNavSections]);

  // Close the mobile nav drawer on navigation.
  useEffect(() => { setMobileDrawerOpen(false); }, [location.pathname]);

  const toggleNavSection = (label: string) => {
    setExpandedNavSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  // Flyout for collapsed sidebar
  const [flyoutSection, setFlyoutSection] = useState<string | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const flyoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification state
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifWrapperRef = useRef<HTMLDivElement>(null);

  // Search state
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Re-run guided tour. Triggered from Help / Settings via a window
  // event so the buttons don't have to plumb a setter through React
  // context. Distinct from the first-run wizard mount below — this one
  // is "tour-only" and never tries to create another org.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    const handler = () => setTourOpen(true);
    window.addEventListener('procela:start-tour', handler);
    return () => window.removeEventListener('procela:start-tour', handler);
  }, []);

  // Mirror the ChatPanel's open state so the top-bar "Ask AI" button
  // can reflect it (aria-expanded + active styling). The ChatPanel
  // dispatches procela:chat-state whenever its internal open changes.
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ open: boolean }>).detail;
      if (detail && typeof detail.open === 'boolean') setChatOpen(detail.open);
    };
    window.addEventListener('procela:chat-state', handler);
    return () => window.removeEventListener('procela:chat-state', handler);
  }, []);

  // Shortcuts modal state
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Window-event opener for the keyboard shortcuts modal, so any page
  // (Help, in particular) can pop it without holding a setter handle.
  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener('procela:open-shortcuts', handler);
    return () => window.removeEventListener('procela:open-shortcuts', handler);
  }, []);

  // Per-page browser tab title. Without this, every Procela tab in the
  // browser bar reads "Procela" and a user with several tabs open
  // cannot tell them apart. Derived from the matching nav item label so
  // each page automatically picks up the right title with no per-page
  // wiring needed.
  useEffect(() => {
    const path = location.pathname;
    const allItems: NavItem[] = [
      ...navSections.flatMap((s) => s.items),
      ...bottomNavItems,
    ];
    // Prefer the most specific match (longest route prefix).
    const match = allItems
      .filter((i) => path === i.to || path.startsWith(i.to + '/'))
      .sort((a, b) => b.to.length - a.to.length)[0];
    // Append a sub-route label so deep pages aren't all "Processes ·
    // Procela". Keyed by the trailing path segment after the matched
    // nav route.
    let suffix = '';
    if (match && path.length > match.to.length) {
      const tail = path.slice(match.to.length).replace(/^\/+/, '').split('/')[0];
      const SUBROUTE_LABELS: Record<string, string> = {
        wizard: 'Wizard',
        visualization: 'Map',
        compare: 'Compare',
        new: 'New',
        edit: 'Edit',
      };
      // Use a colon, not " — ": brandingStore appends the customer's
      // company name with " — " and derives the base via split(' — '),
      // so an em-dash here would be swallowed when branding re-applies.
      if (tail) suffix = `: ${SUBROUTE_LABELS[tail] || tail.charAt(0).toUpperCase() + tail.slice(1)}`;
    }
    document.title = match ? `${match.titleLabel || match.label}${suffix} · Procela` : 'Procela';
  }, [location.pathname]);

  // Global keyboard shortcuts. Cmd/Ctrl+K and `/` both open the command
  // palette. `?` opens the shortcuts modal. `g` followed by a letter goes
  // somewhere (handled separately so the second key isn't a chord).
  useKeyboardShortcut('k', () => setPaletteOpen(true), { mod: true });
  useKeyboardShortcut('/', () => setPaletteOpen(true));
  useKeyboardShortcut('?', () => setShortcutsOpen(true), { shift: true });

  // Two-key "go to" sequences. Track the timestamp of the last `g` press;
  // if a navigation key arrives within 1.5s, treat it as a chord.
  const lastGRef = useRef<number>(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const now = Date.now();
      const chordActive = now - lastGRef.current < 1500;
      if (e.key === 'g' && !e.shiftKey && !chordActive) {
        // First `g` — arm the chord. A second `g` within the window
        // is NOT re-armed here so that "g g" can resolve to the
        // Governance Program shortcut below.
        lastGRef.current = now;
        return;
      }
      if (chordActive) {
        const map: Record<string, string> = {
          d: '/', o: '/organizations', p: '/people', c: '/processes', a: '/data-assets',
          s: '/systems', q: '/data-quality', l: '/data-lineage', m: '/mappings',
          g: '/governance-program', r: '/reports', e: '/enterprise-view', h: '/help',
        };
        const route = map[e.key];
        if (route) {
          e.preventDefault();
          lastGRef.current = 0;
          navigate(route);
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);


  // Notification: fetch unread count on mount and route change
  const fetchNotifCount = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: { unread: number } }>('/notifications/count');
      setNotifCount(res.data.unread);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchNotifCount();
  }, [isAuthenticated, fetchNotifCount, location.pathname]);

  // Notification: fetch list when panel is opened
  const fetchNotifList = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: Notification[] }>('/notifications');
      setNotifList(res.data);
    } catch { /* */ }
    finally { setNotifLoading(false); }
  }, []);

  const handleNotifToggle = () => {
    if (!notifOpen) fetchNotifList();
    setNotifOpen((v) => !v);
  };

  const handleNotifClick = async (notif: Notification) => {
    if (!notif.read) {
      await apiClient.put(`/notifications/${notif.id}/read`);
      setNotifCount((c) => Math.max(0, c - 1));
      setNotifList((list) => list.map((n) => n.id === notif.id ? { ...n, read: true } : n));
    }
    setNotifOpen(false);
    navigate(notif.link);
  };

  const handleMarkAllRead = async () => {
    disarmClearAll();
    await apiClient.put('/notifications/read-all');
    setNotifCount(0);
    setNotifList((list) => list.map((n) => ({ ...n, read: true })));
  };

  // "Clear all" deletes every notification with no undo, so it's a
  // two-click action: the first click arms the button, the second
  // actually clears. The armed state shows a live countdown so a
  // paused user isn't surprised by a silent no-op when the window
  // lapses. Avoids a full modal for a minor action.
  const [clearAllCountdown, setClearAllCountdown] = useState(0);
  const clearAllTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearAllArmed = clearAllCountdown > 0;
  const disarmClearAll = () => {
    if (clearAllTimerRef.current) clearInterval(clearAllTimerRef.current);
    clearAllTimerRef.current = null;
    setClearAllCountdown(0);
  };
  const handleClearAllNotifications = async () => {
    if (!clearAllArmed) {
      setClearAllCountdown(3);
      if (clearAllTimerRef.current) clearInterval(clearAllTimerRef.current);
      clearAllTimerRef.current = setInterval(() => {
        setClearAllCountdown((n) => {
          if (n <= 1) { disarmClearAll(); return 0; }
          return n - 1;
        });
      }, 1000);
      return;
    }
    disarmClearAll();
    await apiClient.delete('/notifications/all');
    setNotifCount(0);
    setNotifList([]);
  };

  // Abort an armed "Clear all" whenever the notification panel closes
  // (toggle, outside-click, Escape, or following a notification) — so
  // an accidental first click is cancelled by any normal interaction,
  // not only by waiting out the countdown.
  useEffect(() => { if (!notifOpen) disarmClearAll(); }, [notifOpen]);

  const handleDismissNotification = async (id: string) => {
    setNotifList((list) => list.filter((n) => n.id !== id));
    setNotifCount((c) => Math.max(0, c - 1));
    try { await apiClient.delete(`/notifications/${id}`); }
    catch { /* optimistic — already removed from UI */ }
  };

  // Close notification dropdown on click outside or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifWrapperRef.current && !notifWrapperRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const fetchOrgs = useCallback(async () => {
    try {
      // Fetch accessible orgs for the current user (filtered by role/assignment).
      // parentId is included so the header dropdown can group divisions under
      // their parent company without a second round-trip.
      const accessRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; type: string; parentId?: string | null }> }>('/auth/accessible-orgs');
      const accessible = accessRes.data || [];

      const options = accessible.map((o) => {
        const typeLabel = o.type.charAt(0).toUpperCase() + o.type.slice(1);
        return { id: o.id, name: o.name, type: o.type, parentId: o.parentId ?? null, label: `${o.name} (${typeLabel})` };
      });
      // Sort so company comes first, then divisions — ensures the broadest scope is the default
      const typeOrder: Record<string, number> = { company: 0, division: 1, department: 2, team: 3, unit: 4 };
      options.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

      setOrgOptions(options);
      setOrgs(options.map((o) => ({ id: o.id, name: o.name, type: o.type })));

      // If the active org is no longer accessible, fall back to any reachable
      // org (preferring a company so the user lands on the broadest scope).
      // The old behaviour fell back only to companies, which broke users who
      // genuinely only have a division-level grant.
      const reachable = options;
      if (activeOrgId && !reachable.find((o) => o.id === activeOrgId)) {
        const fallback = reachable.find((o) => o.type === 'company') || reachable[0];
        if (fallback) {
          setActiveOrg(fallback.id, fallback.name, fallback.type);
        } else {
          clearActiveOrg();
        }
      }

      // Auto-select the broadest reachable org if none is selected yet.
      if (!activeOrgId && reachable.length > 0) {
        const first = reachable.find((o) => o.type === 'company') || reachable[0];
        setActiveOrg(first.id, first.name, first.type);
      }
    } catch { /* */ }
  }, [activeOrgId, setOrgs, clearActiveOrg, setActiveOrg, refreshKey]);

  useEffect(() => {
    if (isAuthenticated) fetchOrgs();
  }, [isAuthenticated, fetchOrgs]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const handleOrgChange = (id: string) => {
    if (!id) return; // Don't allow clearing — must always have an org selected
    const org = orgOptions.find((o) => o.id === id);
    if (org) {
      setActiveOrg(id, org.name, org.type);
      // Toast feedback
      try {
        const { addToast } = require('@/stores/toastStore').useToastStore.getState();
        addToast('info', `Now working in ${org.name}`);
      } catch { /* */ }
    }
  };

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  // Focused reading mode for the Help guide: when the route is
  // /help we strip the sidebar, header, chat panel and every other
  // bit of app chrome so the user gets a clean, single-purpose
  // reading view. Only a thin top bar remains, with the Procela
  // logo and a Close button. Close prefers history.back() so the
  // user returns to wherever they came from, but falls back to "/"
  // when help was opened cold from a deep link.
  if (location.pathname === '/help') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
        <header style={{
          height: 56, background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={branding.logoUrl || '/procela-icon.png'}
              alt={branding.companyName || 'Procela'}
              style={{ height: 32, width: 'auto' }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Help Guide</span>
          </div>
          <button
            type="button"
            onClick={() => {
              // The Help guide is opened by openHelpWindow() in its
              // own browser window via window.open, so closing it
              // should close that window — not just navigate inside
              // it. window.close() works for script-opened windows
              // in every modern browser even with noopener, but if
              // it's somehow blocked (deep link in the same tab, an
              // odd embedded context) fall back to in-app navigation
              // so the user isn't stranded on a content-only page
              // with no chrome.
              window.close();
              setTimeout(() => {
                if (!window.closed) {
                  if (window.history.length > 1) navigate(-1);
                  else navigate('/');
                }
              }, 100);
            }}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            title="Close the help guide window"
          >
            × Close
          </button>
        </header>
        <main id="main-content" style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Skip-to-content - first focusable element so Tab from the
        * URL bar lands here. Lets keyboard users jump past the sidebar
        * and header straight to the page body. */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>
      {/* Sidebar */}
      <aside className={clsx(styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed)}>
        <div className={styles.sidebarBrand}>
          <img
            src={branding.logoUrl || '/procela-icon.png'}
            alt={branding.companyName || 'Procela'}
            className={styles.brandIcon}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/procela-icon.png'; }}
          />
          {!sidebarCollapsed && <span>{branding.companyName || 'Procela'}</span>}
        </div>
        <nav className={styles.sidebarNav}>
          {isMobile ? (
            /* On phones the sidebar is a fixed bottom bar with four
               primary destinations plus a "Menu" button that opens a
               full-screen drawer with the complete, section-grouped
               navigation. The earlier flat 30-item horizontal scroll
               strip made finding anything past the first few icons a
               sideways-scrolling hunt. */
            <>
              {MOBILE_PRIMARY.map((item) => {
                const isActive = location.pathname === item.to
                  || (item.to !== '/' && location.pathname.startsWith(item.to + '/'));
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={() => clsx(styles.navLink, isActive && styles.navLinkActive)}
                    title={item.label}
                  >
                    <span className={styles.navIcon}>{navIconNode(item)}</span>
                    <span style={{ fontSize: 10 }}>{item.label}</span>
                  </NavLink>
                );
              })}
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className={styles.navLink}
                aria-label="Open navigation menu"
                aria-expanded={mobileDrawerOpen}
              >
                <span className={styles.navIcon}>{NAV_MENU_ICON}</span>
                <span style={{ fontSize: 10 }}>Menu</span>
              </button>
            </>
          ) : visibleSections.map((section, sIdx) => {
            const isExpanded = section.label ? expandedNavSections.has(section.label) : true;
            const isFlyoutOpen = sidebarCollapsed && flyoutSection === section.label;
            const sectionHasActive = section.items.some((item) => {
              const groupRoutes = ROUTE_GROUPS[item.to];
              return groupRoutes
                ? groupRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
                : location.pathname === item.to;
            });

            return (
            <div
              key={sIdx}
              className={styles.navGroup}
              style={{ position: 'relative' }}
              onMouseEnter={(e) => {
                if (sidebarCollapsed && section.label) {
                  if (flyoutTimeoutRef.current) clearTimeout(flyoutTimeoutRef.current);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setFlyoutTop(rect.top);
                  setFlyoutSection(section.label);
                }
              }}
              onMouseLeave={() => {
                if (sidebarCollapsed && section.label) {
                  flyoutTimeoutRef.current = setTimeout(() => setFlyoutSection(null), 150);
                }
              }}
            >
              {section.label ? (
                <>
                  {/* Section header — clickable accordion toggle. Rendered
                    * as a real button so it's in the tab order and
                    * Enter/Space activate it. aria-expanded announces
                    * the open/closed state to screen readers. */}
                  <button
                    type="button"
                    className={clsx(styles.navLink, sectionHasActive && !isExpanded && styles.navLinkActive)}
                    onClick={() => {
                      if (sidebarCollapsed) {
                        setFlyoutSection(isFlyoutOpen ? null : section.label);
                      } else {
                        toggleNavSection(section.label!);
                      }
                    }}
                    aria-expanded={!sidebarCollapsed ? isExpanded : isFlyoutOpen}
                    aria-label={sidebarCollapsed ? section.label || undefined : undefined}
                    style={{ cursor: 'pointer', userSelect: 'none', width: '100%', textAlign: 'left', background: 'transparent', fontFamily: 'inherit', color: 'inherit', border: 'none' }}
                    title={sidebarCollapsed ? section.label : undefined}
                  >
                    <span className={styles.navIcon}>{navIconNode(section.items[0])}</span>
                    {!sidebarCollapsed && (
                      <>
                        <span style={{ flex: 1 }}>{section.label}</span>
                        <NavChevron open={isExpanded} />
                      </>
                    )}
                  </button>

                  {/* Expanded children (accordion — only when sidebar is open) */}
                  {!sidebarCollapsed && isExpanded && (() => {
                    const renderItem = (item: NavItem) => {
                      const groupRoutes = ROUTE_GROUPS[item.to];
                      const isGroupActive = groupRoutes
                        ? groupRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
                        : location.pathname === item.to;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={() => clsx(styles.navLink, styles.navLinkChild, isGroupActive && styles.navLinkActive)}
                        >
                          <span className={styles.navIcon}>{navIconNode(item)}</span>
                          {item.label}
                        </NavLink>
                      );
                    };
                    if (!section.subGroups) return section.items.map(renderItem);
                    // Labelled sub-clusters: a small uppercase divider
                    // above each group's items. Falls back to flat for
                    // any item not placed in a cluster.
                    const byTo = new Map(section.items.map((i) => [i.to, i]));
                    return section.subGroups.map((sg) => (
                      <div key={sg.label}>
                        <div className={styles.navSubGroupLabel}>{sg.label}</div>
                        {sg.itemTos.map((to) => byTo.get(to)).filter(Boolean).map((i) => renderItem(i as NavItem))}
                      </div>
                    ));
                  })()}

                  {/* Flyout panel (collapsed sidebar hover) */}
                  {sidebarCollapsed && isFlyoutOpen && (
                    <div
                      className={styles.navFlyout}
                      style={{ left: 60, top: flyoutTop }}
                      onMouseEnter={() => { if (flyoutTimeoutRef.current) clearTimeout(flyoutTimeoutRef.current); }}
                      onMouseLeave={() => { flyoutTimeoutRef.current = setTimeout(() => setFlyoutSection(null), 150); }}
                    >
                      <div className={styles.navFlyoutLabel}>{section.label}</div>
                      {(() => {
                        const renderFlyoutItem = (item: NavItem) => {
                          const groupRoutes = ROUTE_GROUPS[item.to];
                          const isGroupActive = groupRoutes
                            ? groupRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
                            : location.pathname === item.to;
                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              end={item.to === '/'}
                              className={() => clsx(styles.navFlyoutLink, isGroupActive && styles.navFlyoutLinkActive)}
                              onClick={() => setFlyoutSection(null)}
                            >
                              <span className={styles.navIcon}>{navIconNode(item)}</span>
                              {item.label}
                            </NavLink>
                          );
                        };
                        // Mirror the expanded panel: when the section has
                        // sub-clusters (Governance: Set up / Operate),
                        // show the same dividers in the flyout instead of
                        // a flat list that loses the structure.
                        if (!section.subGroups) return section.items.map(renderFlyoutItem);
                        const byTo = new Map(section.items.map((i) => [i.to, i]));
                        return section.subGroups.map((sg) => (
                          <div key={sg.label}>
                            <div className={styles.navFlyoutLabel} style={{ opacity: 0.7 }}>{sg.label}</div>
                            {sg.itemTos.map((to) => byTo.get(to)).filter(Boolean).map((i) => renderFlyoutItem(i as NavItem))}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </>
              ) : (
                /* No-label sections (Dashboard) — always show items directly */
                section.items.map((item) => {
                  const groupRoutes = ROUTE_GROUPS[item.to];
                  const isGroupActive = groupRoutes
                    ? groupRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
                    : location.pathname === item.to;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={() => clsx(styles.navLink, isGroupActive && styles.navLinkActive)}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <span className={styles.navIcon}>{navIconNode(item)}</span>
                      {!sidebarCollapsed && item.label}
                    </NavLink>
                  );
                })
              )}
            </div>
            );
          })}

          {/* Bottom-nav cluster (Agents / Settings / Help). Skipped on
              mobile — those items are already inlined into the flat
              leaf list above so the bottom strip stays in a single
              horizontal row. */}
          {!isMobile && (
            <>
              <div className={styles.navSpacer} />
              <div className={styles.navDivider} />
              {bottomNavItems.map((item) => (
                item.to === '/help' ? (
                  // Help opens the guide in a separate window, matching
                  // the top-bar Help button — not in-app navigation.
                  <button
                    key={item.to}
                    type="button"
                    onClick={openHelpWindow}
                    className={styles.navLink}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className={styles.navIcon}>{navIconNode(item)}</span>
                    {!sidebarCollapsed && item.label}
                  </button>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      clsx(styles.navLink, isActive && styles.navLinkActive)
                    }
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className={styles.navIcon}>{navIconNode(item)}</span>
                    {!sidebarCollapsed && item.label}
                  </NavLink>
                )
              ))}
            </>
          )}
        </nav>
        <button
          className={styles.sidebarToggle}
          onClick={() => setSidebarCollapsed((c) => !c)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {'\u2630'}
        </button>
      </aside>

      {/* Main content area */}
      <div className={styles.main}>
        <header className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', minWidth: 0 }}>
            {/* Command palette trigger — full search lives in the Cmd-K modal. */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                cursor: 'pointer', color: 'var(--color-text-muted)',
                fontSize: 13, width: 'min(280px, 40vw)', textAlign: 'left',
              }}
              title="Search (press / or Ctrl+K)"
            >
              <span className={styles.searchIcon}>{'\uD83D\uDD0D'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Search anything...
              </span>
              <span style={{
                display: 'inline-block', padding: '1px 5px', fontSize: 10,
                fontFamily: 'var(--font-mono, monospace)',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 3,
              }}>
                {navigator.platform.toUpperCase().includes('MAC') ? '⌘K' : 'Ctrl+K'}
              </span>
            </button>
            {(() => {
              if (orgOptions.length === 0) return (
                <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>No organization defined</span>
              );
              // Single-tier setup (one company, no divisions accessible): show
              // a static label, no picker — there's nowhere else to switch to.
              if (orgOptions.length === 1) return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Organization:</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{orgOptions[0].name}</span>
                </div>
              );
              // Multi-org picker. Group divisions under their parent company
              // so a multi-division enterprise (Tidewater Utilities ▸
              // Electric / Water) is selectable from a single dropdown
              // rather than needing a separate place to pick the division.
              // Companies appear as both an <optgroup> header (label) and
              // the first selectable option inside that group; orphan
              // divisions whose parent the user can't see go into an
              // "Other" group at the end.
              const companies = orgOptions.filter((o) => o.type === 'company');
              const divisionsByParent = new Map<string, typeof orgOptions>();
              for (const o of orgOptions) {
                if (o.type !== 'division') continue;
                const key = o.parentId || '__orphan__';
                if (!divisionsByParent.has(key)) divisionsByParent.set(key, []);
                divisionsByParent.get(key)!.push(o);
              }
              const orphanDivisions = divisionsByParent.get('__orphan__') || [];
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Organization:</span>
                  <select
                    value={activeOrgId}
                    onChange={(e) => handleOrgChange(e.target.value)}
                    style={{
                      padding: '4px 10px', fontSize: 13, fontWeight: 500,
                      border: '1px solid var(--color-border)', borderRadius: 4,
                      background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      minWidth: 220, cursor: 'pointer',
                    }}
                  >
                    {companies.map((co) => {
                      const childDivs = (divisionsByParent.get(co.id) || []).filter((d) => d.parentId === co.id);
                      // If the company has no accessible divisions, render
                      // it as a plain top-level option so the dropdown
                      // doesn't show a one-item optgroup.
                      if (childDivs.length === 0) {
                        return <option key={co.id} value={co.id}>{co.name}</option>;
                      }
                      return (
                        <optgroup key={co.id} label={co.name}>
                          <option value={co.id}>{co.name} (all)</option>
                          {childDivs.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                    {orphanDivisions.length > 0 && (
                      <optgroup label="Other divisions">
                        {orphanDivisions.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              );
            })()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Ask AI — surfaces the ChatPanel from the top bar. The
                ChatPanel still owns its own open state and its floating
                bottom-right bubble; this button is a second entry point
                so dense pages don't bury it. */}
            <button
              onClick={() => window.dispatchEvent(new Event('procela:toggle-chat'))}
              aria-label={chatOpen ? 'Close the AI assistant' : 'Ask the AI assistant'}
              aria-expanded={chatOpen}
              title={chatOpen ? 'Close the AI assistant' : 'Ask the AI assistant'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', fontSize: 12, fontWeight: 500,
                background: chatOpen ? 'var(--color-primary)' : 'var(--color-surface)',
                color: chatOpen ? '#fff' : 'var(--color-text)',
                border: '1px solid ' + (chatOpen ? 'var(--color-primary)' : 'var(--color-border)'),
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer', transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>💬</span>
              <span>Ask AI</span>
            </button>
            {/* Help — opens the Help guide in a separate window so the
                user can keep it open beside whatever they're doing. A
                named target means repeated clicks focus the same Help
                window instead of spawning duplicates. */}
            <button
              onClick={openHelpWindow}
              aria-label="Open the Help guide in a new window"
              title="Open the Help guide in a new window"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', fontSize: 12, fontWeight: 500,
                background: 'var(--color-surface)', color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>{'⍰'}</span>
              <span>Help</span>
            </button>
            {/* Notification Bell */}
            <div ref={notifWrapperRef} style={{ position: 'relative' }}>
              <button
                onClick={handleNotifToggle}
                aria-label="Notifications"
                aria-expanded={notifOpen}
                style={{
                  background: notifOpen ? 'var(--color-bg)' : 'none',
                  border: 'none', cursor: 'pointer',
                  position: 'relative', padding: 6,
                  color: 'var(--color-text-secondary)',
                  borderRadius: 'var(--radius-md)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
                title="Notifications"
              >
                {/* Outline bell — inherits currentColor from the button so it
                    matches the rest of the header text, and stays crisp on
                    high-DPI screens where a Unicode glyph would go fuzzy. */}
                <svg
                  width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true" focusable="false"
                >
                  <path d="M15 17h5l-1.4-1.9a2 2 0 0 1-.4-1.2V10a6.2 6.2 0 0 0-5-6.08V3.5a1.2 1.2 0 1 0-2.4 0v.42A6.2 6.2 0 0 0 5.8 10v3.9a2 2 0 0 1-.4 1.2L4 17h5" />
                  <path d="M10 20a2 2 0 0 0 4 0" />
                </svg>
                {notifCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    background: '#ef4444', color: '#fff', fontSize: 9,
                    fontWeight: 700, borderRadius: '50%',
                    minWidth: 16, height: 16, padding: '0 4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1, boxShadow: '0 0 0 2px var(--color-surface)',
                  }}>
                    {notifCount > 99 ? '99+' : notifCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div
                  role="dialog"
                  aria-label="Notifications"
                  style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  width: 380, maxHeight: 440, overflowY: 'auto',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 800,
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Notifications</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {notifList.some((n) => !n.read) && (
                        <button onClick={handleMarkAllRead} style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 11, color: 'var(--color-primary)', fontWeight: 500,
                        }}>
                          Mark all read
                        </button>
                      )}
                      {notifList.length > 0 && (
                        <button onClick={handleClearAllNotifications} style={{
                          background: clearAllArmed ? 'var(--color-error, #dc2626)' : 'none',
                          border: 'none', cursor: 'pointer', borderRadius: 4, padding: '2px 6px',
                          fontSize: 11, color: clearAllArmed ? '#fff' : 'var(--color-error, #dc2626)', fontWeight: 500,
                        }}>
                          {clearAllArmed ? `Click again to confirm (${clearAllCountdown})` : 'Clear all'}
                        </button>
                      )}
                    </div>
                  </div>
                  {notifLoading && (
                    <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>Loading...</div>
                  )}
                  {!notifLoading && notifList.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>No notifications</div>
                  )}
                  {!notifLoading && notifList.map((n) => {
                    const typeColor = n.type === 'WARNING' ? '#d97706' : n.type === 'ACTION' ? '#0f766e' : '#2563eb';
                    const typeIcon = n.type === 'WARNING' ? '\u26A0' : n.type === 'ACTION' ? '\u25B6' : '\u2139';
                    const ago = (() => {
                      const diff = Date.now() - new Date(n.createdAt).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 1) return 'just now';
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })();
                    return (
                      // role="button" + tabIndex + key handler instead of
                      // wrapping in <button>, because the dismiss control
                      // nested inside is already a button and we can't
                      // nest interactive elements. Enter/Space activate
                      // the notification the same as a click.
                      <div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${n.title}. ${n.read ? 'Read.' : 'Unread.'}`}
                        onClick={() => handleNotifClick(n)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleNotifClick(n);
                          }
                        }}
                        style={{
                          display: 'flex', gap: 10, padding: '10px 14px',
                          cursor: 'pointer', borderBottom: '1px solid var(--color-border)',
                          background: n.read ? 'transparent' : 'var(--color-bg)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? 'transparent' : 'var(--color-bg)'; }}
                      >
                        <span style={{
                          width: 24, height: 24, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, background: typeColor + '18', color: typeColor,
                          flexShrink: 0, marginTop: 2,
                        }}>
                          {typeIcon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: n.read ? 400 : 600, color: 'var(--color-text)' }}>{n.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{n.message}</div>
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>{ago}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {!n.read && (
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%', background: '#2563eb',
                            }} />
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDismissNotification(n.id); }}
                            aria-label="Dismiss notification"
                            title="Dismiss"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1,
                              padding: '2px 4px', borderRadius: 4,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-error, #dc2626)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                          >&times;</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <TerminologyToggle />
            <DensityToggle />
            <div className={styles.userMenu}>
              <div className={styles.userAvatar}>{userInitial}</div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span>{user?.name || 'User'}</span>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {role.replace('_', ' ')}
                </span>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                background: 'transparent',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                color: '#64748b',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main-content" className={styles.content}>
          <Breadcrumbs />
          {!activeOrgId && location.pathname !== '/organizations' && location.pathname !== '/help' && location.pathname !== '/settings' ? (
            <div style={{
              textAlign: 'center', padding: '4rem 2rem',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12, color: 'var(--color-text-muted)' }}>&#x2616;</div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Organization Required</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                You need to create an organization before you can use this feature.
                Open Organizations from the sidebar to set up your company.
              </p>
              <button
                onClick={() => navigate('/organizations')}
                style={{
                  padding: '8px 20px', background: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13,
                  fontWeight: 500, cursor: 'pointer',
                }}
              >
                Set Up Organization
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
        <ChatPanel />
        {isMobile && mobileDrawerOpen && (
          <MobileNavDrawer
            sections={visibleSections}
            bottomItems={bottomNavItems}
            pathname={location.pathname}
            onClose={() => setMobileDrawerOpen(false)}
          />
        )}
        <SessionTimeout />
        <ToastContainer />
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <RoleDetailDrawer />
        <ShortcutsHint onOpenShortcuts={() => setShortcutsOpen(true)} />
        {!activeOrgId && !localStorage.getItem('procela:onboarding-complete') && (
          <OnboardingWizard onComplete={() => { triggerRefresh(); navigate('/'); }} />
        )}
        {tourOpen && (
          <OnboardingWizard mode="tour-only" onComplete={() => setTourOpen(false)} />
        )}
      </div>
    </div>
  );
}
