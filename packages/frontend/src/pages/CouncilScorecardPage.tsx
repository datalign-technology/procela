import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';

// ── Types (mirror routes/council-scorecard.ts) ──
interface Row {
  orgId: string;
  name: string;
  domainsTotal: number;
  domainsGoverned: number;
  tier1Total: number;
  coverage: number | null;
  classification: number | null;
  openIssues: number;
  exceptions: number;
  status: string;
}
interface Narrative { whatMoved?: string; forCouncil?: string; whatMovedAuto?: boolean; forCouncilAuto?: boolean }
interface Derived {
  orgId: string; orgName: string; period: string;
  targets: { coverage: number; classification: number };
  divisions: Row[]; enterprise: Row; narrative: Narrative; canEdit?: boolean;
}
interface VersionMeta { id: string; period: string; status: string; createdBy?: string; createdAt: string }
interface SavedVersion { id: string; orgId: string; period: string; status: string; createdBy?: string; createdAt: string; derived: Derived; overrides: Record<string, unknown>; narrative: Narrative }

type Overrides = Record<string, number | string>;

// Each measure links to the page where you act on it — like the dashboard
// tiles and Gap Detection rows, the number is a hyperlink to its source.
const MEASURES: Array<{ key: 'coverage' | 'classification' | 'openIssues' | 'exceptions'; label: string; sub: string; kind: 'pct' | 'count'; href: string; }> = [
  { key: 'coverage',       label: 'Tier-1 coverage', sub: 'target 80%',            kind: 'pct',   href: '/data-domains' },
  { key: 'classification', label: 'Classification',  sub: 'target 70%',            kind: 'pct',   href: '/data-assets' },
  { key: 'openIssues',     label: 'Open issues',     sub: '>30d · target 0',       kind: 'count', href: '/governance-work?tab=issues' },
  { key: 'exceptions',     label: 'Exceptions',      sub: 'past expiry · target 0', kind: 'count', href: '/governance-exceptions' },
];

// Friendly destination names for link tooltips.
const MEASURE_DEST: Record<'coverage' | 'classification' | 'openIssues' | 'exceptions', string> = {
  coverage: 'Data Domains',
  classification: 'Data Assets',
  openIssues: 'Tasks & Issues',
  exceptions: 'Governance Exceptions',
};

// Each narrative section links to where its facts come from: "what moved" is
// drawn from the audit log; "for the council" summarises current gaps.
const NARRATIVE_LINK: Record<'whatMoved' | 'forCouncil', { to: string; label: string }> = {
  whatMoved: { to: '/audit-log', label: 'View recent activity' },
  forCouncil: { to: '/gap-detection', label: 'Review the gaps' },
};

// A hyperlink that inherits the surrounding text/number colour and only
// underlines on hover, so a linked measure reads as a normal value until you
// reach for it (matches the Gap Detection row-link affordance).
function ActionLink({ to, title, style, children }: { to: string; title?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      title={title}
      style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer', ...style }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textDecorationColor = 'var(--color-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
    >
      {children}
    </Link>
  );
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    'on track':  { bg: 'var(--color-success)', color: '#fff' },
    'behind':    { bg: 'var(--color-warning)', color: '#fff' },
    'at risk':   { bg: 'var(--color-error)',   color: '#fff' },
    'no data':   { bg: 'var(--color-text-muted)', color: '#fff' },
  };
  const c = map[s] || { bg: 'var(--color-border)', color: 'var(--color-text)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: `color-mix(in srgb, ${c.bg} 16%, transparent)`, color: c.bg }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.bg }} />{status}
    </span>
  );
}

function pctBarColor(v: number | null, target: number): string {
  if (v == null) return 'var(--color-border)';
  if (v >= target) return 'var(--color-success)';
  if (v >= target - 20) return 'var(--color-warning)';
  return 'var(--color-error)';
}

