import { NavLink, useLocation } from 'react-router-dom';

interface PageTab {
  to: string;
  label: string;
}

interface PageTabNavProps {
  tabs: PageTab[];
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  marginBottom: 16,
  borderBottom: '1px solid var(--color-border)',
};

export default function PageTabNav({ tabs }: PageTabNavProps) {
  const location = useLocation();

  return (
    <nav style={containerStyle} aria-label="Page navigation">
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.to;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              marginBottom: -1,
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export const GOVERN_TABS: PageTab[] = [
  { to: '/processes', label: 'Processes' },
  { to: '/data-assets', label: 'Data Assets' },
  { to: '/data-domains', label: 'Data Domains' },
  { to: '/mappings', label: 'Mappings' },
  { to: '/raci', label: 'RACI Matrix' },
  { to: '/gap-detection', label: 'Gap Detection' },
];

export const ANALYZE_TABS: PageTab[] = [
  { to: '/enterprise-view', label: 'Enterprise View' },
  { to: '/data-lineage', label: 'Data Lineage' },
  { to: '/data-quality', label: 'Data Quality' },
  { to: '/reports', label: 'Reports' },
];

export const WORK_TABS: PageTab[] = [
  { to: '/governance-work?tab=tasks', label: 'Tasks' },
  { to: '/governance-work?tab=issues', label: 'Issues' },
];
