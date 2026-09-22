import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionHeading from '../components/SectionHeading';
import Meter from '../components/Meter';
import Spinner from '../components/Spinner';
import SecondaryButton from '../components/SecondaryButton';
import { renderNavIcon } from '../components/navIcons';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// Council Dashboard — the meeting-prep landing page for a governance council.
//
// The Council *Scorecard* is the detailed, point-in-time, division-by-division
// grid (with monthly snapshots). This page is the one screen a council opens
// before its meeting: who's on the council, when it next meets, where the
// program's governance health stands right now, whether maturity is trending
// up, and what needs a decision — each stitched from the surface that owns it
// (Groups, Calendar, the Scorecard's derive, Maturity trends) and drilling
// straight back into it. It composes existing endpoints; it stores nothing.
// ──────────────────────────────────────────────────────────────────────────

// ── Types (mirror the endpoints this composes) ──
interface ScoreRow {
  orgId: string; name: string;
  domainsTotal: number; domainsGoverned: number; tier1Total: number;
  coverage: number | null; classification: number | null;
  openIssues: number; exceptions: number; status: string;
}
interface Derived {
  orgId: string; orgName: string; period: string;
  targets: { coverage: number; classification: number; openIssues: number; exceptions: number; openIssuesDays: number };
  divisions: ScoreRow[]; enterprise: ScoreRow;
  narrative: { whatMoved?: string; forCouncil?: string };
}
interface CouncilMember { personName: string | null; agentName: string | null; groupRole: string; since: string }
interface CouncilGroup { id: string; name: string; charter: string; status: string; members: CouncilMember[] }
interface Occurrence { eventId: string; name: string; occursAt: string; daysAway: number; cadence: string; attendeeNames: string[] }
interface MaturitySnapshot { timestamp: string; overall: number; dimensions: { name: string; score: number }[] }

// Role display order (chair first) + friendly labels.
const ROLE_LABEL: Record<string, string> = {
  CHAIR: 'Chair', VICE_CHAIR: 'Vice-chair', SECRETARY: 'Secretary', MEMBER: 'Member', ADVISOR: 'Advisor',
};
const ROLE_ORDER: Record<string, number> = { CHAIR: 0, VICE_CHAIR: 1, SECRETARY: 2, MEMBER: 3, ADVISOR: 4 };

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'on track': return 'var(--color-success)';
    case 'behind': return 'var(--color-warning)';
    case 'at risk': return 'var(--color-error)';
    default: return 'var(--color-text-muted)';
  }
}

function StatusPill({ status }: { status: string }) {
  const c = statusColor(status);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 999, background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{status}
    </span>
  );
}

function pctColor(v: number | null, target: number): string {
  if (v == null) return 'var(--color-border)';
  if (v >= target) return 'var(--color-success)';
  if (v >= target - 20) return 'var(--color-warning)';
  return 'var(--color-error)';
}

// A tiny inline sparkline for the maturity trend (no chart lib). Draws the
// series as a line with an emphasised end point over a faint area fill.
function Sparkline({ points, color, width = 260, height = 48 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', maxWidth: '100%' }} aria-hidden>
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3.2} fill={color} />
    </svg>
  );
}

