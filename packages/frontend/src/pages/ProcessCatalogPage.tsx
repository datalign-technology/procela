import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

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
  children?: ProcessNode[];
}

interface FlowRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
}

// ── Level Configuration ──

const LEVEL_CONFIG: Record<NodeLevel, { color: string; bg: string; label: string; required: boolean; icon: string; hint: string }> = {
  VALUE_STREAM: { color: '#0f4f46', bg: '#d1f0eb', label: 'Value Stream', required: true, icon: '\u2B95', hint: 'End-to-end flow delivering value to a customer or stakeholder' },
  DOMAIN:       { color: '#5b21b6', bg: '#ede9fe', label: 'Domain', required: false, icon: '\u25CE', hint: 'A business domain grouping related capabilities' },
  CAPABILITY:   { color: '#1e40af', bg: '#dbeafe', label: 'Capability', required: false, icon: '\u2B50', hint: 'A business capability that the organization performs' },
  PROCESS:      { color: '#92400e', bg: '#fef3c7', label: 'Process', required: true, icon: '\u2699', hint: 'A defined set of activities achieving a specific outcome' },
  SUBPROCESS:   { color: '#9d174d', bg: '#fce7f3', label: 'Sub-Process', required: false, icon: '\u21B3', hint: 'A grouping of related activities within a process' },
  ACTIVITY:     { color: '#065f46', bg: '#d1fae5', label: 'Activity', required: true, icon: '\u25B6', hint: 'A specific unit of work with inputs and outputs' },
  TASK:         { color: '#64748b', bg: '#f1f5f9', label: 'Task', required: false, icon: '\u2022', hint: 'A detailed task within an activity' },
  EXECUTION:    { color: '#475569', bg: '#e2e8f0', label: 'System/Execution', required: false, icon: '\u2318', hint: 'System or automation that executes a task' },
};

const STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'];
const statusColors: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: '#f1f5f9', color: '#64748b' },
  ACTIVE: { bg: '#d1f0eb', color: '#0f4f46' },
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED: { bg: '#fce7f3', color: '#9d174d' },
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '4px 8px', fontSize: 13, background: 'var(--color-surface)',
};

const btnIcon: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '2px 6px', fontSize: 12, color: 'var(--color-text-muted)', borderRadius: 4,
};

const btnAdd: React.CSSProperties = {
  background: 'none', border: '1px dashed var(--color-border)',
  borderRadius: 4, padding: '3px 8px', fontSize: 11,
  color: 'var(--color-primary)', cursor: 'pointer',
};

// ── Helpers ──

function countByLevel(node: ProcessNode, level: NodeLevel): number {
  let count = node.level === level ? 1 : 0;
  for (const child of node.children || []) count += countByLevel(child, level);
  return count;
}

function hasRequiredPath(node: ProcessNode): { complete: boolean; missing: string[]; hasProcess: boolean; hasActivity: boolean } {
  if (node.level !== 'VALUE_STREAM') return { complete: true, missing: [], hasProcess: true, hasActivity: true };
  const missing: string[] = [];
  const hasProcess = countByLevel(node, 'PROCESS') > 0;
  const hasActivity = countByLevel(node, 'ACTIVITY') > 0;
  if (!hasProcess) missing.push('Process');
  if (!hasActivity) missing.push('Activity');
  return { complete: missing.length === 0, missing, hasProcess, hasActivity };
}

function getRequiredNextLevel(node: ProcessNode): NodeLevel | null {
  if (node.level === 'VALUE_STREAM' && countByLevel(node, 'PROCESS') === 0) return 'PROCESS';
  if (node.level === 'PROCESS' && countByLevel(node, 'ACTIVITY') === 0) return 'ACTIVITY';
  if (node.level === 'VALUE_STREAM' && countByLevel(node, 'ACTIVITY') === 0) return null; // need to go deeper
  return null;
}

function collectIssues(tree: ProcessNode[]): Array<{ nodeId: string; nodeName: string; level: NodeLevel; issue: string }> {
  const issues: Array<{ nodeId: string; nodeName: string; level: NodeLevel; issue: string }> = [];
  function walk(nodes: ProcessNode[]) {
    for (const node of nodes) {
      if (node.level === 'VALUE_STREAM') {
        const cp = hasRequiredPath(node);
        if (!cp.hasProcess) issues.push({ nodeId: node.id, nodeName: node.name, level: node.level, issue: 'Missing Process' });
        else if (!cp.hasActivity) issues.push({ nodeId: node.id, nodeName: node.name, level: node.level, issue: 'Missing Activity' });
      }
      if (node.level === 'PROCESS' && countByLevel(node, 'ACTIVITY') === 0) {
        issues.push({ nodeId: node.id, nodeName: node.name, level: node.level, issue: 'Missing Activity' });
      }
      if (node.children) walk(node.children);
    }
  }
  walk(tree);
  return issues;
}

