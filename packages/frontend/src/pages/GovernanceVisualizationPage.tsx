import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import Spinner from '../components/Spinner';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import SecondaryButton from '../components/SecondaryButton';
import Avatar from '../components/Avatar';
import { Icon } from '../components/IconButton';
import { installPrintFit } from '../lib/printFit';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceVisualizationPage — "Governance → Groups → Org chart".
//
// Lays the governance structure out in the six DAMA layers (Council at the top,
// Communities of Practice at the bottom), one labelled lane each. A lane with
// no group of that type shows a dashed "Add" slot, so the recommended shape is
// legible even where it isn't filled in. Clicking a group selects it and shows
// its members in the side panel, with a link through to the full group page.
// ──────────────────────────────────────────────────────────────────────────

interface GroupMember {
  personId: string;
  personName?: string;
  groupRole: string;
  since: string;
}

interface GovernanceGroup {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  children: GovernanceGroup[];
}

// The six governance layers, top (direction) to bottom (daily work).
const LAYERS: Array<{ type: string; label: string; hint: string }> = [
  { type: 'COUNCIL', label: 'Council', hint: 'Sets direction' },
  { type: 'OFFICE', label: 'Office', hint: 'Runs the program' },
  { type: 'COMMITTEE', label: 'Committee', hint: 'Coordinates' },
  { type: 'STEWARDSHIP_TEAM', label: 'Stewardship', hint: 'Daily care of data' },
  { type: 'WORKING_GROUP', label: 'Working groups', hint: 'Single topic' },
  { type: 'COMMUNITY_OF_PRACTICE', label: 'Communities', hint: 'Share know-how' },
];

const TYPE_LABEL: Record<string, string> = {
  COUNCIL: 'Council', OFFICE: 'Office', COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship team', WORKING_GROUP: 'Working group',
  COMMUNITY_OF_PRACTICE: 'Community of practice',
};

const GROUP_ROLE_LABELS: Record<string, string> = {
  CHAIR: 'Chair', VICE_CHAIR: 'Vice Chair', MEMBER: 'Member', SECRETARY: 'Secretary', ADVISOR: 'Advisor',
};

function findChair(members: GroupMember[]): string | null {
  const chair = members.find((m) => m.groupRole === 'CHAIR');
  return chair?.personName || null;
}

function flattenTree(tree: GovernanceGroup[]): GovernanceGroup[] {
  const out: GovernanceGroup[] = [];
  const walk = (nodes: GovernanceGroup[]) => { for (const n of nodes) { out.push(n); walk(n.children || []); } };
  walk(tree);
  return out;
}

// ── Print styles (unchanged behaviour: hide chrome, fit the chart to one page) ──

const PRINT_STYLE_ID = 'procela-gov-viz-print-styles';

function ensurePrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      nav, header, aside.app-aside,
      .sidebar, [class*="sidebar"], [class*="Sidebar"],
      [class*="header"], [class*="Header"],
      [class*="chatPanel"], [class*="ChatPanel"],
      [class*="sessionTimeout"], [class*="toast"],
      [class*="shell"] > aside {
        display: none !important;
      }
      [class*="shell"], [class*="main"] { display: block !important; }
      [class*="content"] { padding: 0 !important; overflow: visible !important; }
      .gov-viz-controls, .gov-viz-sidepanel { display: none !important; }
      .gov-print-header, .gov-print-footer { display: block !important; }
      .gov-viz-container, .gov-viz-scroll-area {
        transform: none !important; overflow: visible !important;
        height: auto !important; max-height: none !important; padding: 0 !important;
        background: white !important;
      }
      [data-print-fit] { transform: scale(var(--print-fit)) !important; transform-origin: top left !important; }
      .gov-viz-card { break-inside: avoid; box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
      @page { margin: 0.5in; size: landscape; }
    }
  `;
  document.head.appendChild(style);
}

// Resolve member names onto the tree (the list endpoint carries personId only).
async function enrichTree(tree: GovernanceGroup[], client: { get: (url: string) => Promise<any> }): Promise<GovernanceGroup[]> {
  const peopleMap = new Map<string, string>();
  try {
    const res = await client.get('/people');
    for (const p of (res as any).data || []) peopleMap.set(p.id, p.name);
  } catch { /* */ }
  const enrichNode = (node: GovernanceGroup): GovernanceGroup => ({
    ...node,
    members: node.members.map((m) => ({ ...m, personName: m.personName || peopleMap.get(m.personId) || 'Unknown' })),
    children: node.children.map(enrichNode),
  });
  return tree.map(enrichNode);
}

export default function GovernanceVisualizationPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [tree, setTree] = useState<GovernanceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const printFitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensurePrintStyles();
    return installPrintFit(() => printFitRef.current);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; tree: GovernanceGroup[] }>(`/governance-groups${qp}`);
      const enriched = await enrichTree(res.tree || [], apiClient);
      setTree(enriched);
      setSelectedId((prev) => prev && flattenTree(enriched).some((g) => g.id === prev) ? prev : (flattenTree(enriched)[0]?.id ?? null));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load governance data'));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const flat = flattenTree(tree);
  const memberTotal = flat.reduce((a, g) => a + (g.members?.length || 0), 0);
  const selected = flat.find((g) => g.id === selectedId) || null;
  const groupsByType = (type: string) => flat.filter((g) => g.type === type);

  const zoomIn = () => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
  const zoomReset = () => setZoom(1);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const zoomBtn: React.CSSProperties = { width: 38, height: 36, border: 0, background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  return (
    <div>
      {/* Print-only header */}
      <div className="gov-print-header" style={{ display: 'none', padding: '16px 0', borderBottom: '2px solid #0f4f46', marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>Procela — Data Governance Structure</div>
        {activeOrgName && <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>Organization: {activeOrgName}</div>}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Exported: {today}</div>
      </div>

      <div className="gov-viz-controls">
        <PageHeader
          kicker={<><Link to="/governance-groups" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Governance Groups</Link><span style={{ margin: '0 6px', color: 'var(--color-text-muted)' }}>/</span><span>Org chart</span></>}
          title="Governance org chart"
          subtitle={`Who reports to whom. Click a group to see its members. Groups ${flat.length} · Members ${memberTotal}`}
          actions={
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div role="group" aria-label="Zoom" style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', height: 38 }}>
                <button type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out" style={zoomBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
                </button>
                <button type="button" onClick={zoomReset} title="Reset zoom" style={{ minWidth: 56, height: 36, border: 0, borderLeft: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', background: 'transparent', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)', cursor: 'pointer' }}>{Math.round(zoom * 100)}%</button>
                <button type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in" style={zoomBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
                </button>
              </div>
              <SecondaryButton size="md" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="printer" size={14} /> Export PDF
              </SecondaryButton>
              <Button variant="primary" onClick={() => navigate('/governance-groups')}>+ Add group</Button>
            </div>
          }
        />
      </div>

      {loading ? (
        <Card padding={0}><Spinner center label="Loading…" /></Card>
      ) : error ? (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ color: 'var(--color-error)', fontSize: 14, marginBottom: 12 }}>{error}</div>
          <Button variant="primary" onClick={fetchData}>Retry</Button>
        </Card>
      ) : flat.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>No governance structure to visualize.</div>
          <Button variant="primary" onClick={() => navigate('/governance-groups')}>Go to Governance Groups</Button>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          {/* Chart */}
          <main className="gov-viz-container" style={{ flex: '999 1 560px', minWidth: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
            <div className="gov-viz-scroll-area" style={{ overflow: 'auto', padding: '28px 24px 36px' }}>
              <div ref={printFitRef} style={{ minWidth: 640, transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}>
                {LAYERS.map((layer, i) => {
                  const groups = groupsByType(layer.type);
                  return (
                    <div key={layer.type}>
                      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16, alignItems: 'center' }}>
                        <div style={{ textAlign: 'right', paddingRight: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{layer.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{layer.hint}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 16 }}>
                          {groups.length === 0 ? (
                            <div style={{ width: 300, boxSizing: 'border-box', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: 'var(--color-text-muted)', fontSize: 13, background: 'var(--color-bg)' }}>
                              No {layer.label.toLowerCase()} yet
                              <button type="button" onClick={() => navigate('/governance-groups')} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Add</button>
                            </div>
                          ) : groups.map((g) => {
                            const active = g.id === selectedId;
                            const chair = findChair(g.members);
                            return (
                              <button
                                key={g.id}
                                className="gov-viz-card"
                                type="button"
                                onClick={() => setSelectedId(g.id)}
                                aria-pressed={active}
                                style={{ width: 300, textAlign: 'left', cursor: 'pointer', background: 'var(--color-surface)', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}
                              >
                                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  <span style={{ display: 'inline-flex', height: 24, alignItems: 'center', padding: '0 9px', borderRadius: 12, background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>{TYPE_LABEL[g.type] || g.type}</span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: g.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />{g.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                                  </span>
                                </span>
                                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{g.name}</span>
                                {g.description && <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{g.description}</span>}
                                <span style={{ display: 'flex', gap: 14, fontSize: 13, color: 'var(--color-text-muted)', paddingTop: 6, borderTop: '1px solid var(--color-border)' }}>
                                  <span>Chair <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{chair || '—'}</strong></span>
                                  <span>Members <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{g.members.length}</strong></span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {i < LAYERS.length - 1 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16 }}>
                          <span />
                          <div style={{ display: 'flex', justifyContent: 'center' }}><div style={{ width: 2, height: 18, background: 'var(--color-border)' }} /></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </main>

          {/* Selected-group side panel */}
          <aside className="gov-viz-sidepanel" aria-label="Selected group" style={{ flex: '1 1 300px' }}>
            <Card padding={0}>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Selected group</div>
                {selected ? (
                  <>
                    <h2 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 600 }}>{selected.name}</h2>
                    {selected.description && <p style={{ margin: '4px 0 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>{selected.description}</p>}
                    {selected.members.length === 0 ? (
                      <p style={{ margin: '8px 0', fontSize: 13, color: 'var(--color-text-muted)' }}>No members yet.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {selected.members.map((mm) => (
                          <li key={mm.personId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar name={mm.personName || 'Unknown'} size="sm" />
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{mm.personName || 'Unknown'}</span>
                            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{GROUP_ROLE_LABELS[mm.groupRole] || mm.groupRole}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link to={`/governance-groups/${selected.id}`} style={{ display: 'inline-block', marginTop: 14, fontWeight: 600, color: 'var(--color-primary)' }}>Open group &rarr;</Link>
                  </>
                ) : (
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>Click a group in the chart to see its members.</p>
                )}
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Dashed boxes are recommended layers you have not set up. You do not need all six.
                </div>
              </div>
            </Card>
          </aside>
        </div>
      )}

      {/* Print-only footer */}
      <div className="gov-print-footer" style={{ display: 'none', padding: '12px 0', borderTop: '1px solid #cbd5e1', marginTop: 24, fontSize: 10, color: '#94a3b8', textAlign: 'center' }}>
        Generated by Procela | {today}
      </div>
    </div>
  );
}
