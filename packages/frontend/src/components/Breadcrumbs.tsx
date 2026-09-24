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

  // The trail is a detail-page affordance only. A page shows it exactly when it
  // has registered a human-readable leaf (its entity's name, via
  // BreadcrumbContext) — a person, a governance group — so the trail reads
  // "Dashboard › People › Ada Lovelace" and links back up. Section and list
  // pages register no leaf: there the sidebar already highlights the section
  // and the <PageHeader> H1 names the page, so an ancestor-only trail like
  // "Dashboard › Governance" above Foundation was redundant and, because it
  // showed only on nested routes, inconsistent with the sibling pages that
  // never had one. So: no leaf ⇒ no breadcrumb.
  if (!leaf) return null;

  // The ancestors already exclude the raw id/slug segment (it's the last one,
  // sliced off here); the leaf renders as text, not a link.
  const ancestors = crumbs.slice(0, -1);

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