function findNodeInTree(nodes: ProcessNode[], id: string): ProcessNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// ── Inline Edit ──

function InlineEdit({ value, onSave, fontSize = 13, fontWeight = 400, placeholder = 'Click to edit...' }: {
  value: string; onSave: (v: string) => void; fontSize?: number; fontWeight?: number; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <span onClick={() => { setDraft(value); setEditing(true); }} style={{ cursor: 'pointer', fontSize, fontWeight }} title="Click to edit">
        {value || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{placeholder}</span>}
      </span>
    );
  }
  return (
    <input autoFocus style={{ ...inputStyle, fontSize, fontWeight, width: '100%' }} value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

// ── Add Node Form ──

function AddNodeForm({ validChildren, onAdd, onCancel }: {
  validChildren: NodeLevel[];
  onAdd: (name: string, description: string, level: NodeLevel) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<NodeLevel>(validChildren[0]);
  const config = LEVEL_CONFIG[level];

  return (
    <div style={{ background: config.bg, border: `1px solid ${config.color}33`, borderRadius: 6, padding: 12, margin: '6px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        {validChildren.length > 1 ? (
          <select style={{ ...inputStyle, width: 'auto', fontWeight: 500 }} value={level} onChange={(e) => setLevel(e.target.value as NodeLevel)}>
            {validChildren.map((l) => (
              <option key={l} value={l}>
                {LEVEL_CONFIG[l].icon} {LEVEL_CONFIG[l].label}{LEVEL_CONFIG[l].required ? ' *' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: config.color }}>
            {config.icon} New {config.label}
          </span>
        )}
        <input autoFocus style={{ ...inputStyle, flex: 1 }} placeholder={`${config.label} name...`} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onAdd(name.trim(), description.trim(), level); if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <div style={{ fontSize: 11, color: config.color, marginBottom: 6, opacity: 0.8 }}>
        {config.hint}
      </div>
      <input style={{ ...inputStyle, width: '100%', marginBottom: 8 }} placeholder="Description (optional)" value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onAdd(name.trim(), description.trim(), level); if (e.key === 'Escape') onCancel(); }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ ...btnAdd, background: config.color, color: '#fff', border: 'none', padding: '4px 12px' }}
          onClick={() => { if (name.trim()) onAdd(name.trim(), description.trim(), level); }} disabled={!name.trim()}>
          Add {config.label}
        </button>
        <button style={{ ...btnAdd, padding: '4px 12px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Tree Node ──

function TreeNode({ node, depth, onUpdate, onDelete, onAddChild, expanded, toggleExpand, validChildrenMap, flows }: {
  node: ProcessNode; depth: number;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void;
  validChildrenMap: Record<string, string[]>;
  flows: FlowRelationship[];
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = (node.children || []).length > 0;
  const config = LEVEL_CONFIG[node.level];
  const validChildren = (validChildrenMap[node.level] || []) as NodeLevel[];
  const canAddChildren = validChildren.length > 0;

  // Completeness check for value streams
  const completeness = node.level === 'VALUE_STREAM' ? hasRequiredPath(node) : null;

  // Missing required children — what's needed next
  const requiredNext = getRequiredNextLevel(node);
  let warning: string | null = null;
  let guidedLevel: NodeLevel | null = null;
  if (node.level === 'VALUE_STREAM' && countByLevel(node, 'PROCESS') === 0) {
    warning = 'Next step: Add a Process';
    guidedLevel = 'PROCESS';
  } else if (node.level === 'PROCESS' && countByLevel(node, 'ACTIVITY') === 0) {
    warning = 'Next step: Add Activities';
    guidedLevel = 'ACTIVITY';
  } else if (node.level === 'VALUE_STREAM' && countByLevel(node, 'ACTIVITY') === 0) {
    warning = 'Processes need Activities';
  }

  // Can this node be set to ACTIVE?
  const canBeActive = (() => {
    if (node.level === 'VALUE_STREAM') return completeness?.complete ?? false;
    if (node.level === 'PROCESS') return countByLevel(node, 'ACTIVITY') > 0;
    return true;
  })();

  // Flow indicators for activities
  const outgoingFlows = flows.filter((f) => f.fromNodeId === node.id);
  const incomingFlows = flows.filter((f) => f.toNodeId === node.id);

  // Connecting line style
  const isLeafLevel = validChildren.length === 0;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        padding: '7px 12px', paddingLeft: 12 + depth * 22,
        borderBottom: '1px solid var(--color-border)',
        background: completeness && !completeness.complete ? '#fffbeb' : undefined,
        transition: 'background 0.1s',
      }}
        onMouseEnter={(e) => { if (!completeness || completeness.complete) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = completeness && !completeness.complete ? '#fffbeb' : ''; }}
      >
        {/* Connecting line + expand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0, paddingTop: 3 }}>
          {depth > 0 && (
            <div style={{ width: 1, height: 4, background: 'var(--color-border)' }} />
          )}
          <span onClick={() => (hasChildren || canAddChildren) && toggleExpand(node.id)}
            style={{ fontSize: 10, color: config.color, cursor: hasChildren || canAddChildren ? 'pointer' : 'default', userSelect: 'none', lineHeight: 1 }}>
            {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : isLeafLevel ? config.icon : '\u25B7'}
          </span>
        </div>

        {/* Level badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 7px', borderRadius: 4, flexShrink: 0,
          fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
          background: config.bg, color: config.color,
          border: config.required ? `1px solid ${config.color}44` : 'none',
        }}>
          {config.icon} {config.label}
          {config.required && <span title="Required level" style={{ fontSize: 8 }}>*</span>}
        </span>

        {/* Activity ID */}
        {node.activityId && (
          <span style={{ fontSize: 10, color: config.color, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', background: '#fff', padding: '1px 4px', borderRadius: 3, border: '1px solid #e2e8f0' }}>
            {node.activityId}
          </span>
        )}

        {/* Name + Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineEdit value={node.name} onSave={(name) => onUpdate(node.id, { name })} fontSize={node.level === 'VALUE_STREAM' ? 15 : 13} fontWeight={node.level === 'VALUE_STREAM' || node.level === 'PROCESS' ? 600 : 500} />
          <div style={{ marginTop: 1 }}>
            <InlineEdit value={node.description} onSave={(description) => onUpdate(node.id, { description })} fontSize={11} placeholder="Add description..." />
          </div>
          {/* Guided prompt for missing required children */}
          {warning && (
            <div style={{ fontSize: 10, color: '#d97706', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, background: '#fef3c7', padding: '2px 8px', borderRadius: 4, width: 'fit-content' }}>
              <span style={{ fontSize: 11 }}>{'\u2192'}</span>
              <span style={{ fontWeight: 500 }}>{warning}</span>
              {guidedLevel && (
                <button style={{ ...btnAdd, fontSize: 10, padding: '1px 8px', borderColor: '#d97706', color: '#d97706', background: '#fff', fontWeight: 600 }}
                  onClick={() => { if (!isExpanded) toggleExpand(node.id); onAddChild(node.id); }}>
                  + Add {LEVEL_CONFIG[guidedLevel].label}
                </button>
              )}
            </div>
          )}
          {/* Progress checklist for value streams */}
          {completeness && (
            <div style={{ fontSize: 10, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#16a34a' }}>{'\u2713'} Value Stream</span>
              <span style={{ color: completeness.hasProcess ? '#16a34a' : '#d97706' }}>
                {completeness.hasProcess ? '\u2713' : '\u2717'} Process
              </span>
              <span style={{ color: completeness.hasActivity ? '#16a34a' : '#d97706' }}>
                {completeness.hasActivity ? '\u2713' : '\u2717'} Activity
              </span>
              {completeness.complete && <span style={{ color: '#16a34a', fontWeight: 500 }}>Ready</span>}
            </div>
          )}
        </div>

        {/* Flow indicators */}
        {node.level === 'ACTIVITY' && (incomingFlows.length > 0 || outgoingFlows.length > 0) && (
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}
            title={`${incomingFlows.length} incoming, ${outgoingFlows.length} outgoing flows`}>
            {incomingFlows.length > 0 && `\u2190${incomingFlows.length}`}{' '}
            {outgoingFlows.length > 0 && `\u2192${outgoingFlows.length}`}
          </span>
        )}

        {/* Status — blocks ACTIVE on incomplete nodes */}
        <select value={node.status} onChange={(e) => {
            if (e.target.value === 'ACTIVE' && !canBeActive) {
              alert(`Cannot set to ACTIVE. ${node.level === 'VALUE_STREAM' ? 'Value stream needs Process + Activity.' : 'Process needs at least one Activity.'}`);
              return;
            }
            onUpdate(node.id, { status: e.target.value });
          }}
          style={{ ...inputStyle, width: 'auto', fontSize: 10, padding: '1px 4px',
            background: statusColors[node.status]?.bg || '#f1f5f9',
            color: statusColors[node.status]?.color || '#64748b', fontWeight: 600, border: 'none',
          }}>
          {STATUSES.map((s) => (
            <option key={s} value={s} disabled={s === 'ACTIVE' && !canBeActive}>
              {s}{s === 'ACTIVE' && !canBeActive ? ' (incomplete)' : ''}
            </option>
          ))}
        </select>

        {/* Actions — smart + button */}
        {canAddChildren && (
          guidedLevel ? (
            <button style={{
              background: LEVEL_CONFIG[guidedLevel].bg, color: LEVEL_CONFIG[guidedLevel].color,
              border: `1px solid ${LEVEL_CONFIG[guidedLevel].color}44`, borderRadius: 4,
              padding: '1px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
              onClick={() => { if (!isExpanded) toggleExpand(node.id); onAddChild(node.id); }}
              title={`Add ${LEVEL_CONFIG[guidedLevel].label} to ${node.name}`}>
              + {LEVEL_CONFIG[guidedLevel].label}
            </button>
          ) : (
            <button style={{ ...btnIcon, color: config.color, fontWeight: 700, fontSize: 14 }}
              onClick={() => { if (!isExpanded) toggleExpand(node.id); onAddChild(node.id); }} title={`Add child to ${node.name}`}>+</button>
          )
        )}
        <button style={{ ...btnIcon, color: 'var(--color-error)', fontSize: 14 }} onClick={() => onDelete(node.id)} title="Delete">&times;</button>
      </div>

      {/* Children */}
      {isExpanded && (node.children || []).map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1}
          onUpdate={onUpdate} onDelete={onDelete} onAddChild={onAddChild}
          expanded={expanded} toggleExpand={toggleExpand}
          validChildrenMap={validChildrenMap} flows={flows} />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function ProcessCatalogPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, activeOrgType, canCreateValueStreams } = useOrgContext();
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [validChildrenMap, setValidChildrenMap] = useState<Record<string, string[]>>({});
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [catalogRes, flowsRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>(`/process-catalog${qp}`),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
      ]);
      setTree(catalogRes.tree || []);
      setStats(catalogRes.stats || {});
      setValidChildrenMap(catalogRes.validChildren || {});
      setFlows(flowsRes.data || []);
      // Auto-expand value streams
      if (catalogRes.tree) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const vs of catalogRes.tree) next.add(vs.id);
          return next;
        });
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const expandAll = () => {
    const allIds = new Set<string>();
    function collect(nodes: ProcessNode[]) {
      for (const n of nodes) { allIds.add(n.id); if (n.children) collect(n.children); }
    }
    collect(tree);
    setExpanded(allIds);
  };

  const addNode = async (parentId: string | null, name: string, description: string, level: NodeLevel) => {
    await apiClient.post('/process-catalog/nodes', { parentId, level, name, description, orgIds: activeOrgId ? [activeOrgId] : undefined });
    setAddingTo(null);
    fetchData();
  };

  const updateNode = async (id: string, data: Record<string, any>) => {
    await apiClient.put(`/process-catalog/nodes/${id}`, data);
    fetchData();
  };

  const deleteNode = async (id: string) => {
    await apiClient.delete(`/process-catalog/nodes/${id}`);
    fetchData();
  };

  const byLevel = stats.byLevel || {};
  const totalNodes = stats.total || 0;
  const issues = collectIssues(tree);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
            <Link to="/help#process-catalog" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Define your business processes. Required path: <strong>Value Stream</strong> → <strong>Process</strong> → <strong>Activity</strong>
          </p>
        </div>
        {totalNodes > 0 && canCreateValueStreams && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate('/processes/visualization')}
              style={{ padding: '8px 16px', background: '#0f4f46', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {'\u25A3'} Visualize
            </button>
            <button onClick={() => navigate('/processes/wizard')}
              style={{ padding: '8px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Generate from Template
            </button>
            <button onClick={() => setAddingTo('__root__')}
              style={{ padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              + Add Value Stream
            </button>
          </div>
        )}
        {totalNodes > 0 && !canCreateValueStreams && (
          <button onClick={() => navigate('/processes/visualization')}
            style={{ padding: '8px 16px', background: '#0f4f46', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {'\u25A3'} Visualize
          </button>
        )}
      </div>

      {/* Org restriction notice */}
      {!activeOrgId && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b33', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
          Select a <strong>company or division</strong> from the "Working in" dropdown above to create and manage value streams.
        </div>
      )}
      {activeOrgId && !canCreateValueStreams && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b33', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
          Value streams can only be created at the <strong>company or division</strong> level. <strong>{activeOrgName}</strong> is a {activeOrgType}. Select a company or division from the "Working in" dropdown.
        </div>
      )}

      {/* Legend */}
      {totalNodes > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(LEVEL_CONFIG).map(([level, config]) => {
            const count = byLevel[level] || 0;
            if (count === 0 && !config.required) return null;
            return (
              <div key={level} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: count > 0 ? config.bg : '#f8fafc', color: count > 0 ? config.color : '#94a3b8',
                borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 500,
                border: config.required ? `1px solid ${count > 0 ? config.color : '#94a3b8'}33` : '1px solid transparent',
              }} title={config.hint}>
                {config.icon} {count} {config.label}{count !== 1 ? 's' : ''}
                {config.required && <span style={{ fontSize: 8 }}>*</span>}
              </div>
            );
          })}
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>* = required</span>
        </div>
      )}

      {/* Toolbar */}
      {tree.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            Click any name or description to edit. Optional levels can be added at any time.
          </span>
        </div>
      )}

      {/* Validation summary */}
      {issues.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b33', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: issues.length > 3 ? 6 : 0 }}>
            <span style={{ fontSize: 14 }}>{'\u26A0'}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>
              {issues.length} {issues.length === 1 ? 'issue' : 'issues'} to resolve before processes can be set to Active
            </span>
          </div>
          {issues.slice(0, 5).map((issue, i) => (
            <div key={i} style={{ fontSize: 11, color: '#92400e', marginLeft: 22, marginTop: 2 }}>
              <strong>{issue.nodeName}</strong> ({LEVEL_CONFIG[issue.level].label}): {issue.issue}
            </div>
          ))}
          {issues.length > 5 && (
            <div style={{ fontSize: 11, color: '#92400e', marginLeft: 22, marginTop: 2 }}>
              ...and {issues.length - 5} more
            </div>
          )}
        </div>
      )}

      {/* Add root form */}
      {addingTo === '__root__' && (
        <div style={{ marginBottom: 12 }}>
          <AddNodeForm validChildren={['VALUE_STREAM']}
            onAdd={(name, desc, level) => addNode(null, name, desc, level)}
            onCancel={() => setAddingTo(null)} />
        </div>
      )}

      {/* Tree */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden', minHeight: 300 }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : tree.length === 0 && addingTo !== '__root__' ? (
          <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Get started with your process hierarchy</h2>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
                Every process in Procela follows a simple required path:
              </p>
            </div>

            {/* Visual guide */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              {(['VALUE_STREAM', 'PROCESS', 'ACTIVITY'] as NodeLevel[]).map((level, i) => {
                const config = LEVEL_CONFIG[level];
                return (
                  <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      background: config.bg, color: config.color, borderRadius: 8,
                      padding: '12px 16px', textAlign: 'center', minWidth: 120,
                      border: `2px solid ${config.color}44`,
                    }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{config.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{config.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{config.hint.split('.')[0]}</div>
                    </div>
                    {i < 2 && <span style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>{'\u2192'}</span>}
                  </div>
                );
              })}
            </div>

            <p style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 20 }}>
              Start simple, then add optional levels (Domain, Capability, Sub-Process, Task, Execution) as you need more detail.
            </p>

            {canCreateValueStreams ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => navigate('/processes/wizard')}
                  style={{ padding: '10px 24px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Generate from Industry Template
                </button>
                <button onClick={() => setAddingTo('__root__')}
                  style={{ padding: '10px 24px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Custom
                </button>
              </div>
            ) : (
              <p style={{ color: '#92400e', fontSize: 13 }}>
                Select a <strong>company or division</strong> from the "Working in" dropdown to get started.
              </p>
            )}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode key={node.id} node={node} depth={0}
              onUpdate={updateNode} onDelete={deleteNode}
              onAddChild={(parentId) => setAddingTo(parentId)}
              expanded={expanded} toggleExpand={toggleExpand}
              validChildrenMap={validChildrenMap} flows={flows} />
          ))
        )}
      </div>

      {/* Add child form */}
      {addingTo && addingTo !== '__root__' && (() => {
        const parentNode = findNodeInTree(tree, addingTo);
        if (!parentNode) return null;
        const validChildren = (validChildrenMap[parentNode.level] || []) as NodeLevel[];
        if (validChildren.length === 0) return null;
        return (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              Adding to: <strong>{parentNode.name}</strong> ({LEVEL_CONFIG[parentNode.level].label})
            </div>
            <AddNodeForm validChildren={validChildren}
              onAdd={(name, desc, level) => addNode(addingTo, name, desc, level)}
              onCancel={() => setAddingTo(null)} />
          </div>
        );
      })()}
    </div>
  );
}