export default function CouncilDashboardPage() {
  const { activeOrgId } = useOrgContext();
  const [loading, setLoading] = useState(true);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [council, setCouncil] = useState<CouncilGroup | null>(null);
  const [meeting, setMeeting] = useState<Occurrence | null>(null);
  const [maturity, setMaturity] = useState<MaturitySnapshot[]>([]);

  const load = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    setDerived(null); setCouncil(null); setMeeting(null); setMaturity([]);
    const oid = encodeURIComponent(activeOrgId);
    // Each source is independent — a failure in one (e.g. no council group yet)
    // leaves the other panels populated rather than blanking the whole page.
    const [scRes, grpRes, calRes, matRes] = await Promise.allSettled([
      apiClient.get<{ data: Derived }>(`/council-scorecard/derive?orgId=${oid}`),
      apiClient.get<{ data: CouncilGroup[] }>(`/governance-groups?orgId=${oid}`),
      apiClient.get<{ data: Occurrence[] }>(`/governance-calendar/upcoming?orgId=${oid}&days=120`),
      apiClient.get<{ data: MaturitySnapshot[] }>(`/maturity-trends?orgId=${oid}`),
    ]);

    if (scRes.status === 'fulfilled') setDerived(scRes.value.data);

    // The COUNCIL-type governance group, name-enriched via its detail route.
    if (grpRes.status === 'fulfilled') {
      const councilGroup = (grpRes.value.data || []).find((g) => (g as unknown as { type: string }).type === 'COUNCIL');
      if (councilGroup) {
        try {
          const detail = await apiClient.get<{ data: CouncilGroup }>(`/governance-groups/${councilGroup.id}`);
          setCouncil(detail.data);
        } catch { setCouncil(councilGroup); }
      }
    }

    // Soonest upcoming occurrence, preferring a council/committee/governance
    // meeting over an incidental one, else just the next thing on the calendar.
    if (calRes.status === 'fulfilled') {
      const occ = calRes.value.data || [];
      const councilish = occ.find((o) => /council|committee|governance/i.test(o.name));
      setMeeting(councilish || occ[0] || null);
    }

    if (matRes.status === 'fulfilled') setMaturity(matRes.value.data || []);
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (<div><PageHeader title="Council Dashboard" /><Spinner center label="Loading…" /></div>);
  if (!activeOrgId) return (<div><PageHeader title="Council Dashboard" subtitle="Select an organization to view its council briefing." /></div>);

  const ent = derived?.enterprise;
  const targets = derived?.targets;

  const measures: Array<{ label: string; value: number | null; suffix: string; sub: string; to: string; ok: boolean }> = ent && targets ? [
    { label: 'Tier-1 coverage', value: ent.coverage, suffix: '%', sub: `target ${targets.coverage}%`, to: '/data-domains', ok: ent.coverage == null || ent.coverage >= targets.coverage },
    { label: 'Classification', value: ent.classification, suffix: '%', sub: `target ${targets.classification}%`, to: '/data-assets', ok: ent.classification == null || ent.classification >= targets.classification },
    { label: 'Aged open issues', value: ent.openIssues, suffix: '', sub: `>${targets.openIssuesDays}d · target ${targets.openIssues}`, to: '/governance-work?tab=issues', ok: ent.openIssues <= targets.openIssues },
    { label: 'Expired exceptions', value: ent.exceptions, suffix: '', sub: `past expiry · target ${targets.exceptions}`, to: '/governance-exceptions', ok: ent.exceptions <= targets.exceptions },
  ] : [];

  // Escalations for the council — the measures that are off target, framed as
  // decisions to take, each drilling into where it's fixed.
  const escalations = measures.filter((m) => !m.ok && m.value != null && (m.suffix === '%' ? true : m.value > 0));

  const forCouncil = (derived?.narrative?.forCouncil || '').trim();

  const overallNow = maturity.length ? maturity[maturity.length - 1].overall : null;
  const overallFirst = maturity.length ? maturity[0].overall : null;
  const overallDelta = overallNow != null && overallFirst != null ? Math.round((overallNow - overallFirst) * 10) / 10 : null;
  const dims = maturity.length ? maturity[maturity.length - 1].dimensions : [];

  const sortedMembers = council
    ? [...council.members].sort((a, b) => (ROLE_ORDER[a.groupRole] ?? 9) - (ROLE_ORDER[b.groupRole] ?? 9))
    : [];

  return (
    <div>
      <PageHeader
        title="Council Dashboard"
        subtitle={council ? `Meeting brief for the ${council.name}.` : 'Meeting brief for the data governance council.'}
        actions={<Link to="/council-scorecard" style={{ textDecoration: 'none' }}><SecondaryButton>Open full scorecard →</SecondaryButton></Link>}
      />

      {/* Who + when — the council itself and its next meeting. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div>
          <SectionHeading title="The council" as="h3" />
          {council ? (
            <Card padding={18}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{renderNavIcon('/governance-groups', { size: 18 })}</span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{council.name}</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: council.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{council.status}</span>
              </div>
              {council.charter && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: '0 0 14px', borderLeft: '2px solid var(--color-border)', paddingLeft: 10 }}>{council.charter}</p>
              )}
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                Membership ({sortedMembers.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedMembers.map((m, i) => {
                  const name = m.personName || m.agentName || 'Unknown';
                  const isAgent = !!m.agentName;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}{isAgent && <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '0 5px', borderRadius: 3, marginLeft: 6 }}>Agent</span>}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: m.groupRole === 'CHAIR' ? 600 : 500, color: m.groupRole === 'CHAIR' ? 'var(--color-primary)' : 'var(--color-text-muted)', flexShrink: 0 }}>{ROLE_LABEL[m.groupRole] || m.groupRole}</span>
                    </div>
                  );
                })}
                {sortedMembers.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>No members assigned yet.</span>}
              </div>
              <div style={{ marginTop: 14 }}>
                <Link to="/governance-groups" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Manage the council →</Link>
              </div>
            </Card>
          ) : (
            <Card padding={18}>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No governance council is defined for this organization yet. Create one — with a charter and members — to anchor this briefing.
                <div style={{ marginTop: 8 }}><Link to="/governance-groups" style={{ fontSize: 12.5, color: 'var(--color-primary)' }}>Set up governance groups →</Link></div>
              </div>
            </Card>
          )}
        </div>

        <div>
          <SectionHeading title="Next meeting" as="h3" />
          {meeting ? (
            <Card padding={18}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{renderNavIcon('/governance-calendar', { size: 18 })}</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{meeting.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {meeting.daysAway <= 0 ? 'Today' : meeting.daysAway === 1 ? 'Tomorrow' : `${meeting.daysAway} days`}
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {new Date(meeting.occursAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textTransform: 'capitalize', marginBottom: 12 }}>{meeting.cadence.toLowerCase()} cadence</div>
              {meeting.attendeeNames.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    Attendees ({meeting.attendeeNames.length})
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{meeting.attendeeNames.join(', ')}</div>
                </>
              )}
              <div style={{ marginTop: 14 }}>
                <Link to="/governance-calendar" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Open the calendar →</Link>
              </div>
            </Card>
          ) : (
            <Card padding={18}>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No upcoming governance meeting is scheduled in the next 120 days.
                <div style={{ marginTop: 8 }}><Link to="/governance-calendar" style={{ fontSize: 12.5, color: 'var(--color-primary)' }}>Schedule one →</Link></div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Governance health at a glance — the scorecard's enterprise rollup. */}
      {ent && targets && (
        <div style={{ marginBottom: 16 }}>
          <SectionHeading
            title="Governance health"
            as="h3"
            right={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><StatusPill status={ent.status} /><Link to="/council-scorecard" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Full scorecard →</Link></div>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            {measures.map((m) => (
              <Link key={m.label} to={m.to}
                style={{ textDecoration: 'none', color: 'inherit', display: 'flex', borderRadius: 'var(--radius-md)', transition: 'transform .08s ease, box-shadow .08s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                {/* flex:1 so every tile fills the grid row's height — tiles with
                    a progress meter (e.g. Classification) no longer stand taller
                    than the number-only ones. */}
                <Card padding={16} style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {m.label}
                    <span aria-hidden style={{ color: m.ok ? 'var(--color-success)' : 'var(--color-warning)', fontSize: 13 }}>{m.ok ? '✓' : '!'}</span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums', color: m.value == null ? 'var(--color-text-muted)' : m.ok ? 'var(--color-text)' : 'var(--color-warning)' }}>
                    {m.value == null ? '—' : `${m.value}${m.suffix}`}
                  </div>
                  {m.suffix === '%' && m.value != null && (
                    <Meter value={m.value} height={4} color={pctColor(m.value, m.label === 'Tier-1 coverage' ? targets.coverage : targets.classification)} style={{ marginTop: 8 }} />
                  )}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: m.suffix === '%' && m.value != null ? 6 : 4 }}>{m.sub}</div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Maturity trend + escalations — are we improving, and what needs a call. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div>
          <SectionHeading title="Maturity trend" as="h3" />
          <Card padding={18}>
            {overallNow != null ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{overallNow.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>/ 5 overall</span>
                  {overallDelta != null && overallDelta !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: overallDelta > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {overallDelta > 0 ? '▲' : '▼'} {Math.abs(overallDelta).toFixed(1)} since first snapshot
                    </span>
                  )}
                </div>
                {maturity.length >= 2 && <Sparkline points={maturity.map((s) => s.overall)} color="var(--color-primary)" />}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dims.map((d) => (
                    <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 34px', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <Meter value={(d.score / 5) * 100} height={5} />
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                No maturity snapshots recorded yet. Maturity trend builds as assessments are captured over time.
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionHeading title="For the council" as="h3" />
          <Card padding={18}>
            {escalations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: forCouncil ? 14 : 0 }}>
                {escalations.map((m) => (
                  <Link key={m.label} to={m.to} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-warning)', minWidth: 30, fontVariantNumeric: 'tabular-nums' }}>{m.value}{m.suffix}</span>
                    <span style={{ fontSize: 13, flex: 1 }}>{m.label} <span style={{ color: 'var(--color-text-muted)' }}>· {m.sub}</span></span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Review →</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ padding: '6px 0 10px', color: 'var(--color-success)', fontSize: 13, fontWeight: 500 }}>
                ✓ Every measure is on target — nothing to escalate this period.
              </div>
            )}
            {forCouncil && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55, borderTop: escalations.length > 0 ? '1px solid var(--color-border)' : 'none', paddingTop: escalations.length > 0 ? 12 : 0 }}>
                {forCouncil}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <Link to="/gap-detection" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>Review all gaps →</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
