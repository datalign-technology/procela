import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';
import ChatPanel from './ChatPanel';
import { useAuthStore } from '@/stores/authStore';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '\u25A3' },
  { to: '/processes', label: 'Processes', icon: '\u2630' },
  { to: '/data-assets', label: 'Data Assets', icon: '\u26C1' },
  { to: '/systems', label: 'Systems', icon: '\u2699' },
  { to: '/mappings', label: 'Mappings', icon: '\u2194' },
  { to: '/gap-detection', label: 'Gap Detection', icon: '\u26A0' },
  { to: '/organizations', label: 'Organizations', icon: '\u2616' },
  { to: '/people', label: 'People', icon: '\u263A' },
  { to: '/settings', label: 'Settings', icon: '\u2731' },
  { to: '/help', label: 'Help Guide', icon: '\u003F' },
];

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();

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
          {navItems.map((item) => (
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
        </nav>
      </aside>

      {/* Main content area */}
      <div className={styles.main}>
        <header className={styles.header}>
          <img src="/procela-logo.png" alt="Procela" className={styles.headerLogo} />
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
