import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SectionLabel from '../../components/SectionLabel';
import { LEVEL_CONFIG, statusColors, type ProcessNode } from '../ProcessCatalogPage';

// ── Activity flow board ──────────────────────────────────────────────────────
// The mock-ups' sub-process "activity flow": the sub-process's own activities
// laid out left-to-right as a row of fixed-width step cards, connected by arrow
// gutters. When the responsible role changes from one step to the next, the
// plain connector becomes an orange "Handoff" marker — the point where work
// passes from one party to another, which is where mistakes and delays cluster.
//
// It's a read-only overview derived from the child activities (their order, name,
// responsible role and activity code); authoring still happens on each activity
// record. Rendered only in Detailed view, and only when the sub-process has at
// least one activity beneath it.

const CARD_WIDTH = 200;
const GUTTER_WIDTH = 48;

/** A handoff is a step-to-step change of responsible role (both sides named).
 *  A missing role on either side isn't a handoff — it's just unknown. */
function isHandoff(a: ProcessNode, b: ProcessNode): boolean {
  const ra = (a.responsibleRole || '').trim();
  const rb = (b.responsibleRole || '').trim();
  return ra.length > 0 && rb.length > 0 && ra !== rb;
}

function StepCard({ act, index }: { act: ProcessNode; index: number }) {
  const cfg = LEVEL_CONFIG.ACTIVITY;
  const statusColor = statusColors[act.status]?.color || 'var(--color-text-muted)';
  return (
    <Link
      to={`/processes?node=${act.id}`}
      title={`Open ${act.name}`}
      style={{
        flexShrink: 0, width: CARD_WIDTH, textDecoration: 'none',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
        padding: '10px 12px', color: 'var(--color-text)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          background: cfg.bg, color: cfg.color, fontSize: 9, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '1px 6px', borderRadius: 4,
        }}>{cfg.label}</span>
        <span
          title={act.status}
          style={{ width: 7, height: 7, borderRadius: 999, background: statusColor, flexShrink: 0 }}
        />
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
          Step {index + 1}
        </span>
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: 'var(--color-text)',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{act.name}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {act.responsibleRole
          ? act.responsibleRole
          : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Role unassigned</span>}
      </div>
      {act.activityId && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {act.activityId}
        </div>
      )}
    </Link>
  );
}

function Connector({ handoff, from, to }: { handoff: boolean; from: string; to: string }) {
  if (handoff) {
    return (
      <div
        title={`Handoff — ${from} → ${to}`}
        style={{
          flexShrink: 0, width: GUTTER_WIDTH, alignSelf: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          color: 'var(--color-attention)',
        }}
      >
        <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Handoff</span>
        <ArrowRight size={18} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0, width: GUTTER_WIDTH, alignSelf: 'center', display: 'flex', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
      <ArrowRight size={18} aria-hidden="true" />
    </div>
  );
}

export default function ActivityFlowBoard({ node }: { node: ProcessNode }) {
  // The sub-process's direct activity children, in tree order. Non-activity
  // children (there shouldn't be any under a sub-process) are ignored.
  const activities = (node.children || [])
    .filter((c) => c.level === 'ACTIVITY')
    .sort((a, b) => a.orderIndex - b.orderIndex);
  if (activities.length === 0) return null;

  const handoffCount = activities.reduce(
    (n, a, i) => (i > 0 && isHandoff(activities[i - 1], a) ? n + 1 : n),
    0,
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <SectionLabel>Activity flow</SectionLabel>
        {handoffCount > 0 && (
          <span style={{ fontSize: 10, color: 'var(--color-attention)', fontWeight: 600 }}>
            {handoffCount} handoff{handoffCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {/* Horizontal board — scrolls sideways when the sequence outruns the
          panel, so the page body never does. */}
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 'min-content' }}>
          {activities.map((act, i) => (
            <div key={act.id} style={{ display: 'flex', alignItems: 'stretch' }}>
              {i > 0 && (
                <Connector
                  handoff={isHandoff(activities[i - 1], act)}
                  from={activities[i - 1].responsibleRole || ''}
                  to={act.responsibleRole || ''}
                />
              )}
              <StepCard act={act} index={i} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
        Derived from the activities beneath this sub-process — an orange marker flags where the responsible role changes.
      </div>
    </div>
  );
}