export default function CouncilScorecardPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [derived, setDerived] = useState<Derived | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [narrative, setNarrative] = useState<Narrative>({});
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);

  const canEdit = !!derived?.canEdit && !viewingVersionId;

  const loadDerived = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: Derived }>(`/council-scorecard/derive?orgId=${activeOrgId}`);
      setDerived(res.data);
      setNarrative(res.data.narrative || {});
      setOverrides({});
      setViewingVersionId(null);
      setEditing(false);
    } catch { addToast('error', 'Failed to load the scorecard.'); }
    finally { setLoading(false); }
  }, [activeOrgId, addToast]);

  // Exit edit mode and discard unsaved edits — revert overrides + narrative to
  // the live derived baseline (live mode has no stored overrides).
  const cancelEdit = () => {
    setOverrides({});
    setNarrative(derived?.narrative || {});
    setEditing(false);
  };

  const loadVersions = useCallback(async () => {
    if (!activeOrgId) return;
    try {
      const res = await apiClient.get<{ success: boolean; data: VersionMeta[] }>(`/council-scorecard?orgId=${activeOrgId}`);
      setVersions(res.data || []);
    } catch { /* */ }
  }, [activeOrgId]);

  useEffect(() => { loadDerived(); loadVersions(); }, [loadDerived, loadVersions]);

  const openVersion = async (id: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: SavedVersion }>(`/council-scorecard/${id}`);
      setDerived({ ...res.data.derived, canEdit: false });
      setOverrides((res.data.overrides || {}) as Overrides);
      setNarrative(res.data.narrative || res.data.derived.narrative || {});
      setViewingVersionId(id);
      setEditing(false);
    } catch { addToast('error', 'Failed to open that version.'); }
  };

  const publish = async () => {
    if (!activeOrgId || !derived) return;
    setSaving(true);
    try {
      await apiClient.post('/council-scorecard', { orgId: activeOrgId, period: derived.period, overrides, narrative });
      addToast('success', `Published the ${derived.period} scorecard.`);
      setEditing(false);
      loadVersions();
    } catch { addToast('error', 'Failed to publish. You may not have permission.'); }
    finally { setSaving(false); }
  };

  const oKey = (orgId: string, key: string) => `${orgId}.${key}`;
  const resolved = (row: Row, key: typeof MEASURES[number]['key']): number | null => {
    const k = oKey(row.orgId, key);
    if (k in overrides) return overrides[k] as number;
    return row[key];
  };
  const resolvedStatus = (row: Row): string => (overrides[oKey(row.orgId, 'status')] as string) ?? row.status;
  const isOverridden = (orgId: string, key: string) => oKey(orgId, key) in overrides;
  const setOverride = (orgId: string, key: string, value: number | string) =>
    setOverrides((p) => ({ ...p, [oKey(orgId, key)]: value }));
  const clearOverride = (orgId: string, key: string) =>
    setOverrides((p) => { const n = { ...p }; delete n[oKey(orgId, key)]; return n; });

  if (loading) return (<div><PageHeader title="Council Scorecard" /><Spinner center label="Loading…" /></div>);
  if (!activeOrgId) return (<div><PageHeader title="Council Scorecard" subtitle="Select an organization to view its scorecard." /></div>);
  if (!derived) return (<div><PageHeader title="Council Scorecard" /><Card>No data available.</Card></div>);

  const rows = [...derived.divisions, { ...derived.enterprise, isEnterprise: true } as Row & { isEnterprise?: boolean }];

  const renderMeasureCell = (row: Row, m: typeof MEASURES[number], isEnt: boolean) => {
    const val = resolved(row, m.key);
    const overridden = isOverridden(row.orgId, m.key);
    if (editing && canEdit) {
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <input
            type="number" aria-label={`${row.name} ${m.label}`}
            value={val == null ? '' : val}
            onChange={(e) => setOverride(row.orgId, m.key, e.target.value === '' ? 0 : Number(e.target.value))}
            style={{ width: 58, textAlign: 'right', border: `1px solid ${overridden ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 4, padding: '3px 6px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
          />
          {overridden && <button type="button" title="Reset to derived" onClick={() => clearOverride(row.orgId, m.key)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13 }}>↺</button>}
        </div>
      );
    }
    const display = val == null ? '—' : `${val}${m.kind === 'pct' ? '%' : ''}`;
    return (
      <ActionLink
        to={m.href}
        title={`Open ${m.label} — ${MEASURE_DEST[m.key]}`}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontVariantNumeric: 'tabular-nums', fontWeight: isEnt ? 600 : 500 }}
      >
        <span style={{ color: overridden ? 'var(--color-primary)' : 'var(--color-text)' }}>
          {display}{overridden && <span title="Overridden" style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-primary)' }}>●</span>}
        </span>
        {m.kind === 'pct' && val != null && (
          <span style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--color-bg)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, val)}%`, background: pctBarColor(val, m.key === 'coverage' ? derived.targets.coverage : derived.targets.classification), borderRadius: 2 }} />
          </span>
        )}
      </ActionLink>
    );
  };

  const ent = derived.enterprise;

  return (
    <div>
      <PageHeader
        title="Council Scorecard"
        subtitle={`${derived.orgName} — ${derived.period}${viewingVersionId ? ' · saved version' : ''}. Four measures per division, rolled up to the enterprise.`}
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {viewingVersionId && <Button variant="secondary" onClick={loadDerived}>Back to live</Button>}
            {canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit &amp; override</Button>}
            {canEdit && editing && <Button variant="secondary" onClick={cancelEdit} disabled={saving}>Cancel</Button>}
            {canEdit && editing && <Button variant="primary" onClick={publish} loading={saving}>Publish snapshot</Button>}
          </div>
        )}
      />

      {/* Enterprise KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {MEASURES.map((m) => {
          const val = resolved(ent, m.key);
          const tgt = m.key === 'coverage' ? derived.targets.coverage : m.key === 'classification' ? derived.targets.classification : 0;
          return (
            <Link
              key={m.key}
              to={m.href}
              title={`Open ${m.label} — ${MEASURE_DEST[m.key]}`}
              style={{ textDecoration: 'none', color: 'inherit', display: 'block', borderRadius: 'var(--radius-md)', transition: 'transform .08s ease, box-shadow .08s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
            >
              <Card padding={16}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {m.label}
                  <span aria-hidden style={{ color: 'var(--color-primary)', fontSize: 13 }}>→</span>
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {val == null ? '—' : `${val}${m.kind === 'pct' ? '%' : ''}`}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {m.kind === 'pct' ? `Target ${tgt}%` : 'Target 0'}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Scorecard table */}
      <Card padding={0} marginBottom={16}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thL}>Division</th>
                <th style={thR}>Domains<div style={thSub}>governed · context</div></th>
                {MEASURES.map((m) => <th key={m.key} style={thR}>{m.label}<div style={thSub}>{m.sub}</div></th>)}
                <th style={thR}>Status<div style={thSub}>derived</div></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEnt = (row as any).isEnterprise;
                return (
                  <tr key={row.orgId} style={isEnt ? { background: 'var(--color-primary-light)', borderTop: '2px solid var(--color-primary)' } : undefined}>
                    <td style={{ ...tdL, fontWeight: isEnt ? 700 : 600, color: isEnt ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      {isEnt && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', padding: '1px 6px', borderRadius: 999, marginRight: 8 }}>▲ Rollup</span>}
                      {row.name}
                    </td>
                    <td style={tdR}><ActionLink to="/data-domains" title="Open Data Domains" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{row.domainsGoverned} of {row.domainsTotal}</ActionLink></td>
                    {MEASURES.map((m) => <td key={m.key} style={tdR}>{renderMeasureCell(row, m, isEnt)}</td>)}
                    <td style={tdR}>
                      {editing && canEdit ? (
                        <select value={resolvedStatus(row)} onChange={(e) => setOverride(row.orgId, 'status', e.target.value)} style={{ border: `1px solid ${isOverridden(row.orgId, 'status') ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 4, padding: '3px 6px', fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                          {['On track', 'Behind', 'At risk', 'No data'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : statusPill(resolvedStatus(row))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Narrative */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        {([['whatMoved', 'What moved this month'], ['forCouncil', 'For the council']] as const).map(([key, label]) => (
          <Card key={key} padding={18}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              {label}
              {narrative[`${key}Auto` as 'whatMovedAuto' | 'forCouncilAuto'] && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 999 }}>AUTO-DERIVED</span>}
            </div>
            {editing && canEdit ? (
              <textarea
                value={narrative[key] || ''}
                onChange={(e) => setNarrative((p) => ({ ...p, [key]: e.target.value, [`${key}Auto`]: false }))}
                rows={4}
                style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, fontSize: 13.5, background: 'var(--color-surface)', color: 'var(--color-text)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            ) : (
              <>
                <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{narrative[key] || '—'}</div>
                <div style={{ marginTop: 12 }}>
                  <ActionLink to={NARRATIVE_LINK[key].to} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-primary)' }}>{NARRATIVE_LINK[key].label} →</ActionLink>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Version history */}
      <Card padding={18}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 12 }}>Saved versions</div>
        {versions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No versions saved yet. {canEdit ? 'Edit and publish a snapshot to keep a monthly record.' : ''}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {versions.map((v) => (
              <button key={v.id} type="button" onClick={() => openVersion(v.id)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px', border: `1px solid ${viewingVersionId === v.id ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 6, background: viewingVersionId === v.id ? 'var(--color-primary-light)' : 'var(--color-surface)', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--color-text)' }}>
                <span style={{ fontWeight: 600 }}>{v.period}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{v.status} · saved {new Date(v.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── table styles ──
const thBase: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '.04em', textTransform: 'uppercase', padding: '10px 12px', borderBottom: '1.5px solid var(--color-border)', verticalAlign: 'bottom' };
const thL: React.CSSProperties = { ...thBase, textAlign: 'left' };
const thR: React.CSSProperties = { ...thBase, textAlign: 'right' };
const thSub: React.CSSProperties = { fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 10, marginTop: 3, color: 'var(--color-text-muted)' };
const tdBase: React.CSSProperties = { padding: '12px', borderBottom: '1px solid var(--color-border)', fontSize: 14 };
const tdL: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdR: React.CSSProperties = { ...tdBase, textAlign: 'right' };
