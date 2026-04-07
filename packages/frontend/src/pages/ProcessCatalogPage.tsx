import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

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
  type: 'SEQUENCE' | 'PARALLEL' | 'CONDITIONAL' | 'LOOP';
  label: string | null;
}

// ── Styles ──

const LEVEL_CONFIG: Record<NodeLevel, { color: string; bg: string; indent: number; label: string }> = {
  VALUE_STREAM: { color: '#0f4f46', bg: '#d1f0eb', indent: 0, label: 'Value Stream' },
  DOMAIN:       { color: '#5b21b6', bg: '#ede9fe', indent: 1, label: 'Domain' },
  CAPABILITY:   { color: '#1e40af', bg: '#dbeafe', indent: 2, label: 'Capability' },
  PROCESS:      { color: '#92400e', bg: '#fef3c7', indent: 3, label: 'Process' },
  SUBPROCESS:   { color: '#9d174d', bg: '#fce7f3', indent: 4, label: 'Sub-Process' },
  ACTIVITY:     { color: '#065f46', bg: '#d1fae5', indent: 5, label: 'Activity' },
  TASK:         { color: '#64748b', bg: '#f1f5f9', indent: 6, label: 'Task' },
  EXECUTION:    { color: '#475569', bg: '#e2e8f0', indent: 7, label: 'System/Execution' },
};

const STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'];
const statusColors: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: '#f1f5f9', color: '#64748b' },
  ACTIVE: { bg: '#d1f0eb', color: '#0f4f46' },
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED: { bg: '#fce7f3', color: '#9d174d' },
};

const FLOW_TYPES = ['SEQUENCE', 'PARALLEL', 'CONDITIONAL', 'LOOP'];

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

