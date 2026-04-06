import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import styles from './Layout.module.css';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '\u25A3' },
  { to: '/processes', label: 'Processes', icon: '\u2630' },
  { to: '/data-assets', label: 'Data Assets', icon: '\u26C1' },
  { to: '/systems', label: 'Systems', icon: '\u2699' },
  { to: '/mappings', label: 'Mappings', icon: '\u2194' },
  { to: '/organizations', label: 'Organizations', icon: '\u2616' },
  { to: '/people', label: 'People', icon: '\u263A' },
  { to: '/settings', label: 'Settings', icon: '\u2731' },
  { to: '/help', label: 'Help Guide', icon: '\u003F' },
];

export default function Layout() {
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
          <div className={styles.userMenu}>
            <div className={styles.userAvatar}>U</div>
            <span>User</span>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
