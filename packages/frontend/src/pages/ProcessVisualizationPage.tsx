import { useEffect, useState, useCallback, useRef, useMemo, createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { processTypeIcon } from '../components/processTypeIcons';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import { Icon } from '../components/IconButton';
import { installPrintFit } from '../lib/printFit';

// ── Types ──

type NodeLevel = 'VALUE_STREAM' | 'DOMAIN' | 'CAPABILITY' | 'PROCESS' | 'SUBPROCESS' | 'ACTIVITY' | 'TASK' | 'EXECUTION';

interface ProcessNode {
  id: string;
  parentId: string | null;
  level: NodeLevel;
  name: string;
  description: string;
  activityId: string | null;
  status: string;
  orderIndex: number;
  orgIds: string[];
  ownerId: string | null;
  // Present on the full catalog response; used by the details rail.
  responsibleRole?: string | null;
  accountableRole?: string | null;
  systemIds?: string[];
  children?: ProcessNode[];
}

interface FlowRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
}

// Minimal shapes for the lookups the details rail resolves against.
interface MappingInfo {
  processStepId: string;
  dataAssetId?: string;
  assetInfo?: { assetName: string } | null;
}

// Selection wiring for the (recursive) node tree — a context avoids drilling
// selectedId / onSelect / the no-data set through every VisualNode level.
interface VizSelection {
  selectedId: string | null;
  onSelect: (id: string) => void;
  noDataActivityIds: Set<string>;
  systemsById: Map<string, string>;
}
const VizContext = createContext<VizSelection>({ selectedId: null, onSelect: () => {}, noDataActivityIds: new Set(), systemsById: new Map() });

// ── Level Visual Config ──

const LEVEL_VISUAL: Record<NodeLevel, { bg: string; border: string; width: number; label: string; icon: ReactNode }> = {
  VALUE_STREAM: { bg: '#d1f0eb', border: '#0f4f46', width: 280, label: 'Value Stream', icon: processTypeIcon('VALUE_STREAM', '#0f4f46') },
  DOMAIN:       { bg: '#ede9fe', border: '#5b21b6', width: 240, label: 'Domain', icon: processTypeIcon('DOMAIN', '#5b21b6') },
  CAPABILITY:   { bg: '#dbeafe', border: '#1e40af', width: 240, label: 'Capability', icon: processTypeIcon('CAPABILITY', '#1e40af') },
  PROCESS:      { bg: '#fef3c7', border: '#92400e', width: 240, label: 'Process', icon: processTypeIcon('PROCESS', '#92400e') },
  SUBPROCESS:   { bg: '#fce7f3', border: '#9d174d', width: 220, label: 'Sub-Process', icon: processTypeIcon('SUBPROCESS', '#9d174d') },
  ACTIVITY:     { bg: '#d1fae5', border: '#065f46', width: 200, label: 'Activity', icon: processTypeIcon('ACTIVITY', '#065f46') },
  TASK:         { bg: '#f1f5f9', border: '#64748b', width: 180, label: 'Task', icon: processTypeIcon('TASK', '#64748b') },
  EXECUTION:    { bg: '#e2e8f0', border: '#475569', width: 180, label: 'System/Execution', icon: processTypeIcon('EXECUTION', '#475569') },
};

// Use the shared status palette — identical colors across every page now.
import { getStatusColor as _getStatusColor } from '@/lib/statusBadge';
const STATUS_COLORS: Record<string, { bg: string; color: string }> = Object.fromEntries(
  ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'].map((s) => [s, _getStatusColor(s)]),
);

const ALL_OPTIONAL_LEVELS: NodeLevel[] = ['DOMAIN', 'CAPABILITY', 'SUBPROCESS', 'TASK', 'EXECUTION'];

// ── Helpers ──

