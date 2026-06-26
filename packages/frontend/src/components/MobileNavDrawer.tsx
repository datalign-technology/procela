import React from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { navIconNode } from './navIcons';
import {
  ROUTE_GROUPS,
  openHelpWindow,
  navSections,
  GET_STARTED_ITEM,
  type NavItem,
  type NavSection,
} from './navConfig';
import { useOrgContext } from '@/stores/orgContext';
import { useSetupStore } from '@/stores/setupStore';
import { usePermissions } from '@/hooks/usePermissions';

// Full-screen mobile navigation drawer. Opened from the "Menu" button
// in the bottom bar; shows the complete navigation with section
// headings preserved, so a phone user can find any page without
// sideways-scrolling a 30-icon strip.
//
// Computes its own visible-section list (Get Started + admin filter)
// so the host shell doesn't have to re-derive the same thing the
// Sidebar already does.
export default function MobileNavDrawer({ bottomItems, pathname, onClose }: {
  bottomItems: NavItem[];
  pathname: string;
  onClose: () => void;
}) {
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const setupProgress = useSetupStore((s) => (activeOrgId ? s.progressByOrg[activeOrgId] : undefined));
  const showSetup = !!activeOrgId && (setupProgress === undefined || setupProgress < 100);
  const baseSections = showSetup
    ? [{ label: null, items: [GET_STARTED_ITEM] } as NavSection, ...navSections]
    : navSections;
  const sections = baseSections.filter((s) => !s.adminOnly || isAdmin);
  // Flat lookup of every nav item across every section — so the
  // exact-match-on-a-sibling suppression below works across the
  // whole drawer rather than just within one section.
  const allItems = sections.flatMap((s) => s.items);
  const isActive = (to: string) => {
    if (pathname === to) return true;
    // If any OTHER nav item exactly matches the current path, that
    // sibling owns the active state. Without this, /data-assets/orphans
    // lights up BOTH Data Assets (parent prefix) and Orphan Assets
    // (its own row), reading as "both have been clicked".
    const siblingExact = allItems.some((i) => i.to !== to && pathname === i.to);
    if (siblingExact) return false;
    const candidates = ROUTE_GROUPS[to] || [to];
    return candidates.some((r) => pathname === r || pathname.startsWith(r + '/'));
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', lineHeight: 1, padding: 4, display: 'inline-flex' }}
        ><X size={20} strokeWidth={2.2} /></button>
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
