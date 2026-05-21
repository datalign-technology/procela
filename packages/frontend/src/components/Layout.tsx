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

type NavItem = { to: string; label: string; icon: string };
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

// Append U+FE0E (VARIATION SELECTOR-15) to single-codepoint symbol
// icons so the OS renders them as text glyphs, not coloured emoji.
// Without this, Windows substitutes Segoe UI Emoji for codepoints
// like U+2638 (Wheel of Dharma, the Settings icon) and paints them
// in colour. Surrogate-pair icons (e.g. the 📋 clipboard used for
// Policies) are intentional emoji and are passed through unchanged.
function textIcon(s: string): string {
  return [...s].length === 1 && s.charCodeAt(0) < 0xD800 ? s + '︎' : s;
}

// Five plain-noun buckets so users can find things by what they ARE,
// not by which DAMA phase they belong to. Order maps to Procela's
// three layers (Business / Data / Systems / People) with Governance
// last as the cross-cutting program that ties them together.
const navSections: NavSection[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: '\u25A3' },
      // Organizations is the company / division / team tree the user
      // builds during onboarding. It's structural, not personnel \u2014
      // putting it under "People" misled newcomers, so it now sits
      // top-level next to Dashboard.
      { to: '/organizations', label: 'Organizations', icon: '\u2616' },
      // Processes has only one page, so wrapping it in an accordion
      // section produced a pointless "Processes \u203A Processes" expand.
      // It's a direct top-level link like Dashboard / Organizations.
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
    label: 'People',
    items: [
      { to: '/people', label: 'People', icon: '\uD83D\uDC65' },
      { to: '/skills', label: 'Skills', icon: '\u2605' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/governance-program', label: 'Program', icon: '\u2637' },
      { to: '/governance-groups', label: 'Groups', icon: '\u2616' },
      { to: '/dama-roles', label: 'Roles', icon: '\u263C' },
      { to: '/governance-policies', label: 'Policies', icon: '\uD83D\uDCCB' },
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
  // Agents is the AI-bot registry kept next to Settings rather than
  // under 'People' alongside humans, where it was easy to miss and
  // conceptually misleading.
  { to: '/agents', label: 'Agents', icon: '\u2699' },
  { to: '/settings', label: 'Settings', icon: '\u2638' },
  { to: '/help', label: 'Help', icon: '\u003F' },
];

// The four primary destinations pinned to the mobile bottom bar; the
// fifth slot is the "Menu" button that opens the full grouped drawer.
const MOBILE_PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '\u25A3' },
  { to: '/processes', label: 'Processes', icon: '\u26C1' },
  { to: '/data-assets', label: 'Data', icon: '\u2B22' },
  { to: '/people', label: 'People', icon: '\uD83D\uDC65' },
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
  const linkRow = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', fontSize: 15, textDecoration: 'none',
        color: isActive(item.to) ? 'var(--color-primary)' : 'var(--color-text)',
        fontWeight: isActive(item.to) ? 600 : 400,
        background: isActive(item.to) ? 'var(--color-bg)' : 'transparent',
      }}
    >
      <span style={{ width: 22, textAlign: 'center', fontSize: 16 }}>{textIcon(item.icon)}</span>
      {item.label}
    </NavLink>
  );
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
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string; type: string; label: string }>>([]);

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
    document.title = match ? `${match.label}${suffix} · Procela` : 'Procela';
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
      // Fetch accessible orgs for the current user (filtered by role/assignment)
      const accessRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; type: string }> }>('/auth/accessible-orgs');
      const accessible = accessRes.data || [];

      const options = accessible.map((o) => {
        const typeLabel = o.type.charAt(0).toUpperCase() + o.type.slice(1);
        return { id: o.id, name: o.name, type: o.type, label: `${o.name} (${typeLabel})` };
      });
      // Sort so company comes first, then divisions — ensures the broadest scope is the default
      const typeOrder: Record<string, number> = { company: 0, division: 1, department: 2, team: 3, unit: 4 };
      options.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

      setOrgOptions(options);
      setOrgs(options.map((o) => ({ id: o.id, name: o.name, type: o.type })));

      // Filter to top-level companies only for the selector
      const companies = options.filter((o) => o.type === 'company');

      // If active org is no longer accessible, clear it
      if (activeOrgId && !companies.find((o) => o.id === activeOrgId)) {
        if (companies.length > 0) {
          setActiveOrg(companies[0].id, companies[0].name, companies[0].type);
        } else {
          clearActiveOrg();
        }
      }

      // Auto-select first company if none is selected
      if (!activeOrgId && companies.length > 0) {
        setActiveOrg(companies[0].id, companies[0].name, companies[0].type);
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
                    <span className={styles.navIcon}>{textIcon(item.icon)}</span>
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
                <span className={styles.navIcon}>{'☰'}</span>
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
                    style={{ cursor: 'pointer', userSelect: 'none', width: '100%', textAlign: 'left', background: 'transparent', font: 'inherit', color: 'inherit', border: 'none' }}
                    title={sidebarCollapsed ? section.label : undefined}
                  >
                    <span className={styles.navIcon}>{textIcon(section.items[0]?.icon || '')}</span>
                    {!sidebarCollapsed && (
                      <>
                        <span style={{ flex: 1 }}>{section.label}</span>
                        <span aria-hidden style={{ fontSize: 10, opacity: 0.5, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>{'▶'}</span>
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
                          <span className={styles.navIcon}>{textIcon(item.icon)}</span>
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
                              <span className={styles.navIcon}>{textIcon(item.icon)}</span>
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
                      <span className={styles.navIcon}>{textIcon(item.icon)}</span>
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
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(styles.navLink, isActive && styles.navLinkActive)
                  }
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className={styles.navIcon}>{textIcon(item.icon)}</span>
                  {!sidebarCollapsed && item.label}
                </NavLink>
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
              const companies = orgOptions.filter((o) => o.type === 'company');
              if (companies.length === 0) return (
                <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>No organization defined</span>
              );
              if (companies.length === 1) return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Organization:</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{companies[0].name}</span>
                </div>
              );
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
                      minWidth: 180, cursor: 'pointer',
                    }}
                  >
                    {companies.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
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