function buildFlowMap(flows: FlowRelationship[]): Map<string, FlowRelationship[]> {
  const map = new Map<string, FlowRelationship[]>();
  for (const flow of flows) {
    const existing = map.get(flow.fromNodeId) || [];
    existing.push(flow);
    map.set(flow.fromNodeId, existing);
  }
  return map;
}

function filterTree(nodes: ProcessNode[], hiddenLevels: Set<NodeLevel>): ProcessNode[] {
  const result: ProcessNode[] = [];
  for (const node of nodes) {
    if (hiddenLevels.has(node.level)) {
      // Skip this node, but include its children promoted up
      const filteredChildren = filterTree(node.children || [], hiddenLevels);
      result.push(...filteredChildren);
    } else {
      const filteredChildren = filterTree(node.children || [], hiddenLevels);
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

// ── Flow chevron (between activities in the left-to-right flow) ──

function FlowChevron() {
  return (
    <span aria-hidden="true" style={{ flex: 'none', width: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </span>
  );
}

// ── Swimlane layout ──
//
// The map reads left-to-right: a value stream is a row of process lanes, each
// lane holds its sub-process boxes and activities, and activities flow with
// numbered steps + chevrons that follow the recorded hand-offs. Replaces the
// old top-down tree — matching the reference board.

const CONTAINER_LEVELS = new Set<NodeLevel>(['VALUE_STREAM', 'DOMAIN', 'CAPABILITY']);

/** Every descendant of `node` at a given level, in document order. */
function collectByLevel(node: ProcessNode, level: NodeLevel): ProcessNode[] {
  const out: ProcessNode[] = [];
  const walk = (nodes: ProcessNode[]) => { for (const n of nodes) { if (n.level === level) out.push(n); if (n.children?.length) walk(n.children); } };
  walk(node.children || []);
  return out;
}

/** Order activities by their recorded hand-offs (flow relationships), falling
 *  back to document order for anything the flows don't connect. */
function orderByFlow(activities: ProcessNode[], flowMap: Map<string, FlowRelationship[]>): ProcessNode[] {
  if (activities.length <= 1) return activities;
  const ids = new Set(activities.map((a) => a.id));
  const hasIncoming = new Set<string>();
  for (const a of activities) for (const f of (flowMap.get(a.id) || [])) if (ids.has(f.toNodeId)) hasIncoming.add(f.toNodeId);
  const starts = activities.filter((a) => !hasIncoming.has(a.id));
  const queue = starts.length ? [...starts] : [...activities];
  const result: ProcessNode[] = []; const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id); result.push(cur);
    for (const f of (flowMap.get(cur.id) || [])) { const t = activities.find((a) => a.id === f.toNodeId); if (t && !seen.has(t.id)) queue.push(t); }
  }
  for (const a of activities) if (!seen.has(a.id)) result.push(a);
  return result;
}

/** A selectable header card that fills its lane (value stream / process /
 *  sub-process). `compact` trims the padding for nested headers. */
function LaneHeader({ node, compact }: { node: ProcessNode; compact?: boolean }) {
  const config = LEVEL_VISUAL[node.level];
  const statusStyle = STATUS_COLORS[node.status] || STATUS_COLORS.DRAFT;
  const { selectedId, onSelect } = useContext(VizContext);
  const selected = selectedId === node.id;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
        background: selected ? 'var(--color-primary-light)' : 'var(--color-surface)',
        border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderLeft: `3px solid ${config.border}`,
        borderRadius: 8, padding: compact ? '8px 10px' : '12px 14px',
        boxShadow: selected ? '0 0 0 1px var(--color-primary)' : 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${config.border}18`, color: config.border }}>{config.icon} {config.label}</span>
        {node.activityId && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)' }}>{node.activityId}</span>}
        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, marginLeft: 'auto', background: statusStyle.bg, color: statusStyle.color }}>{node.status}</span>
      </span>
      <span style={{ display: 'block', fontWeight: 600, fontSize: node.level === 'VALUE_STREAM' ? 15 : 14, marginTop: 5, color: 'var(--color-text)' }}>{node.name}</span>
      {node.description && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{node.description}</span>}
    </button>
  );
}

/** A numbered activity card in the left-to-right flow. */
function ActivityChip({ node, seq }: { node: ProcessNode; seq?: number }) {
  const { selectedId, onSelect, noDataActivityIds, systemsById } = useContext(VizContext);
  const selected = selectedId === node.id;
  const noData = noDataActivityIds.has(node.id);
  const systems = (node.systemIds || []).map((id) => systemsById.get(id) || id).filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className="viz-card"
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
        padding: '10px 12px', borderRadius: 8,
        background: selected ? 'var(--color-primary-light)' : 'var(--color-surface)',
        border: `1px solid ${selected ? 'var(--color-primary)' : (noData ? '#e7b48a' : 'var(--color-border)')}`,
        boxShadow: selected ? '0 0 0 1px var(--color-primary)' : '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 22, height: 22, borderRadius: 11, background: 'var(--color-text)', color: 'var(--color-surface)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{seq ?? ''}</span>
        {node.activityId && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.activityId}</span>}
      </span>
      <span style={{ display: 'block', fontWeight: 600, fontSize: 14, marginTop: 6, color: 'var(--color-text)' }}>{node.name}</span>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Systems: {systems.length ? systems.join(', ') : '—'}</span>
      {noData && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, padding: '2px 8px', borderRadius: 11, background: '#fbe9d9', color: '#9a4a0e', fontSize: 11, fontWeight: 600 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#9a4a0e' }} />No data linked
        </span>
      )}
    </button>
  );
}

/** A horizontal run of activities with numbered steps + chevrons between. */
function ActivityFlow({ activities, seqMap, flowMap }: { activities: ProcessNode[]; seqMap: Map<string, number>; flowMap: Map<string, FlowRelationship[]> }) {
  const ordered = useMemo(() => orderByFlow(activities, flowMap), [activities, flowMap]);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', gap: 6 }}>
      {ordered.map((a, i) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 140px', minWidth: 132 }}>
          {i > 0 && <FlowChevron />}
          <div style={{ flex: 1, minWidth: 0 }}><ActivityChip node={a} seq={seqMap.get(a.id)} /></div>
        </div>
      ))}
    </div>
  );
}

/** Render a node's children inside a lane: contiguous activities become one
 *  flow, sub-processes become dashed boxes, anything else a plain card. */
function LaneBody({ node, seqMap, flowMap }: { node: ProcessNode; seqMap: Map<string, number>; flowMap: Map<string, FlowRelationship[]> }) {
  const segments: ReactNode[] = [];
  let run: ProcessNode[] = [];
  const flush = (key: string) => { if (run.length) { segments.push(<ActivityFlow key={key} activities={run} seqMap={seqMap} flowMap={flowMap} />); run = []; } };
  (node.children || []).forEach((c, i) => {
    if (c.level === 'ACTIVITY') { run.push(c); return; }
    flush(`acts-${i}`);
    if (c.level === 'SUBPROCESS') segments.push(<SubProcessBox key={c.id} node={c} seqMap={seqMap} flowMap={flowMap} />);
    else segments.push(<div key={c.id} style={{ alignSelf: 'flex-start' }}><VisualCard node={c} /></div>);
  });
  flush('acts-end');
  return <>{segments}</>;
}

/** A sub-process: a dashed box grouping its activities. */
function SubProcessBox({ node, seqMap, flowMap }: { node: ProcessNode; seqMap: Map<string, number>; flowMap: Map<string, FlowRelationship[]> }) {
  return (
    <div style={{ border: '1px dashed var(--color-border)', borderRadius: 10, padding: 10, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LaneHeader node={node} compact />
      <LaneBody node={node} seqMap={seqMap} flowMap={flowMap} />
    </div>
  );
}

/** A process: one lane column. */
function ProcessLane({ node, seqMap, flowMap }: { node: ProcessNode; seqMap: Map<string, number>; flowMap: Map<string, FlowRelationship[]> }) {
  return (
    <section aria-label={node.name} style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-bg)', padding: 12 }}>
      <LaneHeader node={node} />
      <LaneBody node={node} seqMap={seqMap} flowMap={flowMap} />
    </section>
  );
}

/** A value-stream-level container (the VS itself, or a Domain / Capability
 *  grouping between it and its processes): a labelled header over a wrapping
 *  row of lanes. */
function ContainerGroup({ node, seqMap, flowMap }: { node: ProcessNode; seqMap: Map<string, number>; flowMap: Map<string, FlowRelationship[]> }) {
  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LaneHeader node={node} compact />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>{renderLanes(node.children || [], seqMap, flowMap)}</div>
    </div>
  );
}

/** Lay out a value stream's (or container's) children as lanes: processes
 *  become columns, nested containers recurse, stray activities form a flow. */
function renderLanes(nodes: ProcessNode[], seqMap: Map<string, number>, flowMap: Map<string, FlowRelationship[]>): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ProcessNode[] = [];
  const flush = (key: string) => { if (run.length) { out.push(<div key={key} style={{ flexBasis: '100%' }}><ActivityFlow activities={run} seqMap={seqMap} flowMap={flowMap} /></div>); run = []; } };
  nodes.forEach((n, i) => {
    if (n.level === 'ACTIVITY') { run.push(n); return; }
    flush(`acts-${i}`);
    if (n.level === 'PROCESS') out.push(<ProcessLane key={n.id} node={n} seqMap={seqMap} flowMap={flowMap} />);
    else if (n.level === 'SUBPROCESS') out.push(<div key={n.id} style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 560 }}><SubProcessBox node={n} seqMap={seqMap} flowMap={flowMap} /></div>);
    else if (CONTAINER_LEVELS.has(n.level)) out.push(<ContainerGroup key={n.id} node={n} seqMap={seqMap} flowMap={flowMap} />);
    else out.push(<div key={n.id} style={{ alignSelf: 'flex-start' }}><VisualCard node={n} /></div>);
  });
  flush('acts-end');
  return out;
}

/** A whole value stream rendered as a swimlane. */
function ValueStreamSwimlane({ vs, flowMap }: { vs: ProcessNode; flowMap: Map<string, FlowRelationship[]> }) {
  const activities = useMemo(() => collectByLevel(vs, 'ACTIVITY'), [vs]);
  const seqMap = useMemo(() => {
    const m = new Map<string, number>();
    orderByFlow(activities, flowMap).forEach((a, i) => m.set(a.id, i + 1));
    return m;
  }, [activities, flowMap]);
  const nProc = useMemo(() => collectByLevel(vs, 'PROCESS').length, [vs]);
  const nSub = useMemo(() => collectByLevel(vs, 'SUBPROCESS').length, [vs]);
  return (
    <section aria-label={vs.name} style={{ width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
      <div style={{ padding: '14px 16px 12px' }}>
        <LaneHeader node={vs} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 16px', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', fontSize: 13, color: 'var(--color-text-secondary)' }}>
        <span>Processes run left to right. Numbers show the activity sequence across the whole value stream.</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>Processes {nProc} · Sub-processes {nSub} · Activities {activities.length}</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {renderLanes(vs.children || [], seqMap, flowMap)}
      </div>
    </section>
  );
}

// ── Visual Card ──

function VisualCard({ node }: { node: ProcessNode }) {
  const config = LEVEL_VISUAL[node.level];
  const statusStyle = STATUS_COLORS[node.status] || STATUS_COLORS.DRAFT;
  const { selectedId, onSelect, noDataActivityIds } = useContext(VizContext);
  const selected = selectedId === node.id;
  const noData = node.level === 'ACTIVITY' && noDataActivityIds.has(node.id);

  return (
    <button
      type="button"
      className="viz-card"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      style={{
        width: config.width,
        background: config.bg,
        borderLeft: `3px solid ${config.border}`,
        border: selected ? '1px solid var(--color-primary)' : '1px solid transparent',
        borderLeftWidth: 3,
        borderLeftColor: selected ? 'var(--color-primary)' : config.border,
        borderRadius: 6,
        padding: 12,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        boxShadow: selected ? '0 0 0 2px var(--color-primary)' : '0 1px 3px rgba(0,0,0,0.1)',
        flexShrink: 0,
      }}
    >
      {/* Level badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 6,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 7px', borderRadius: 4,
          fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
          background: `${config.border}18`, color: config.border,
        }}>
          {config.icon} {config.label}
        </span>
        {node.activityId && (
          <span style={{
            fontSize: 9, color: config.border,
            fontFamily: 'monospace', whiteSpace: 'nowrap',
            background: '#fff', padding: '1px 4px', borderRadius: 3,
            border: '1px solid #e2e8f0',
          }}>
            {node.activityId}
          </span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px',
          borderRadius: 3, marginLeft: 'auto',
          background: statusStyle.bg, color: statusStyle.color,
        }}>
          {node.status}
        </span>
      </div>

      {/* Name */}
      <div style={{
        fontSize: node.level === 'VALUE_STREAM' ? 15 : 13,
        fontWeight: 600, color: '#1e293b',
        lineHeight: 1.3,
      }}>
        {node.name}
      </div>

      {/* Description */}
      {node.description && (
        <div style={{
          fontSize: 11, color: '#64748b',
          marginTop: 4, lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {node.description}
        </div>
      )}

      {/* No-data flag — an activity with no linked data asset reads straight
          off the map, matching the reference board. */}
      {noData && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8,
          padding: '2px 8px', borderRadius: 11, fontSize: 10, fontWeight: 600,
          background: '#fbe9d9', color: '#9a4a0e',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#9a4a0e' }} />
          No data linked
        </span>
      )}
    </button>
  );
}

// ── Print Styles ──

const PRINT_STYLE_ID = 'procela-viz-print-styles';

function ensurePrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      /* Hide shell chrome */
      nav, header, aside,
      .sidebar, [class*="sidebar"], [class*="Sidebar"],
      [class*="header"], [class*="Header"],
      [class*="chatPanel"], [class*="ChatPanel"],
      [class*="sessionTimeout"], [class*="toast"],
      [class*="shell"] > aside {
        display: none !important;
      }

      /* Reset layout so content is full-width */
      [class*="shell"] {
        display: block !important;
      }
      [class*="main"] {
        display: block !important;
      }
      [class*="content"] {
        padding: 0 !important;
        overflow: visible !important;
      }

      /* Hide controls bar */
      .viz-controls {
        display: none !important;
      }

      /* Show print header/footer */
      .print-header {
        display: block !important;
      }
      .print-footer {
        display: block !important;
      }

      /* Make diagram fill page */
      .viz-container {
        transform: none !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }

      .viz-scroll-area {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
        padding: 0 !important;
      }

      /* Scale the diagram down to fit the page width (set by installPrintFit)
         so a wide tree isn't clipped at the edge — a PDF can't scroll. */
      [data-print-fit] {
        transform: scale(var(--print-fit)) !important;
        transform-origin: top left !important;
      }

      /* White background for print */
      body, .viz-container, .viz-scroll-area {
        background: white !important;
      }

      /* Ensure cards print properly */
      .viz-card {
        break-inside: avoid;
        box-shadow: none !important;
        border: 1px solid #e2e8f0 !important;
      }

      @page {
        margin: 0.5in;
        size: landscape;
      }
    }
  `;
  document.head.appendChild(style);
}

// ── Details rail (selected node) ──

function RailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd style={{ margin: 0, color: 'var(--color-text)' }}>{children}</dd>
    </>
  );
}

function DetailsRail({ node, peopleById, systemsById, dataByNode, onOpen, onMapData }: {
  node: ProcessNode | null;
  peopleById: Map<string, string>;
  systemsById: Map<string, string>;
  dataByNode: Map<string, string[]>;
  onOpen: (id: string) => void;
  onMapData: () => void;
}) {
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md, 10px)', padding: 18,
  };
  const muted = (t: string) => <span style={{ color: 'var(--color-text-muted)' }}>{t}</span>;

  let body: ReactNode;
  if (!node) {
    body = (
      <section style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Select a step in the map to see who owns it, the systems it runs on, and the data it uses.
        </div>
      </section>
    );
  } else {
    const isActivity = node.level === 'ACTIVITY';
    const owner = (node.ownerId && peopleById.get(node.ownerId)) || null;
    const role = node.responsibleRole || node.accountableRole || null;
    const systemNames = (node.systemIds || []).map((id) => systemsById.get(id) || id).filter(Boolean);
    const dataNames = dataByNode.get(node.id) || [];
    const noData = isActivity && dataNames.length === 0;

    body = (
      <section style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          {LEVEL_VISUAL[node.level].label}
        </div>
        <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600, lineHeight: 1.3, color: 'var(--color-text)' }}>{node.name}</h2>
        {node.description && (
          <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.5 }}>{node.description}</p>
        )}
        <dl style={{ margin: '14px 0 0', display: 'grid', gridTemplateColumns: '96px 1fr', gap: '10px 12px', fontSize: 13 }}>
          <RailField label="ID"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{node.activityId || node.id}</span></RailField>
          <RailField label="Owner">{owner || muted('Unassigned')}</RailField>
          <RailField label="Role">{role || (isActivity ? muted('—') : muted('Set on activities'))}</RailField>
          <RailField label="Systems">{systemNames.length ? systemNames.join(', ') : (isActivity ? muted('—') : muted('See activities'))}</RailField>
          <RailField label="Data used">{dataNames.length ? dataNames.join(', ') : (isActivity ? muted('None linked yet') : muted('See activities'))}</RailField>
        </dl>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onOpen(node.id)}
            style={{ height: 36, padding: '0 14px', border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Open in catalog
          </button>
          {noData && (
            <button
              type="button"
              onClick={onMapData}
              style={{ height: 36, padding: '0 14px', border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-primary)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Map data
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <aside aria-label="Selected step" style={{ flex: '1 1 300px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {body}
      <section style={{ ...cardStyle, padding: '16px 18px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>Reading the map</h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Each box is a node in the hierarchy; arrows follow the recorded hand-offs between activities. Click any node to see its details here. An amber <strong>No data linked</strong> flag marks an activity with no data asset mapped yet.
        </p>
      </section>
    </aside>
  );
}

// ── Main Page ──

export default function ProcessVisualizationPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [peopleById, setPeopleById] = useState<Map<string, string>>(new Map());
  const [systemsById, setSystemsById] = useState<Map<string, string>>(new Map());
  const [dataByNode, setDataByNode] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hiddenLevels, setHiddenLevels] = useState<Set<NodeLevel>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const printFitRef = useRef<HTMLDivElement>(null);

  // Inject print styles on mount + scale the diagram to fit the page on print
  // (a wide tree would otherwise clip at the page edge in a PDF).
  useEffect(() => {
    ensurePrintStyles();
    return installPrintFit(() => printFitRef.current);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      // People / systems / mappings power the details rail's Owner / Systems /
      // Data-used fields. They're best-effort — the map still renders without
      // them (the rail just shows placeholders).
      const [catalogRes, flowsRes, peopleRes, systemsRes, mappingsRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>(`/process-catalog${qp}`),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string }> }>('/people').catch(() => ({ data: [] as Array<{ id: string; name: string }> })),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string }> }>('/systems').catch(() => ({ data: [] as Array<{ id: string; name: string }> })),
        apiClient.get<{ success: boolean; data: MappingInfo[] }>(`/mappings${qp}`).catch(() => ({ data: [] as MappingInfo[] })),
      ]);
      setTree(catalogRes.tree || []);
      setFlows(flowsRes.data || []);
      setPeopleById(new Map((peopleRes.data || []).map((p) => [p.id, p.name])));
      setSystemsById(new Map((systemsRes.data || []).map((s) => [s.id, s.name])));
      const byNode = new Map<string, string[]>();
      for (const m of (mappingsRes.data || [])) {
        if (!m.dataAssetId) continue;
        const name = m.assetInfo?.assetName || 'Linked asset';
        byNode.set(m.processStepId, [...(byNode.get(m.processStepId) || []), name]);
      }
      setDataByNode(byNode);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load process data'));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const flowMap = useMemo(() => buildFlowMap(flows), [flows]);

  const filteredTree = useMemo(() => {
    if (hiddenLevels.size === 0) return tree;
    return filterTree(tree, hiddenLevels);
  }, [tree, hiddenLevels]);

  // Flatten the full (unfiltered) tree for selection lookups + the no-data set.
  const nodeById = useMemo(() => {
    const map = new Map<string, ProcessNode>();
    const walk = (nodes: ProcessNode[]) => { for (const n of nodes) { map.set(n.id, n); if (n.children?.length) walk(n.children); } };
    walk(tree);
    return map;
  }, [tree]);

  const noDataActivityIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodeById.values()) {
      if (n.level === 'ACTIVITY' && !(dataByNode.get(n.id)?.length)) s.add(n.id);
    }
    return s;
  }, [nodeById, dataByNode]);

  // Default the rail to the first root once data loads, so it isn't empty; and
  // drop a selection that filtering has hidden from the map.
  useEffect(() => {
    if (tree.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => (cur && nodeById.has(cur) ? cur : tree[0].id));
  }, [tree, nodeById]);

  const selectedNode = selectedId ? nodeById.get(selectedId) || null : null;

  const toggleLevel = (level: NodeLevel) => {
    setHiddenLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.15, 2));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.15, 0.3));
  const handleZoomReset = () => setZoom(1);

  const handlePrint = () => {
    window.print();
  };

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <Page>
      {/* Print header - hidden on screen, shown on print */}
      <div className="print-header" style={{
        display: 'none',
        padding: '16px 0',
        borderBottom: '2px solid #0f4f46',
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>
          Procela — Process Hierarchy
        </div>
        {activeOrgName && (
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
            Organization: {activeOrgName}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
          Exported: {today}
        </div>
      </div>

      <PageHeader
        kicker={activeOrgName ? `Process catalog \u00b7 ${activeOrgName}` : 'Process catalog'}
        title="Process map"
        subtitle="A visual map of your value streams, processes, sub-processes, and activities — and how they fit together."
        actions={
          <>
            <button
              onClick={() => navigate('/processes')}
              style={{
                padding: '8px 16px', background: 'var(--color-surface)',
                color: 'var(--color-text)', border: '1px solid var(--color-border)',
                borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {'\u2190'} Back to Process Catalog
            </button>
            <button
              onClick={handlePrint}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none',
                borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Icon name="printer" size={14} /> Export PDF
            </button>
          </>
        }
      />

      {/* Controls toolbar */}
      <div className="viz-controls" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        {/* Zoom controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          marginLeft: 8,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '2px 4px',
        }}>
          <button
            onClick={handleZoomOut}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, color: 'var(--color-text)',
              padding: '4px 8px', borderRadius: 4,
            }}
            title="Zoom out"
          >
            -
          </button>
          <span style={{
            fontSize: 12, color: 'var(--color-text-secondary)',
            minWidth: 42, textAlign: 'center',
          }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, color: 'var(--color-text)',
              padding: '4px 8px', borderRadius: 4,
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={handleZoomReset}
            style={{
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 10, color: 'var(--color-text-muted)',
              padding: '3px 6px',
            }}
            title="Reset zoom"
          >
            Reset
          </button>
        </div>

        {/* Level filters */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginLeft: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
            Show:
          </span>
          {ALL_OPTIONAL_LEVELS.map(level => {
            const config = LEVEL_VISUAL[level];
            const isHidden = hiddenLevels.has(level);
            return (
              <label
                key={level}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, cursor: 'pointer',
                  padding: '2px 6px', borderRadius: 4,
                  background: isHidden ? '#f1f5f9' : config.bg,
                  color: isHidden ? '#94a3b8' : config.border,
                  border: `1px solid ${isHidden ? '#e2e8f0' : config.border + '44'}`,
                  opacity: isHidden ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggleLevel(level)}
                  style={{ width: 12, height: 12, margin: 0 }}
                />
                {config.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Color legend */}
      <div className="viz-controls" style={{
        display: 'flex', gap: 6, marginBottom: 16,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          Legend:
        </span>
        {(Object.entries(LEVEL_VISUAL) as [NodeLevel, typeof LEVEL_VISUAL[NodeLevel]][]).map(([level, config]) => (
          <div
            key={level}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4,
              background: config.bg, color: config.border,
              fontSize: 10, fontWeight: 500,
              borderLeft: `3px solid ${config.border}`,
              opacity: hiddenLevels.has(level) ? 0.35 : 1,
            }}
          >
            {config.icon} {config.label}
          </div>
        ))}
      </div>

      {/* Map + details rail */}
      <VizContext.Provider value={{ selectedId, onSelect: setSelectedId, noDataActivityIds, systemsById }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      {/* Visualization container */}
      <div
        className="viz-container"
        ref={containerRef}
        style={{
          flex: '999 1 560px',
          minWidth: 0,
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md, 8px)',
          border: '1px solid var(--color-border, #e2e8f0)',
          minHeight: 400,
          position: 'relative',
          overflow: 'auto',
        }}
      >
        {loading ? (
          <Spinner center label="Loading…" />
        ) : error ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem', gap: 12,
          }}>
            <div style={{ color: 'var(--color-error, #dc2626)', fontSize: 14 }}>
              {error}
            </div>
            <button
              onClick={fetchData}
              style={{
                padding: '6px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : filteredTree.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem', gap: 12,
          }}>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              No process hierarchy to visualize.
            </div>
            <button
              onClick={() => navigate('/processes')}
              style={{
                padding: '8px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Go to Process Catalog
            </button>
          </div>
        ) : (
          <div
            className="viz-scroll-area"
            style={{
              overflow: 'auto', padding: 24,
            }}
          >
            <div ref={printFitRef} style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: 'transform 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 32,
              width: '100%',
            }}>
              {filteredTree.map(rootNode => (
                <ValueStreamSwimlane key={rootNode.id} vs={rootNode} flowMap={flowMap} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Details rail — the picked node's record + a "reading the map" aid.
          It's an <aside>, so the print stylesheet hides it automatically. */}
      <DetailsRail
        node={selectedNode}
        peopleById={peopleById}
        systemsById={systemsById}
        dataByNode={dataByNode}
        onOpen={(id) => navigate(`/processes?node=${id}`)}
        onMapData={() => navigate('/process-data-map')}
      />
      </div>
      </VizContext.Provider>

      {/* Print footer - hidden on screen, shown on print */}
      <div className="print-footer" style={{
        display: 'none',
        padding: '12px 0',
        borderTop: '1px solid #cbd5e1',
        marginTop: 24,
        fontSize: 10, color: '#94a3b8',
        textAlign: 'center',
      }}>
        Generated by Procela | {today}
      </div>
    </Page>
  );
}
