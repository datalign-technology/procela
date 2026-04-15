import { useEffect, useCallback, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';
import Breadcrumbs from './Breadcrumbs';
import ChatPanel from './ChatPanel';
import SessionTimeout from './SessionTimeout';
import ToastContainer from './ToastContainer';
import ShortcutsModal from './ShortcutsModal';
import ShortcutsHint from './ShortcutsHint';
import ScopeBanner from './ScopeBanner';
import DensityToggle from './DensityToggle';
import { useAuthStore } from '@/stores/authStore';
import { useOrgContext } from '@/stores/orgContext';
import { apiClient } from '@/api/client';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

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
      { to: '/people', label: 'People', icon: '\u263B' },
      { to: '/agents', label: 'Agents', icon: '\u2734' },
      { to: '/processes', label: 'Processes', icon: '\u2630' },
      { to: '/systems', label: 'Systems', icon: '\u2699' },
      { to: '/data-assets', label: 'Data Assets', icon: '\u26C1' },
      { to: '/connections', label: 'Connections', icon: '\u26A1' },
    ],
  },
  {
    label: 'Govern',
    items: [
      { to: '/governance', label: 'Governance', icon: '\u2637' },
      { to: '/data-quality', label: 'Data Quality', icon: '\u2713' },
    ],
  },
  {
    label: 'Connect',
    items: [
      { to: '/mappings', label: 'Mappings', icon: '\u2194' },
      { to: '/data-lineage', label: 'Data Lineage', icon: '\u21C4' },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { to: '/analyze', label: 'Analyze', icon: '\u26A0' },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { to: '/settings', label: 'Settings', icon: '\u2731' },
  { to: '/help', label: 'Help', icon: '\u003F' },
];

interface SearchResult {
  type: 'process' | 'system' | 'data-asset' | 'organization' | 'person';
  id: string;
  name: string;
  description: string;
  meta: Record<string, string>;
}

const typeRouteMap: Record<string, string> = {
  process: '/processes',
  system: '/systems',
  'data-asset': '/data-assets',
  organization: '/organizations',
  person: '/organizations',
};

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

const WORKING_ORG_LEVELS = ['company', 'division'];

function flattenOrgTree(nodes: OrgTreeNode[], depth: number = 0): Array<{ id: string; name: string; type: string; label: string }> {
  const result: Array<{ id: string; name: string; type: string; label: string }> = [];
  for (const node of nodes) {
    if (WORKING_ORG_LEVELS.includes(node.type)) {
      const indent = '\u00A0\u00A0'.repeat(depth);
      const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
      result.push({ id: node.id, name: node.name, type: node.type, label: `${indent}${node.name} (${typeLabel})` });
    }
    if (node.children.length > 0) result.push(...flattenOrgTree(node.children, depth + (WORKING_ORG_LEVELS.includes(node.type) ? 1 : 0)));
  }
  return result;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { activeOrgId, activeOrgName, setActiveOrg, setOrgs, clearActiveOrg, refreshKey } = useOrgContext();
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string; type: string; label: string }>>([]);

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Notification state
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifWrapperRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Shortcuts modal state
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Global keyboard shortcuts. Cmd/Ctrl+K and `/` both focus the search.
  // `?` opens the shortcuts modal. `g` followed by a letter goes somewhere
  // (handled separately so the second key isn't a chord).
  useKeyboardShortcut('k', () => searchInputRef.current?.focus(), { mod: true });
  useKeyboardShortcut('/', () => searchInputRef.current?.focus());
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
      if (e.key === 'g' && !e.shiftKey) {
        lastGRef.current = now;
        return;
      }
      if (now - lastGRef.current < 1500) {
        const map: Record<string, string> = {
          d: '/', o: '/organizations', p: '/people', c: '/processes', a: '/data-assets',
          s: '/systems', q: '/data-quality', l: '/data-lineage', m: '/mappings',
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

  // Search debounce
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiClient.get<{ success: boolean; data: { results: SearchResult[] } }>(
          `/search?q=${encodeURIComponent(q)}`
        );
        setSearchResults(res.data.results);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Close search dropdown on click outside or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSearchOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const handleSearchResultClick = (result: SearchResult) => {
    setSearchOpen(false);
    setSearchQuery('');
    const route = typeRouteMap[result.type] || '/';
    navigate(route);
  };

  const fetchOrgs = useCallback(async () => {
    try {
      // Fetch accessible orgs for the current user (filtered by role/assignment)
      const accessRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; type: string }> }>('/auth/accessible-orgs');
      const accessible = accessRes.data || [];

      const options = accessible.map((o) => {
        const typeLabel = o.type.charAt(0).toUpperCase() + o.type.slice(1);
        return { id: o.id, name: o.name, type: o.type, label: `${o.name} (${typeLabel})` };
      });

      setOrgOptions(options);
      setOrgs(options.map((o) => ({ id: o.id, name: o.name, type: o.type })));

      // If active org is no longer accessible, clear it
      if (activeOrgId && !options.find((o) => o.id === activeOrgId)) {
        // Active org no longer accessible — select first available
        if (options.length > 0) {
          setActiveOrg(options[0].id, options[0].name, options[0].type);
        } else {
          clearActiveOrg();
        }
      }

      // Auto-select first org if none is selected
      if (!activeOrgId && options.length > 0) {
        setActiveOrg(options[0].id, options[0].name, options[0].type);
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
      {/* Sidebar */}
      <aside className={clsx(styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed)}>
        <div className={styles.sidebarBrand}>
          <img src="/procela-icon.png" alt="Procela" className={styles.brandIcon} />
          {!sidebarCollapsed && <span>Procela</span>}
        </div>
        <nav className={styles.sidebarNav}>
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className={styles.navGroup}>
              {section.label && !sidebarCollapsed && (
                <div className={styles.navGroupLabel}>{section.label}</div>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => clsx(styles.navLink, isActive && styles.navLinkActive)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {!sidebarCollapsed && item.label}
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
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {!sidebarCollapsed && item.label}
            </NavLink>
          ))}
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
            {/* Global Search */}
            <div className={styles.searchWrapper} ref={searchWrapperRef}>
              <span className={styles.searchIcon}>{'\uD83D\uDD0D'}</span>
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                placeholder="Search... (press / or Ctrl+K)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                onKeyDown={(e) => {
                  // Escape clears the query AND closes the dropdown — common
                  // expectation for search inputs and mirrors the X button.
                  if (e.key === 'Escape' && searchQuery) {
                    e.preventDefault();
                    setSearchQuery('');
                    setSearchResults([]);
                    setSearchOpen(false);
                  }
                }}
                style={{ maxWidth: 'min(220px, 40vw)', paddingRight: searchQuery ? 28 : undefined }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setSearchOpen(false);
                  }}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    width: 18, height: 18, padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1,
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  &times;
                </button>
              )}
              {searchOpen && (
                <div className={styles.searchDropdown}>
                  {searchLoading && (
                    <div className={styles.searchEmpty}>Searching...</div>
                  )}
                  {!searchLoading && searchResults.length === 0 && (
                    <div className={styles.searchEmpty}>No results found</div>
                  )}
                  {!searchLoading && searchResults.map((r) => (
                    <div
                      key={`${r.type}-${r.id}`}
                      className={styles.searchResult}
                      onClick={() => handleSearchResultClick(r)}
                    >
                      <span className={styles.searchBadge}>{r.type}</span>
                      <div className={styles.searchResultText}>
                        <div className={styles.searchResultName}>{r.name}</div>
                        {r.description && (
                          <div className={styles.searchResultDesc}>{r.description}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {orgOptions.length > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={activeOrgId}
                  onChange={(e) => handleOrgChange(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: 13, fontWeight: 600,
                    border: '2px solid var(--color-primary)', borderRadius: 6,
                    background: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                    minWidth: 200, maxWidth: '100%', width: 'auto', cursor: 'pointer',
                  }}
                >
                  {!activeOrgId && <option value="">-- Select Organization --</option>}
                  {orgOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ) : orgOptions.length === 1 ? (
              <div style={{
                padding: '4px 12px', fontSize: 13, fontWeight: 600,
                background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                borderRadius: 6, border: '1px solid var(--color-primary)',
              }}>
                {orgOptions[0].name}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                <div style={{
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
                    {notifList.some((n) => !n.read) && (
                      <button onClick={handleMarkAllRead} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 11, color: 'var(--color-primary)', fontWeight: 500,
                      }}>
                        Mark all as read
                      </button>
                    )}
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
                      <div
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
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
                        {!n.read && (
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', background: '#2563eb',
                            flexShrink: 0, marginTop: 6,
                          }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <DensityToggle />
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
        <a
          href="#main-content"
          style={{
            position: 'absolute', left: -9999, top: 8,
            background: 'var(--color-primary)', color: '#fff',
            padding: '6px 14px', borderRadius: 4, zIndex: 1200,
            fontSize: 13, fontWeight: 500,
          }}
          onFocus={(e) => { e.currentTarget.style.left = '8px'; }}
          onBlur={(e) => { e.currentTarget.style.left = '-9999px'; }}
        >
          Skip to main content
        </a>
        <ScopeBanner />
        <main id="main-content" className={styles.content}>
          <Breadcrumbs />
          <Outlet />
        </main>
        <ChatPanel />
        <SessionTimeout />
        <ToastContainer />
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <ShortcutsHint onOpenShortcuts={() => setShortcutsOpen(true)} />
      </div>
    </div>
  );
}