function AddNodeForm({ parentLevel, validChildren, onAdd, onCancel }: {
  parentLevel: NodeLevel | null; validChildren: NodeLevel[]; onAdd: (name: string, description: string, level: NodeLevel) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<NodeLevel>(validChildren[0]);

  return (
    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4, padding: 10, margin: '4px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <select style={{ ...inputStyle, width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value as NodeLevel)}>
          {validChildren.map((l) => <option key={l} value={l}>{LEVEL_CONFIG[l].label}</option>)}
        </select>
        <input autoFocus style={{ ...inputStyle, flex: 1 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onAdd(name.trim(), description.trim(), level); if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <input style={{ ...inputStyle, width: '100%', marginBottom: 6 }} placeholder="Description (optional)" value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onAdd(name.trim(), description.trim(), level); if (e.key === 'Escape') onCancel(); }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ ...btnAdd, background: 'var(--color-primary)', color: '#fff', border: 'none' }}
          onClick={() => { if (name.trim()) onAdd(name.trim(), description.trim(), level); }} disabled={!name.trim()}>Add</button>
        <button style={btnAdd} onClick={onCancel}>Cancel</button>
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
  const validChildren = validChildrenMap[node.level] || [];
  const canAddChildren = validChildren.length > 0;

  // Flow indicators for activities
  const outgoingFlows = flows.filter((f) => f.fromNodeId === node.id);
  const incomingFlows = flows.filter((f) => f.toNodeId === node.id);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', paddingLeft: 12 + depth * 20,
        borderBottom: '1px solid var(--color-border)',
        transition: 'background 0.1s',
      }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        {/* Expand */}
        <span onClick={() => (hasChildren || canAddChildren) && toggleExpand(node.id)}
          style={{ width: 14, fontSize: 10, color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : canAddChildren ? '\u25B7' : '\u2022'}
        </span>

        {/* Level badge */}
        <span style={{
          display: 'inline-block', padding: '1px 6px', borderRadius: 3,
          fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
          background: config.bg, color: config.color, whiteSpace: 'nowrap',
        }}>{config.label}</span>

        {/* Activity ID */}
        {node.activityId && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            {node.activityId}
          </span>
        )}

        {/* Name + Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineEdit value={node.name} onSave={(name) => onUpdate(node.id, { name })} fontSize={13} fontWeight={500} />
          {(node.description || depth < 3) && (
            <div style={{ marginTop: 1 }}>
              <InlineEdit value={node.description} onSave={(description) => onUpdate(node.id, { description })} fontSize={11} placeholder="Add description..." />
            </div>
          )}
        </div>

        {/* Flow indicators for activities */}
        {node.level === 'ACTIVITY' && (incomingFlows.length > 0 || outgoingFlows.length > 0) && (
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
            title={`${incomingFlows.length} in, ${outgoingFlows.length} out`}>
            {incomingFlows.length > 0 ? `\u2190${incomingFlows.length}` : ''}{' '}
            {outgoingFlows.length > 0 ? `\u2192${outgoingFlows.length}` : ''}
          </span>
        )}

        {/* Status */}
        <select value={node.status} onChange={(e) => onUpdate(node.id, { status: e.target.value })}
          style={{ ...inputStyle, width: 'auto', fontSize: 10, padding: '1px 4px',
            background: statusColors[node.status]?.bg || '#f1f5f9',
            color: statusColors[node.status]?.color || '#64748b', fontWeight: 600, border: 'none',
          }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Actions */}
        {canAddChildren && (
          <button style={{ ...btnIcon, color: 'var(--color-primary)', fontWeight: 700 }}
            onClick={() => { if (!isExpanded) toggleExpand(node.id); onAddChild(node.id); }} title="Add child">+</button>
        )}
        <button style={{ ...btnIcon, color: 'var(--color-error)' }} onClick={() => onDelete(node.id)} title="Delete">&times;</button>
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
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [validChildrenMap, setValidChildrenMap] = useState<Record<string, string[]>>({});
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null); // parentId or '__root__'

  const fetchData = useCallback(async () => {
    try {
      const [catalogRes, flowsRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>('/process-catalog'),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
      ]);
      setTree(catalogRes.tree || []);
      setStats(catalogRes.stats || {});
      setValidChildrenMap(catalogRes.validChildren || {});
      setFlows(flowsRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

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
    await apiClient.post('/process-catalog/nodes', { parentId, level, name, description });
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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            Value Stream &gt; Domain &gt; Capability &gt; Process &gt; Sub-Process &gt; Activity &gt; Task &gt; Execution
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/processes/wizard')}
            style={{ padding: '0.5rem 1rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
            Generate from Template
          </button>
          <button onClick={() => setAddingTo('__root__')}
            style={{ padding: '0.5rem 1rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
            + Add Value Stream
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats.total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {Object.entries(LEVEL_CONFIG).map(([level, config]) => {
            const count = byLevel[level] || 0;
            if (count === 0) return null;
            return (
              <div key={level} style={{
                background: config.bg, color: config.color, borderRadius: 6,
                padding: '6px 12px', fontSize: 12, fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{count}</span>
                {config.label}{count !== 1 ? 's' : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      {tree.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>
            Required path: Value Stream &rarr; Process &rarr; Activity. Other levels are optional.
          </span>
        </div>
      )}

      {/* Add root form */}
      {addingTo === '__root__' && (
        <div style={{ marginBottom: 12 }}>
          <AddNodeForm parentLevel={null} validChildren={['VALUE_STREAM']}
            onAdd={(name, desc, level) => addNode(null, name, desc, level)}
            onCancel={() => setAddingTo(null)} />
        </div>
      )}

      {/* Tree */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden', minHeight: 300 }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : tree.length === 0 && addingTo !== '__root__' ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>No process hierarchy defined yet.</p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 12, marginBottom: 16 }}>
              Start simple with Value Stream &rarr; Process &rarr; Activity, then add more detail later.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => navigate('/processes/wizard')}
                style={{ padding: '10px 20px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Generate from Industry Template
              </button>
              <button onClick={() => setAddingTo('__root__')}
                style={{ padding: '10px 20px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Start from Scratch
              </button>
            </div>
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

      {/* Add child form (rendered at bottom when active) */}
      {addingTo && addingTo !== '__root__' && (() => {
        const parentNode = findNodeInTree(tree, addingTo);
        if (!parentNode) return null;
        const validChildren = (validChildrenMap[parentNode.level] || []) as NodeLevel[];
        if (validChildren.length === 0) return null;
        return (
          <div style={{ marginTop: 8, padding: '0 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              Adding child to: <strong>{parentNode.name}</strong> ({LEVEL_CONFIG[parentNode.level].label})
            </div>
            <AddNodeForm parentLevel={parentNode.level} validChildren={validChildren}
              onAdd={(name, desc, level) => addNode(addingTo, name, desc, level)}
              onCancel={() => setAddingTo(null)} />
          </div>
        );
      })()}
    </div>
  );
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
