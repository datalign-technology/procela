import { Link, useLocation } from 'react-router-dom';
import { useBreadcrumbLeafValue } from './BreadcrumbContext';

// Segment → label. Where a segment is a top-level nav destination the
// label MUST match the sidebar item exactly — a breadcrumb that
// disagrees with the menu the user just clicked ("Roles" in the nav,
// "Governance Roles" in the trail) is disorienting. Sub-route-only
// segments (wizard, visualization…) have no sidebar entry and are
// labelled here freely.
const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  'processes': 'Processes',
  'wizard': 'Wizard',
  'visualization': 'Visualization',
  'compare': 'Compare',
  'organizations': 'Organizations',
  'people': 'People',
  'agents': 'Agents',
  'connections': 'Connections',
  'systems': 'Systems',
  'systems-and-data': 'Systems & Data',
  'data-assets': 'Data Assets',
  'mappings': 'Data Mapping',
  'gap-detection': 'Gap Detection',
  'governance': 'Governance',
  'governance-groups': 'Groups',
  'governance-program': 'Program',
  'data-domains': 'Domains',
  'dama-roles': 'Roles',
  'analyze': 'Analyze',
  'scorecard': 'Scorecard',
  'report': 'Executive Report',
  'raci': 'RACI Matrix',
  'data-lineage': 'Lineage',
  'data-quality': 'Data Quality',
  'control-tower': 'Control Tower',
  'governance-policies': 'Policies',
  'governance-work': 'Tasks & Issues',
  'enterprise-view': 'Enterprise View',
  'reports': 'Reports',
  'branding': 'Branding',
  'settings': 'Settings',
  'help': 'Help',
  'operations-manual': 'Operations Manual',
  'governance-calendar': 'Calendar',
  'decision-rights': 'Decision Rights',
  'sops': 'Procedures',
  'business-glossary': 'Glossary',
};

const containerStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  marginBottom: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  textDecoration: 'none',
};

const separatorStyle: React.CSSProperties = {
  color: 'var(--color-border)',
  userSelect: 'none',
};

// The current page (the leaf), rendered as text rather than a link — a touch
// stronger than the ancestor links so "you are here" reads at a glance.
const leafStyle: React.CSSProperties = {
  color: 'var(--color-text)',
  fontWeight: 500,
  maxWidth: 280,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export default function Breadcrumbs() {
  const location = useLocation();
  const pathname = location.pathname;
  const leaf = useBreadcrumbLeafValue();

  // Don't render on dashboard
  if (pathname === '/') return null;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // Build breadcrumb items: always start with Dashboard.
  const crumbs: Array<{ label: string; path: string }> = [
    { label: 'Dashboard', path: '/' },
  ];

  let builtPath = '';
  segments.forEach((segment) => {
    builtPath += `/${segment}`;
    const label = ROUTE_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
    crumbs.push({ label, path: builtPath });
  });

  // The last crumb always names the page you're on. Its handling depends on
  // whether the page registered a human-readable leaf (see BreadcrumbContext):
  //
  //  • No leaf — the ancestor trail alone. On a detail route the last segment
  //    is a raw id/slug, and on a top-level page the <PageHeader> H1 below
  //    already states the name, so showing it again is redundant. Drop it, and
  //    when that leaves just "Dashboard" render nothing rather than a lone crumb.
  //  • Leaf set — a detail page told us the entity's name, so end the trail on
  //    it (as text, not a link) the way a catalog reads "Catalog › Schema ›
  //    Table". The ancestors already exclude the raw id segment.
  const ancestors = crumbs.slice(0, -1);

  if (!leaf) {
    if (ancestors.length <= 1) return null;
    return (
      <nav style={containerStyle} aria-label="Breadcrumb">
        {ancestors.map((crumb, idx) => (
          <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {idx > 0 && <span style={separatorStyle}>{'>'}</span>}
            <Link to={crumb.path} style={linkStyle}>{crumb.label}</Link>
          </span>
        ))}
      </nav>
    );
  }

  return (
    <nav style={containerStyle} aria-label="Breadcrumb">
      {ancestors.map((crumb) => (
        <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link to={crumb.path} style={linkStyle}>{crumb.label}</Link>
          <span style={separatorStyle}>{'>'}</span>
        </span>
      ))}
      <span style={leafStyle} aria-current="page">{leaf}</span>
    </nav>
  );
}
