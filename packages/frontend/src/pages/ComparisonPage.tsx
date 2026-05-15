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

// ── Level Configuration ──

const LEVEL_CONFIG: Record<NodeLevel, { color: string; bg: string; label: string; icon: string }> = {
  VALUE_STREAM: { color: '#0f4f46', bg: '#d1f0eb', label: 'Value Stream', icon: '\u2B95' },
  DOMAIN:       { color: '#5b21b6', bg: '#ede9fe', label: 'Domain', icon: '\u25CE' },
  CAPABILITY:   { color: '#1e40af', bg: '#dbeafe', label: 'Capability', icon: '\u2B50' },
  PROCESS:      { color: '#92400e', bg: '#fef3c7', label: 'Process', icon: '\u2699' },
  SUBPROCESS:   { color: '#9d174d', bg: '#fce7f3', label: 'Sub-Process', icon: '\u21B3' },
  ACTIVITY:     { color: '#065f46', bg: '#d1fae5', label: 'Activity', icon: '\u25B6' },
  TASK:         { color: '#64748b', bg: '#f1f5f9', label: 'Task', icon: '\u2022' },
  EXECUTION:    { color: '#475569', bg: '#e2e8f0', label: 'System/Execution', icon: '\u2318' },
};

// ── Helpers ──

function collectNames(node: ProcessNode): Set<string> {
  const names = new Set<string>();
  names.add(node.name.toLowerCase().trim());
  for (const child of node.children || []) {
    for (const n of collectNames(child)) {
      names.add(n);
    }
  }
  return names;
}

function countNodes(node: ProcessNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

function CompareTreeNode({
  node,
  depth,
  otherNames,
  side,
}: {
  node: ProcessNode;
  depth: number;
  otherNames: Set<string>;
  side: 'left' | 'right';
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children || []).length > 0;
  const config = LEVEL_CONFIG[node.level];
  const nameKey = node.name.toLowerCase().trim();
  const isUnique = !otherNames.has(nameKey);

  // Green for unique-to-left, blue for unique-to-right, white for common
  let bg = 'transparent';
  if (isUnique) {
    bg = side === 'left' ? '#dcfce7' : '#dbeafe';
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          paddingLeft: 10 + depth * 18,
          borderBottom: '1px solid var(--color-border)',
          background: bg,
          transition: 'background 0.1s',
        }}
      >
        {/* Expand/collapse */}
        <span
          onClick={() => hasChildren && setExpanded((v) => !v)}
          style={{
            fontSize: 10,
            color: config.color,
            cursor: hasChildren ? 'pointer' : 'default',
            userSelect: 'none',
            width: 14,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {hasChildren ? (expanded ? '\u25BC' : '\u25B6') : config.icon}
        </span>

        {/* Level badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            background: config.bg,
            color: config.color,
            flexShrink: 0,
          }}
        >
          {config.icon} {config.label}
        </span>

        {/* Name */}
        <span
          style={{
            fontSize: 12,
            fontWeight: node.level === 'VALUE_STREAM' || node.level === 'PROCESS' ? 600 : 400,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={node.name}
        >
          {node.name}
        </span>

        {/* Unique indicator */}
        {isUnique && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: side === 'left' ? '#16a34a' : '#2563eb',
              background: side === 'left' ? '#dcfce7' : '#dbeafe',
              padding: '1px 6px',
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            Unique
          </span>
        )}
      </div>

      {/* Children */}
      {expanded &&
        (node.children || []).map((child) => (
          <CompareTreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            otherNames={otherNames}
            side={side}
          />
        ))}
    </div>
  );
}

// ── Main Component ──

export default function ComparisonPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{
        success: boolean;
        tree: ProcessNode[];
      }>(`/process-catalog${qp}`);
      setTree(res.tree || []);
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const valueStreams = tree.filter((n) => n.level === 'VALUE_STREAM');
  const leftVS = valueStreams.find((vs) => vs.id === leftId) || null;
  const rightVS = valueStreams.find((vs) => vs.id === rightId) || null;

  const leftNames = leftVS ? collectNames(leftVS) : new Set<string>();
  const rightNames = rightVS ? collectNames(rightVS) : new Set<string>();

  const leftTotal = leftVS ? countNodes(leftVS) : 0;
  const rightTotal = rightVS ? countNodes(rightVS) : 0;

  // Common names
  const commonCount = (() => {
    let count = 0;
    for (const name of leftNames) {
      if (rightNames.has(name)) count++;
    }
    return count;
  })();

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              Compare Value Streams
            </h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} aria-label="Help" title="Help">?</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Select two value streams to compare their hierarchies side by side.
          </p>
        </div>
        <button
          onClick={() => navigate('/processes')}
          style={{
            padding: '8px 16px',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Back to Processes
        </button>
      </div>

      {loading ? (
        <p
          style={{
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            padding: '4rem',
          }}
        >
          Loading...
        </p>
      ) : valueStreams.length < 2 ? (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b33',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          You need at least <strong>2 value streams</strong> to use the comparison view. Create more value streams first.
        </div>
      ) : (
        <>
          {/* Selectors */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}
              >
                Left Panel
              </label>
              <select
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: leftId ? '#dcfce7' : 'var(--color-surface)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                <option value="">Select a value stream...</option>
                {valueStreams
                  .filter((vs) => vs.id !== rightId)
                  .map((vs) => (
                    <option key={vs.id} value={vs.id}>
                      {vs.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}
              >
                Right Panel
              </label>
              <select
                value={rightId}
                onChange={(e) => setRightId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: rightId ? '#dbeafe' : 'var(--color-surface)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                <option value="">Select a value stream...</option>
                {valueStreams
                  .filter((vs) => vs.id !== leftId)
                  .map((vs) => (
                    <option key={vs.id} value={vs.id}>
                      {vs.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Summary stats */}
          {leftVS && rightVS && (
            <div
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: 16,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  background: '#dcfce7',
                  color: '#16a34a',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Left: {leftTotal} nodes
              </div>
              <div
                style={{
                  background: '#dbeafe',
                  color: '#2563eb',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Right: {rightTotal} nodes
              </div>
              <div
                style={{
                  background: '#f1f5f9',
                  color: '#64748b',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {commonCount} in common (by name)
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center', color: 'var(--color-text-muted)' }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 2 }} /> Unique to left
                <span style={{ display: 'inline-block', width: 12, height: 12, background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 2, marginLeft: 8 }} /> Unique to right
              </div>
            </div>
          )}

          {/* Side by side panels */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              minHeight: 300,
            }}
          >
            {/* Left panel */}
            <div
              style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                overflow: 'hidden',
              }}
            >
              {leftVS ? (
                <CompareTreeNode
                  node={leftVS}
                  depth={0}
                  otherNames={rightNames}
                  side="left"
                />
              ) : (
                <div
                  style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    color: 'var(--color-text-muted)',
                    fontSize: 13,
                  }}
                >
                  Select a value stream for the left panel
                </div>
              )}
            </div>

            {/* Right panel */}
            <div
              style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                overflow: 'hidden',
              }}
            >
              {rightVS ? (
                <CompareTreeNode
                  node={rightVS}
                  depth={0}
                  otherNames={leftNames}
                  side="right"
                />
              ) : (
                <div
                  style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    color: 'var(--color-text-muted)',
                    fontSize: 13,
                  }}
                >
                  Select a value stream for the right panel
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
