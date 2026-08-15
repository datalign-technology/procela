import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';
import ProgressRing from './ProgressRing';
import { navIconNode, NavChevron, NAV_MENU_ICON } from './navIcons';
import {
  navSections,
  bottomNavItems,
  MOBILE_PRIMARY,
  GET_STARTED_ITEM,
  ROUTE_GROUPS,
  openHelpWindow,
  type NavItem,
  type NavSection,
} from './navConfig';
import { useBrandingStore } from '@/stores/brandingStore';
import { useOrgContext } from '@/stores/orgContext';
import { useSetupStore, shouldShowGetStarted } from '@/stores/setupStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useIsMobile } from '@/hooks/useMediaQuery';

// ──────────────────────────────────────────────────────────────────────────
// Sidebar — the desktop nav rail (collapsible, with section accordions and
// flyout panels) plus the mobile bottom bar that triggers the full-screen
// drawer. Owns its own collapse / accordion / flyout state internally; the
// only thing the host has to do is render <MobileNavDrawer> at the root and
// pass its open-callback in via onOpenMobileMenu.
//
// Extracted from Layout.tsx so the shell isn't carrying ~260 lines of nav
// render code on top of the rest of the app chrome.
// ──────────────────────────────────────────────────────────────────────────

/** Decide whether a nav item is "active" given the current pathname.
 *  Exact match always wins. Prefix / alias match (via ROUTE_GROUPS,
 *  or the item's own path) is suppressed when a SIBLING nav item is
 *  the exact match — otherwise visiting /data-assets/orphans would
 *  highlight both Orphan Assets (its own row) AND Data Assets (the
 *  parent prefix), which reads as "both have been clicked". */
function isNavItemActive(item: NavItem, siblings: ReadonlyArray<NavItem>, pathname: string): boolean {
  if (pathname === item.to) return true;
  // If any sibling is an exact match for the current path, the
  // sibling owns the active state. Parent rows should not light up
  // for routes that have their own listed nav entry.
  const siblingExact = siblings.some((s) => s.to !== item.to && pathname === s.to);
  if (siblingExact) return false;
  const candidates = ROUTE_GROUPS[item.to] || [item.to];
  return candidates.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

interface SidebarProps {
  /** Called when the user taps the "Menu" button on mobile so the host
   *  can open its own MobileNavDrawer. */
  onOpenMobileMenu: () => void;
  /** Mirrored on the menu button as aria-expanded so screen readers
   *  announce drawer state from the trigger. */
  mobileDrawerOpen: boolean;
}

export default function Sidebar({ onOpenMobileMenu, mobileDrawerOpen }: SidebarProps) {
  const location = useLocation();
  const { branding } = useBrandingStore();
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const isMobile = useIsMobile();

  // "Get Started" Setup Hub visibility. Progress is computed by the Hub page
  // and persisted in setupStore; an undefined value (never visited) keeps the
  // entry visible as a nudge. The user's explicit choice (Hide button / the
  // Settings control) overrides: 'hidden' removes it, 'shown' pins it, 'auto'
  // (default) hides it once the org hits 100%.
  const setupProgress = useSetupStore((s) => (activeOrgId ? s.progressByOrg[activeOrgId] : undefined));
  const setupVisibility = useSetupStore((s) => s.visibility);
  const showSetup = !!activeOrgId && shouldShowGetStarted(setupVisibility, setupProgress);

  const baseSections = showSetup
    ? [{ label: null, items: [GET_STARTED_ITEM] } as NavSection, ...navSections]
    : navSections;
  const visibleSections = baseSections.filter((s) => !s.adminOnly || isAdmin);

  // Sidebar collapse state — local to the sidebar; no callers elsewhere
  // care about whether it's open or collapsed.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Accordion nav: which section is expanded. Multi-open — navigating
  // to a section *adds* it to the open set rather than replacing the
  // previous one, so bouncing People → Data → People no longer
  // collapses the section you came from. The user can still close any
  // section by clicking its header.
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

  return (
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
              const isActive = isNavItemActive(item, MOBILE_PRIMARY, location.pathname);
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
              onClick={onOpenMobileMenu}
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
                    const isGroupActive = isNavItemActive(item, section.items, location.pathname);
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
                        const isGroupActive = isNavItemActive(item, section.items, location.pathname);
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
                    <span className={styles.navIcon}>
                      {item.to === '/setup' && setupProgress !== undefined
                        ? <ProgressRing percent={setupProgress} />
                        : navIconNode(item)}
                    </span>
                    {!sidebarCollapsed && item.label}
                  </NavLink>
                );
              })
            )}
          </div>
          );
        })}

        {/* Bottom-nav cluster (Settings / Help). Skipped on mobile —
            those items are already inlined into the flat leaf list
            above so the bottom strip stays in a single horizontal row. */}
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
        {'☰'}
      </button>
    </aside>
  );
}
