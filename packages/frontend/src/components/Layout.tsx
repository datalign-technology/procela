import { useEffect, useCallback, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';
import ChatPanel from './ChatPanel';
import { useAuthStore } from '@/stores/authStore';
import { useOrgContext } from '@/stores/orgContext';
import { apiClient } from '@/api/client';

type NavItem = { to: string; label: string; icon: string };
type NavSection = { label: string | null; items: NavItem[] };

const navSections: NavSection[] = [
  {
    label: null, // standalone top item
    items: [
      { to: '/', label: 'Dashboard', icon: '\u25A3' },
    ],
  },
  {
    label: 'Define',
    items: [
      { to: '/organizations', label: 'Organizations', icon: '\u2616' },
      { to: '/processes', label: 'Processes', icon: '\u2630' },
      { to: '/systems', label: 'Systems', icon: '\u2699' },
      { to: '/data-assets', label: 'Data Assets', icon: '\u26C1' },
    ],
  },
  {
    label: 'Connect',
    items: [
      { to: '/mappings', label: 'Mappings', icon: '\u2194' },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { to: '/gap-detection', label: 'Gap Detection', icon: '\u26A0' },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { to: '/settings', label: 'Settings', icon: '\u2731' },
  { to: '/help', label: 'Help', icon: '\u003F' },
];

interface OrgFlat {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

interface OrgTreeNode {
  id: string;
  name: string;
  type: string;
  children: OrgTreeNode[];
}

function flattenOrgTree(nodes: OrgTreeNode[], depth: number = 0): Array<{ id: string; name: string; type: string; label: string }> {
  const result: Array<{ id: string; name: string; type: string; label: string }> = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
    const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    result.push({ id: node.id, name: node.name, type: node.type, label: `${indent}${node.name} (${typeLabel})` });
    if (node.children.length > 0) result.push(...flattenOrgTree(node.children, depth + 1));
  }
  return result;
}

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { activeOrgId, activeOrgName, setActiveOrg, setOrgs, clearActiveOrg, refreshKey } = useOrgContext();
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string; type: string; label: string }>>([]);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgTreeNode[] }>('/organizations');
      const flat = flattenOrgTree(res.tree || []);
      setOrgOptions(flat);
      setOrgs(flat.map((o) => ({ id: o.id, name: o.name, type: o.type })));
      // If active org no longer exists, clear it
      if (activeOrgId && !flat.find((o) => o.id === activeOrgId)) {
        clearActiveOrg();
      }
    } catch { /* */ }
  }, [activeOrgId, setOrgs, clearActiveOrg, refreshKey]);

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
    if (!id) { clearActiveOrg(); return; }
    const org = orgOptions.find((o) => o.id === id);
    if (org) setActiveOrg(id, org.name);
  };

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div className={styles.shell}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <img src="/procela-icon.png" alt="Procela" className={styles.brandIcon} />
          <span>Procela</span>
        </div>
        <nav className={styles.sidebarNav}>
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className={styles.navGroup}>
              {section.label && (
                <div className={styles.navGroupLabel}>{section.label}</div>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    clsx(styles.navLink, isActive && styles.navLinkActive)
                  }
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          <div className={styles.navSpacer} />
          <div className={styles.navDivider} />

          {bottomNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(styles.navLink, isActive && styles.navLinkActive)
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <div className={styles.main}>
        <header className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src="/procela-logo.png" alt="Procela" className={styles.headerLogo} />
            {orgOptions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Working in:</span>
                <select
                  value={activeOrgId}
                  onChange={(e) => handleOrgChange(e.target.value)}
                  style={{
                    padding: '4px 8px', fontSize: 13, fontWeight: 500,
                    border: '1px solid var(--color-border)', borderRadius: 6,
                    background: activeOrgId ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    color: activeOrgId ? 'var(--color-primary)' : 'var(--color-text)',
                    minWidth: 200, cursor: 'pointer',
                  }}
                >
                  <option value="">All Organizations</option>
                  {orgOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className={styles.userMenu}>
              <div className={styles.userAvatar}>{userInitial}</div>
              <span>{user?.name || 'User'}</span>
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
        <main className={styles.content}>
          <Outlet />
        </main>
        <ChatPanel />
      </div>
    </div>
  );
}
