import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { tierLabel } from '../lib/governanceTier';
import { useOrgContext } from '../stores/orgContext';
import { usePolling } from '../hooks/usePolling';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import HelpPopover from '../components/HelpPopover';
import AttachmentsPanel from '../components/AttachmentsPanel';
import { useToastStore } from '../stores/toastStore';
import { exportCsv } from '../lib/exportCsv';
import { SkeletonRows } from '../components/Skeleton';
import SkillPicker from '../components/SkillPicker';
import VersionHistoryModal from '../components/VersionHistoryModal';

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
  version?: number;
  purpose?: string;
  businessOutcome?: string;
  stakeholders?: string;
  complianceTags?: string[];
  inputsOutputs?: string;
  responsibleRole?: string;
  statusJustification?: string;
  frequency?: string;
  riskLevel?: string;
  automationLevel?: string;
  estimatedDuration?: string;
  requiredSkillIds?: string[];
  children?: ProcessNode[];
}

interface FlowRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
}

interface TagEntry {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  tag: string;
  createdAt: string;
}

// ── Level Configuration ──

const LEVEL_CONFIG: Record<NodeLevel, { color: string; bg: string; label: string; plural: string; required: boolean; icon: string; hint: string }> = {
  VALUE_STREAM: { color: '#0f4f46', bg: '#d1f0eb', label: 'Value Stream', plural: 'Value Streams', required: true, icon: '\u2B95', hint: 'End-to-end flow delivering value to a customer or stakeholder' },
  DOMAIN:       { color: '#5b21b6', bg: '#ede9fe', label: 'Domain', plural: 'Domains', required: false, icon: '\u25CE', hint: 'A business domain grouping related capabilities' },
  CAPABILITY:   { color: '#1e40af', bg: '#dbeafe', label: 'Capability', plural: 'Capabilities', required: false, icon: '\u2B50', hint: 'A business capability that the organization performs' },
  PROCESS:      { color: '#92400e', bg: '#fef3c7', label: 'Process', plural: 'Processes', required: true, icon: '\u2699', hint: 'A defined set of activities achieving a specific outcome' },
  SUBPROCESS:   { color: '#9d174d', bg: '#fce7f3', label: 'Sub-Process', plural: 'Sub-Processes', required: false, icon: '\u21B3', hint: 'A grouping of related activities within a process' },
  ACTIVITY:     { color: '#065f46', bg: '#d1fae5', label: 'Activity', plural: 'Activities', required: true, icon: '\u25B6', hint: 'A specific unit of work with inputs and outputs' },
  TASK:         { color: '#64748b', bg: '#f1f5f9', label: 'Task', plural: 'Tasks', required: false, icon: '\u2022', hint: 'A detailed task within an activity' },
  EXECUTION:    { color: '#475569', bg: '#e2e8f0', label: 'System/Execution', plural: 'Systems/Executions', required: false, icon: '\u2318', hint: 'System or automation that executes a task' },
};

import { getStatusColor } from '@/lib/statusBadge';
import { formatPersonLabel } from '../lib/personLabel';

const ALL_STATUSES = ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'];
const statusColors = Object.fromEntries(ALL_STATUSES.map((s) => [s, getStatusColor(s)]));

const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT:      ['ACTIVE'],
  ACTIVE:     ['DRAFT', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};
const ADVANCED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['DRAFT', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const SIMPLE_LOCKED = new Set(['ACTIVE', 'DEPRECATED']);
const ADVANCED_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

const COMPLIANCE_OPTIONS = [
  'SOX', 'HIPAA', 'GDPR', 'PCI-DSS', 'CCPA', 'FERPA', 'FISMA', 'NERC CIP',
  'ISO 27001', 'SOC 2', 'NIST', 'GLBA', 'FERC', 'EPA', 'OSHA', 'ADA', 'Other',
];

const FREQUENCY_OPTIONS = [
  'Continuous', 'Real-time', 'Hourly', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'On-demand', 'Event-driven',
];

const RISK_OPTIONS = ['High', 'Medium', 'Low'];

const AUTOMATION_OPTIONS = ['Manual', 'Semi-automated', 'Fully automated'];

const ROLE_OPTIONS = [
  'Process Owner', 'Process Manager', 'Business Analyst', 'Data Analyst',
  'System Administrator', 'End User', 'Supervisor', 'Technician',
  'Customer Service Rep', 'Finance Analyst', 'Compliance Officer',
  'Operations Manager', 'IT Support', 'Quality Analyst', 'Other',
];

interface PersonRef { id: string; name: string; }
interface DataAssetRef { id: string; name: string; }
interface MappingInfo {
  id: string;
  processStepId: string;
  dataAssetId: string;
  linkType: string;
  criticality?: string;
  dataFormat?: string;
  sla?: string;
  qualityRequirement?: string;
  sourceSystem?: string;
  destinationSystem?: string;
  assetInfo: { assetId: string; assetName: string; ownerName: string | null; stewardName: string | null; governanceTier: string; healthScore: number } | null;
}

const DATA_FORMAT_OPTIONS = ['API', 'CSV', 'JSON', 'XML', 'Database', 'File Transfer', 'Manual Entry', 'Spreadsheet', 'Real-time Stream', 'Batch', 'Paper', 'Other'];
const CRITICALITY_OPTIONS = ['REQUIRED', 'OPTIONAL'];

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

function InlineEdit({ value, onSave, fontSize = 13, fontWeight = 400, placeholder = 'Click to edit...', disabled = false }: {
  value: string; onSave: (v: string) => void; fontSize?: number; fontWeight?: number; placeholder?: string; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing || disabled) {
    return (
      <span onClick={() => { if (!disabled) { setDraft(value); setEditing(true); } }}
        style={{ cursor: disabled ? 'default' : 'pointer', fontSize, fontWeight, opacity: disabled ? 0.7 : 1 }}
        title={disabled ? 'Locked — change status to Draft to edit' : 'Click to edit'}>
        {value || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{placeholder}</span>}
      </span>
    );
  }
  return (
    <div>
      <input autoFocus style={{ ...inputStyle, fontSize, fontWeight, width: '100%' }} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 1 }}>Enter to save &middot; Esc to cancel</div>
    </div>
  );
}

// ── Documentation Field (label + inline edit in a compact row) ──

function DocField({ label, value, onSave, disabled, placeholder }: {
  label: string; value: string; onSave: (v: string) => void; disabled: boolean; placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const doSave = () => {
    if (draft !== value) { onSave(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    setEditing(false);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>{label}:</span>
      {editing && !disabled ? (
        <div style={{ flex: 1 }}>
          <input autoFocus style={{ ...inputStyle, fontSize: 11, padding: '2px 6px', width: '100%' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={doSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSave();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div style={{ fontSize: 8, color: 'var(--color-text-muted)', marginTop: 1 }}>Enter to save &middot; Esc to cancel</div>
        </div>
      ) : (
        <>
          <span
            onClick={() => { if (!disabled) { setDraft(value); setEditing(true); } }}
            style={{ cursor: disabled ? 'default' : 'pointer', color: value ? 'var(--color-text)' : 'var(--color-text-muted)', fontStyle: value ? 'normal' : 'italic', opacity: disabled ? 0.6 : 1 }}
            title={disabled ? 'Locked' : 'Click to edit'}
          >
            {value || placeholder}
          </span>
          {saved && <span style={{ color: '#16a34a', fontSize: 9, fontWeight: 600 }}>Saved</span>}
        </>
      )}
    </div>
  );
}

// ── Documentation Dropdown (single select from predefined list) ──

function DocDropdown({ label, value, options, onSave, disabled, placeholder }: {
  label: string; value: string; options: string[]; onSave: (v: string) => void; disabled: boolean; placeholder: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => { onSave(e.target.value); setSaved(true); setTimeout(() => setSaved(false), 1500); }}
        disabled={disabled}
        style={{
          fontSize: 11, border: `1px solid ${saved ? '#22c55e' : 'var(--color-border)'}`, borderRadius: 4,
          background: saved ? '#f0fdf4' : 'var(--color-surface)', cursor: disabled ? 'default' : 'pointer',
          color: value ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '2px 6px',
          opacity: disabled ? 0.6 : 1, transition: 'border-color 0.2s, background 0.2s',
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {saved && <span style={{ color: '#16a34a', fontSize: 9, fontWeight: 600 }}>Saved</span>}
    </div>
  );
}

// ── Documentation Multi-Select (chips with add dropdown) ──

function DocMultiSelect({ label, selected, options, onSave, disabled, placeholder }: {
  label: string; selected: string[]; options: string[]; onSave: (vals: string[]) => void; disabled: boolean; placeholder: string;
}) {
  const available = options.filter((o) => !selected.includes(o));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 2 }}>{label}:</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', flex: 1 }}>
        {selected.map((v) => (
          <span key={v} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 500,
            background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
          }}>
            {v}
            {!disabled && (
              <button onClick={() => onSave(selected.filter((s) => s !== v))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#1e40af', padding: 0, lineHeight: 1 }}>&times;</button>
            )}
          </span>
        ))}
        {!disabled && available.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) onSave([...selected, e.target.value]); }}
            style={{
              fontSize: 10, border: '1px solid var(--color-border)', borderRadius: 4,
              background: 'var(--color-surface)', cursor: 'pointer',
              color: 'var(--color-text-muted)', padding: '2px 6px',
            }}
          >
            <option value="">{selected.length === 0 ? placeholder : '+ Add...'}</option>
            {available.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {!disabled && available.length === 0 && selected.length === 0 && (
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 10 }}>No options available</span>
        )}
        {selected.length === 0 && disabled && (
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', opacity: 0.6 }}>{placeholder}</span>
        )}
      </div>
    </div>
  );
}

// ── Inputs / Outputs Panel — shows mapped data assets with owner info ──

function IOPanel({ nodeId, mappings, assetsList, disabled, onAdd, onRemove }: {
  nodeId: string;
  mappings: MappingInfo[];
  assetsList: DataAssetRef[];
  disabled: boolean;
  onAdd: (nodeId: string, assetId: string, linkType: string) => void;
  onRemove: (mappingId: string) => void;
}) {
  const [showAdd, setShowAdd] = useState<'input' | 'output' | null>(null);
  const [pickedAsset, setPickedAsset] = useState('');
  const [expandedMapping, setExpandedMapping] = useState<string | null>(null);
  const [localMappings, setLocalMappings] = useState(mappings);
  useEffect(() => { setLocalMappings(mappings); }, [mappings]);

  const inputs = localMappings.filter((m) => m.linkType === 'consumes' || m.linkType === 'references');
  const outputs = localMappings.filter((m) => m.linkType === 'produces');
  const transforms = localMappings.filter((m) => m.linkType === 'transforms');

  const handleAdd = (linkType: string) => {
    if (!pickedAsset) return;
    onAdd(nodeId, pickedAsset, linkType);
    setPickedAsset('');
    setShowAdd(null);
  };

  const updateMapping = async (mappingId: string, updates: Record<string, any>) => {
    try {
      await apiClient.put(`/mappings/${mappingId}`, updates);
      setLocalMappings((prev) => prev.map((m) => m.id === mappingId ? { ...m, ...updates } : m));
    } catch { /* */ }
  };

  const renderRow = (m: MappingInfo) => {
    if (!m.assetInfo) return null;
    const tierBg = m.assetInfo.governanceTier === 'GOLD' ? '#fef3c7' : m.assetInfo.governanceTier === 'SILVER' ? '#f1f5f9' : '#fed7aa';
    const tierColor = m.assetInfo.governanceTier === 'GOLD' ? '#92400e' : m.assetInfo.governanceTier === 'SILVER' ? '#475569' : '#9a3412';
    const isExp = expandedMapping === m.id;
    return (
      <div key={m.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', flexWrap: 'wrap' }}>
          <span onClick={() => setExpandedMapping(isExp ? null : m.id)} style={{ cursor: 'pointer', fontSize: 8, color: 'var(--color-text-muted)' }}>
            {isExp ? '▼' : '▶'}
          </span>
          <span style={{ fontWeight: 500 }}>{m.assetInfo.assetName}</span>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: tierBg, color: tierColor }}>
            {tierLabel(m.assetInfo.governanceTier)}
          </span>
          {m.criticality && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: m.criticality === 'REQUIRED' ? '#fee2e2' : '#f1f5f9', color: m.criticality === 'REQUIRED' ? '#991b1b' : '#64748b' }}>
              {m.criticality}
            </span>
          )}
          {m.dataFormat && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#e0e7ff', color: '#3730a3' }}>{m.dataFormat}</span>
          )}
          {m.assetInfo.ownerName && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Owner: {m.assetInfo.ownerName}</span>
          )}
          {!disabled && (
            <button onClick={() => onRemove(m.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-error)', padding: 0, marginLeft: 'auto' }}>
              Remove
            </button>
          )}
        </div>
        {isExp && (
          <div style={{ paddingLeft: 16, paddingBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              Criticality:
              <select value={m.criticality || ''} disabled={disabled} onChange={(e) => updateMapping(m.id, { criticality: e.target.value })}
                style={{ fontSize: 10, padding: '1px 4px', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                <option value="">--</option>
                {CRITICALITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              Format:
              <select value={m.dataFormat || ''} disabled={disabled} onChange={(e) => updateMapping(m.id, { dataFormat: e.target.value })}
                style={{ fontSize: 10, padding: '1px 4px', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                <option value="">--</option>
                {DATA_FORMAT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              SLA:
              <input value={m.sla || ''} disabled={disabled} placeholder="e.g. By 6am daily"
                onBlur={(e) => updateMapping(m.id, { sla: e.target.value })}
                onChange={() => {}}
                style={{ fontSize: 10, padding: '1px 4px', border: '1px solid var(--color-border)', borderRadius: 3, width: 100 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              Quality req:
              <input value={m.qualityRequirement || ''} disabled={disabled} placeholder="e.g. Completeness > 95%"
                onBlur={(e) => updateMapping(m.id, { qualityRequirement: e.target.value })}
                onChange={() => {}}
                style={{ fontSize: 10, padding: '1px 4px', border: '1px solid var(--color-border)', borderRadius: 3, width: 130 }} />
            </label>
          </div>
        )}
      </div>
    );
  };

  const renderAddRow = (linkType: 'consumes' | 'produces') => {
    if (showAdd === (linkType === 'consumes' ? 'input' : 'output')) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginTop: 4 }}>
          <select value={pickedAsset} onChange={(e) => setPickedAsset(e.target.value)}
            autoFocus
            style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}>
            <option value="">-- Select data asset --</option>
            {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={() => handleAdd(linkType)} disabled={!pickedAsset}
            style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 3, cursor: pickedAsset ? 'pointer' : 'not-allowed', opacity: pickedAsset ? 1 : 0.5 }}>
            Save
          </button>
          <button onClick={() => { setShowAdd(null); setPickedAsset(''); }}
            style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button onClick={() => setShowAdd(linkType === 'consumes' ? 'input' : 'output')}
        style={{ fontSize: 10, padding: '2px 8px', marginTop: 4, background: 'transparent', border: '1px dashed var(--color-border)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
        + Add {linkType === 'consumes' ? 'Input' : 'Output'}
      </button>
    );
  };

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 4, border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Inputs ({inputs.length})
          </div>
          {inputs.length === 0 && !showAdd && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No inputs defined</div>}
          {inputs.map(renderRow)}
          {!disabled && renderAddRow('consumes')}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Outputs ({outputs.length})
          </div>
          {outputs.length === 0 && !showAdd && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No outputs defined</div>}
          {outputs.map(renderRow)}
          {!disabled && renderAddRow('produces')}
        </div>
      </div>
      {transforms.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Transforms ({transforms.length})
          </div>
          {transforms.map(renderRow)}
        </div>
      )}
    </div>
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
            {config.icon} Add {config.label}
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

function TreeNode({ node, depth, onUpdate, onDelete, onClone, onAddChild, expanded, toggleExpand, validChildrenMap, flows, siblingIndex, siblingCount, onReorder, onShowHistory, allTags, onAddTag, onRemoveTag, selectedIds, toggleSelect, peopleList, assetsList, mappingsByStep, onAddMapping, onRemoveMapping, statusMode, agentExecByActivity, onRunAgent, runningActivity, hasAgentRoles }: {
  node: ProcessNode; depth: number;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onAddChild: (parentId: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void;
  validChildrenMap: Record<string, string[]>;
  flows: FlowRelationship[];
  peopleList: PersonRef[];
  assetsList: DataAssetRef[];
  mappingsByStep: Record<string, MappingInfo[]>;
  onAddMapping: (nodeId: string, assetId: string, linkType: string) => void;
  onRemoveMapping: (mappingId: string) => void;
  statusMode: 'simple' | 'advanced';
  siblingIndex: number;
  siblingCount: number;
  onReorder: (nodeId: string, direction: 'up' | 'down') => void;
  onShowHistory: (nodeId: string) => void;
  allTags: TagEntry[];
  onAddTag: (nodeId: string, tag: string) => void;
  onRemoveTag: (tagId: string) => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  agentExecByActivity?: Record<string, { status: string; completedAt: string | null; agentName: string; durationMs: number | null }>;
  onRunAgent?: (activityId: string, activityName: string) => void;
  runningActivity?: string | null;
  hasAgentRoles?: boolean;
}) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const nodeTags = allTags.filter((t) => t.entityId === node.id);
  const isExpanded = expanded.has(node.id);
  const hasChildren = (node.children || []).length > 0;
  const config = LEVEL_CONFIG[node.level];
  const validChildren = (validChildrenMap[node.level] || []) as NodeLevel[];
  const canAddChildren = validChildren.length > 0;
  const STATUS_TRANSITIONS = statusMode === 'advanced' ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;
  const LOCKED_STATUSES = statusMode === 'advanced' ? ADVANCED_LOCKED : SIMPLE_LOCKED;
  const isLocked = LOCKED_STATUSES.has(node.status);

  // Completeness check for value streams
  const completeness = node.level === 'VALUE_STREAM' ? hasRequiredPath(node) : null;

  // Missing required children — what's needed next
  void getRequiredNextLevel;
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

  const isSelected = selectedIds.has(node.id);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        padding: '7px 12px', paddingLeft: 12 + depth * 22,
        borderBottom: '1px solid var(--color-border)',
        background: isSelected ? '#f0f9ff' : (completeness && !completeness.complete ? '#fffbeb' : undefined),
        transition: 'background 0.1s',
      }}
        onMouseEnter={(e) => { if (!isSelected && (!completeness || completeness.complete)) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = completeness && !completeness.complete ? '#fffbeb' : ''; }}
      >
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelect(node.id)}
          title="Select for bulk delete"
          style={{ flexShrink: 0, width: 14, height: 14, marginTop: 4, cursor: 'pointer' }}
        />
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
          <InlineEdit value={node.name} onSave={(name) => onUpdate(node.id, { name })} fontSize={node.level === 'VALUE_STREAM' ? 15 : 13} fontWeight={node.level === 'VALUE_STREAM' || node.level === 'PROCESS' ? 600 : 500} disabled={isLocked} />
          <div style={{ marginTop: 1 }}>
            <InlineEdit value={node.description} onSave={(description) => onUpdate(node.id, { description })} fontSize={11} placeholder="Add description..." disabled={isLocked} />
          </div>
          {/* Documentation fields — visible when expanded */}
          {isExpanded && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 2 }}>
              {/* Value Stream fields */}
              {node.level === 'VALUE_STREAM' && (
                <>
                  <DocDropdown label="Owner" value={peopleList.find((p) => p.id === node.ownerId)?.name || ''} options={peopleList.map((p) => p.name)} onSave={(v) => { const person = peopleList.find((p) => p.name === v); onUpdate(node.id, { ownerId: person?.id || null }); }} disabled={isLocked} placeholder="Select owner..." />
                  <DocField label="Purpose" value={node.purpose || ''} onSave={(v) => onUpdate(node.id, { purpose: v })} disabled={isLocked} placeholder="What does this accomplish?" />
                  <DocField label="Business Outcome" value={node.businessOutcome || ''} onSave={(v) => onUpdate(node.id, { businessOutcome: v })} disabled={isLocked} placeholder="What value does this deliver?" />
                  <DocMultiSelect label="Stakeholders" selected={(node.stakeholders || '').split(',').map((s) => s.trim()).filter(Boolean)} options={peopleList.map((p) => p.name)} onSave={(vals) => onUpdate(node.id, { stakeholders: vals.join(', ') })} disabled={isLocked} placeholder="Select stakeholders..." />
                  <DocMultiSelect label="Compliance" selected={node.complianceTags || []} options={COMPLIANCE_OPTIONS} onSave={(vals) => onUpdate(node.id, { complianceTags: vals })} disabled={isLocked} placeholder="Select compliance tags..." />
                </>
              )}
              {/* Process fields */}
              {node.level === 'PROCESS' && (
                <>
                  <DocDropdown label="Owner" value={peopleList.find((p) => p.id === node.ownerId)?.name || ''} options={peopleList.map((p) => p.name)} onSave={(v) => { const person = peopleList.find((p) => p.name === v); onUpdate(node.id, { ownerId: person?.id || null }); }} disabled={isLocked} placeholder="Select owner..." />
                  <DocField label="Purpose" value={node.purpose || ''} onSave={(v) => onUpdate(node.id, { purpose: v })} disabled={isLocked} placeholder="What does this accomplish?" />
                  <DocMultiSelect label="Stakeholders" selected={(node.stakeholders || '').split(',').map((s) => s.trim()).filter(Boolean)} options={peopleList.map((p) => p.name)} onSave={(vals) => onUpdate(node.id, { stakeholders: vals.join(', ') })} disabled={isLocked} placeholder="Select stakeholders..." />
                  <DocMultiSelect label="Compliance" selected={node.complianceTags || []} options={COMPLIANCE_OPTIONS} onSave={(vals) => onUpdate(node.id, { complianceTags: vals })} disabled={isLocked} placeholder="Select compliance tags..." />
                  <DocDropdown label="Frequency" value={node.frequency || ''} options={FREQUENCY_OPTIONS} onSave={(v) => onUpdate(node.id, { frequency: v })} disabled={isLocked} placeholder="How often?" />
                  <DocDropdown label="Risk Level" value={node.riskLevel || ''} options={RISK_OPTIONS} onSave={(v) => onUpdate(node.id, { riskLevel: v })} disabled={isLocked} placeholder="Select risk..." />
                  <DocField label="Inputs / Outputs" value={node.inputsOutputs || ''} onSave={(v) => onUpdate(node.id, { inputsOutputs: v })} disabled={isLocked} placeholder="What goes in and what comes out?" />
                </>
              )}
              {/* Sub-Process fields */}
              {node.level === 'SUBPROCESS' && (
                <DocField label="Inputs / Outputs" value={node.inputsOutputs || ''} onSave={(v) => onUpdate(node.id, { inputsOutputs: v })} disabled={isLocked} placeholder="What goes in and what comes out?" />
              )}
              {/* Activity fields */}
              {node.level === 'ACTIVITY' && (
                <>
                  <DocDropdown label="Responsible Role" value={node.responsibleRole || ''} options={ROLE_OPTIONS} onSave={(v) => onUpdate(node.id, { responsibleRole: v })} disabled={isLocked} placeholder="Select role..." />
                  <DocDropdown label="Automation" value={node.automationLevel || ''} options={AUTOMATION_OPTIONS} onSave={(v) => onUpdate(node.id, { automationLevel: v })} disabled={isLocked} placeholder="Automation level..." />
                  <DocField label="Est. Duration" value={node.estimatedDuration || ''} onSave={(v) => onUpdate(node.id, { estimatedDuration: v })} disabled={isLocked} placeholder="e.g. 2 hours, 1 day" />
                  <DocField label="Inputs / Outputs" value={node.inputsOutputs || ''} onSave={(v) => onUpdate(node.id, { inputsOutputs: v })} disabled={isLocked} placeholder="What goes in and what comes out?" />
                  <SkillPicker compact orgId={node.orgIds?.[0]} selectedSkillIds={node.requiredSkillIds || []} onChange={(ids) => onUpdate(node.id, { requiredSkillIds: ids })} disabled={isLocked} label="Required Skills" />
                  {/* Agent execution — Run button + last status */}
                  {hasAgentRoles && onRunAgent && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginTop: 2 }}>
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>Agent Run:</span>
                      <button
                        onClick={() => onRunAgent(node.id, node.name)}
                        disabled={runningActivity === node.id}
                        style={{
                          padding: '2px 10px', fontSize: 10, fontWeight: 600,
                          background: runningActivity === node.id ? '#e5e7eb' : '#7c3aed',
                          color: runningActivity === node.id ? '#6b7280' : '#fff',
                          border: 'none', borderRadius: 4, cursor: runningActivity === node.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {runningActivity === node.id ? 'Running...' : 'Run'}
                      </button>
                      {agentExecByActivity?.[node.id] && (() => {
                        const ex = agentExecByActivity[node.id];
                        const statusColor = ex.status === 'SUCCESS' ? '#065f46' : ex.status === 'FAILED' ? '#b91c1c' : '#92400e';
                        const statusBg = ex.status === 'SUCCESS' ? '#d1fae5' : ex.status === 'FAILED' ? '#fef2f2' : '#fef3c7';
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: statusBg, color: statusColor }}>{ex.status}</span>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                              {ex.agentName} {ex.completedAt ? new Date(ex.completedAt).toLocaleString() : ''} {ex.durationMs != null ? `(${ex.durationMs}ms)` : ''}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
              {/* Task fields — required skills */}
              {node.level === 'TASK' && (
                <SkillPicker compact orgId={node.orgIds?.[0]} selectedSkillIds={node.requiredSkillIds || []} onChange={(ids) => onUpdate(node.id, { requiredSkillIds: ids })} disabled={isLocked} label="Required Skills" />
              )}
            </div>
          )}
          {/* Structured Inputs / Outputs panel — shows mapped data assets with owner info */}
          {isExpanded && node.level !== 'VALUE_STREAM' && (
            <IOPanel
              nodeId={node.id}
              mappings={mappingsByStep[node.id] || []}
              assetsList={assetsList}
              disabled={isLocked}
              onAdd={onAddMapping}
              onRemove={onRemoveMapping}
            />
          )}
          {/* Attachments panel — docs, diagrams, external links */}
          {isExpanded && (
            <AttachmentsPanel
              entityType="ProcessNode"
              entityId={node.id}
              orgId={node.orgIds?.[0]}
              disabled={isLocked}
            />
          )}
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

        {/* Status — with confirmation */}
        {pendingStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fffbeb', border: '1px solid #f59e0b44', borderRadius: 4, padding: '2px 6px' }}>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
              {node.status} {'\u2192'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[pendingStatus]?.color || '#64748b' }}>
              {pendingStatus}
            </span>
            <button onClick={() => { onUpdate(node.id, { status: pendingStatus }); setPendingStatus(null); }}
              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 3, padding: '1px 6px', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>
              Save
            </button>
            <button onClick={() => setPendingStatus(null)}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 6px', fontSize: 9, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              Cancel
            </button>
          </div>
        ) : (
          <select value={node.status} onChange={(e) => {
              if (e.target.value === node.status) return;
              setPendingStatus(e.target.value);
            }}
            style={{ ...inputStyle, width: 'auto', fontSize: 10, padding: '1px 4px',
              background: statusColors[node.status]?.bg || '#f1f5f9',
              color: statusColors[node.status]?.color || '#64748b', fontWeight: 600, border: 'none',
            }}>
            <option value={node.status}>{node.status.replace('_', ' ')}</option>
            {(STATUS_TRANSITIONS[node.status] || []).map((s) => {
              const blocked = (s === 'ACTIVE' || s === 'APPROVED') && !canBeActive;
              return (
                <option key={s} value={s} disabled={blocked}>
                  {s.replace('_', ' ')}{blocked ? ' (incomplete)' : ''}
                </option>
              );
            })}
          </select>
        )}

        {/* Actions — smart + button */}
        {/* Reorder buttons */}
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
          {siblingIndex > 0 ? (
            <button style={{ ...btnIcon, fontSize: 10, padding: '0 4px', lineHeight: 1, color: 'var(--color-text-muted)' }}
              onClick={() => onReorder(node.id, 'up')} title="Move up">{'\u25B2'}</button>
          ) : (
            <span style={{ display: 'inline-block', width: 22, height: 14 }} />
          )}
          {siblingIndex < siblingCount - 1 ? (
            <button style={{ ...btnIcon, fontSize: 10, padding: '0 4px', lineHeight: 1, color: 'var(--color-text-muted)' }}
              onClick={() => onReorder(node.id, 'down')} title="Move down">{'\u25BC'}</button>
          ) : (
            <span style={{ display: 'inline-block', width: 22, height: 14 }} />
          )}
        </span>

        {/* Tags display */}
        {nodeTags.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            {nodeTags.map((t) => (
              <span key={t.id} onClick={() => onRemoveTag(t.id)} title="Click to remove tag"
                style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 500, background: '#e0e7ff', color: '#3730a3', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {t.tag} x
              </span>
            ))}
          </span>
        )}

        {/* Tag add button / input */}
        {showTagInput ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <input autoFocus style={{ ...inputStyle, width: 80, fontSize: 10, padding: '1px 4px' }}
              placeholder="tag..."
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagDraft.trim()) { onAddTag(node.id, tagDraft.trim()); setTagDraft(''); setShowTagInput(false); }
                if (e.key === 'Escape') { setTagDraft(''); setShowTagInput(false); }
              }}
              onBlur={() => { if (tagDraft.trim()) { onAddTag(node.id, tagDraft.trim()); } setTagDraft(''); setShowTagInput(false); }}
            />
          </span>
        ) : (
          <button style={{ ...btnIcon, fontSize: 9, color: '#6366f1' }} onClick={() => setShowTagInput(true)} title="Add tag">tag+</button>
        )}

        {canAddChildren && !isLocked && (
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
        <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-text-muted)' }} onClick={() => onShowHistory(node.id)} title="Version History">Hist</button>
        {node.level === 'VALUE_STREAM' && (
          <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-text-muted)' }} onClick={() => onClone(node.id)} title="Clone Value Stream">Clone</button>
        )}
        {!isLocked && (
          <button style={{ ...btnIcon, color: 'var(--color-error)', fontSize: 14 }} onClick={() => onDelete(node.id)} title="Delete">&times;</button>
        )}
      </div>

      {/* Children */}
      {isExpanded && (node.children || []).map((child, idx, arr) => (
        <TreeNode key={child.id} node={child} depth={depth + 1}
          onUpdate={onUpdate} onDelete={onDelete} onClone={onClone} onAddChild={onAddChild}
          expanded={expanded} toggleExpand={toggleExpand}
          selectedIds={selectedIds} toggleSelect={toggleSelect}
          validChildrenMap={validChildrenMap} flows={flows}
          siblingIndex={idx} siblingCount={arr.length} onReorder={onReorder}
          onShowHistory={onShowHistory}
          allTags={allTags}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          peopleList={peopleList}
          assetsList={assetsList}
          mappingsByStep={mappingsByStep}
          onAddMapping={onAddMapping}
          onRemoveMapping={onRemoveMapping}
          statusMode={statusMode}
          agentExecByActivity={agentExecByActivity}
          onRunAgent={onRunAgent}
          runningActivity={runningActivity}
          hasAgentRoles={hasAgentRoles} />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function ProcessCatalogPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, activeOrgType, canCreateValueStreams } = useOrgContext();
  const { canWrite, canContribute } = usePermissions();
  const addToast = useToastStore((s) => s.addToast);
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [validChildrenMap, setValidChildrenMap] = useState<Record<string, string[]>>({});
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [bulkOwnerOpen, setBulkOwnerOpen] = useState(false);
  const [bulkOwnerValue, setBulkOwnerValue] = useState('');
  const [confirmGovTemplate, setConfirmGovTemplate] = useState(false);
  const [allTags, setAllTags] = useState<TagEntry[]>([]);
  const [peopleList, setPeopleList] = useState<PersonRef[]>([]);
  const [assetsList, setAssetsList] = useState<DataAssetRef[]>([]);
  const [mappingsByStep, setMappingsByStep] = useState<Record<string, MappingInfo[]>>({});
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [showLevelGuide, setShowLevelGuide] = useState(false);

  // Agent execution state
  interface AgentExecutionInfo { id: string; agentId: string; agentName: string; activityId: string; status: string; completedAt: string | null; durationMs: number | null; createdAt: string; }
  interface DamaRoleInfo { agentId: string; agentName: string | null; roleType: string; }
  const [agentExecByActivity, setAgentExecByActivity] = useState<Record<string, AgentExecutionInfo>>({});
  const [damaAgentRoles, setDamaAgentRoles] = useState<DamaRoleInfo[]>([]);
  const [runningActivity, setRunningActivity] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [catalogRes, flowsRes, tagsRes, peopleRes, assetsRes, mappingsRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>(`/process-catalog${qp}`),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
        apiClient.get<{ success: boolean; data: TagEntry[] }>(`/tags?entityType=ProcessNode${activeOrgId ? `&orgId=${activeOrgId}` : ''}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataAssetRef[] }>(`/data-assets${qp}`),
        apiClient.get<{ success: boolean; data: MappingInfo[] }>(`/mappings${qp}`),
      ]);
      const byStep: Record<string, MappingInfo[]> = {};
      for (const m of (mappingsRes.data || [])) {
        if (!byStep[m.processStepId]) byStep[m.processStepId] = [];
        byStep[m.processStepId].push(m);
      }
      setMappingsByStep(byStep);
      setTree(catalogRes.tree || []);
      setStats(catalogRes.stats || {});
      setValidChildrenMap(catalogRes.validChildren || {});
      setFlows(flowsRes.data || []);
      setAllTags(tagsRes.data || []);
      setPeopleList((peopleRes.data || []).map((p: any) => ({ id: p.id, name: p.name })));
      setAssetsList((assetsRes.data || []).map((a: any) => ({ id: a.id, name: a.name })));
      // Fetch agent executions and DAMA roles for agent-assigned activities
      try {
        const [execsRes, rolesRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: AgentExecutionInfo[] }>(`/agent-executions${qp}`),
          apiClient.get<{ success: boolean; data: DamaRoleInfo[] }>(`/dama-roles${qp}`),
        ]);
        // Build lookup: activityId -> latest execution
        const byActivity: Record<string, AgentExecutionInfo> = {};
        for (const ex of (execsRes.data || [])) {
          if (!byActivity[ex.activityId] || new Date(ex.createdAt) > new Date(byActivity[ex.activityId].createdAt)) {
            byActivity[ex.activityId] = ex;
          }
        }
        setAgentExecByActivity(byActivity);
        setDamaAgentRoles((rolesRes.data || []).filter((r: any) => r.agentId).map((r: any) => ({ agentId: r.agentId, agentName: r.agentName, roleType: r.roleType })));
      } catch { /* agent execution data is optional */ }
      // Resolve org's statusMode
      if (activeOrgId) {
        try {
          const orgRes = await apiClient.get<{ success: boolean; data: { statusMode?: string } }>(`/organizations/${activeOrgId}`);
          setStatusMode((orgRes.data?.statusMode as 'simple' | 'advanced') || 'simple');
        } catch { /* */ }
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  usePolling(fetchData, 30000);

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
    addToast('success', `${level.replace('_', ' ')} "${name}" created`);
    setAddingTo(null);
    fetchData();
  };

  const updateNode = async (id: string, data: Record<string, any>) => {
    // Look up current version from tree for optimistic locking
    const node = findNodeInTree(tree, id);
    const payload = node?.version !== undefined ? { ...data, version: node.version } : data;
    try {
      await apiClient.put(`/process-catalog/nodes/${id}`, payload);
      addToast('success', 'Saved');
      fetchData();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        addToast('error', 'Modified by another user — refreshing');
        fetchData();
      } else {
        addToast('error', 'Failed to save');
        throw err;
      }
    }
  };

  const deleteNode = async (id: string) => {
    await apiClient.delete(`/process-catalog/nodes/${id}`);
    addToast('success', 'Process node deleted');
    fetchData();
  };

  const cloneNode = async (id: string) => {
    const node = findNodeInTree(tree, id);
    const name = prompt(`Clone "${node?.name || 'Value Stream'}" as:`, `${node?.name || 'Value Stream'} (copy)`);
    if (!name) return;
    try {
      const res = await apiClient.post<{ success: boolean; data: ProcessNode[]; message?: string }>(`/process-catalog/nodes/${id}/clone`, { name });
      addToast('success', res.message || 'Value stream cloned');
      fetchData();
    } catch {
      addToast('error', 'Failed to clone value stream');
    }
  };

  const addMapping = async (nodeId: string, assetId: string, linkType: string) => {
    try {
      await apiClient.post('/mappings', {
        processStepId: nodeId,
        dataAssetId: assetId,
        linkType,
        notes: '',
        aiSuggested: false,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      });
      fetchData();
    } catch { /* */ }
  };

  const removeMapping = async (mappingId: string) => {
    try {
      await apiClient.delete(`/mappings/${mappingId}`);
      fetchData();
    } catch { /* */ }
  };

  // ── Agent execution handler ──
  const handleRunAgent = async (activityId: string, activityName: string) => {
    // Find an agent assigned to any DAMA role
    if (damaAgentRoles.length === 0) { addToast('error', 'No agents assigned to DAMA roles'); return; }
    const agentRole = damaAgentRoles[0]; // Use first available agent
    setRunningActivity(activityId);
    try {
      await apiClient.post('/agent-executions', {
        orgId: activeOrgId,
        agentId: agentRole.agentId,
        agentName: agentRole.agentName,
        activityId,
        activityName,
        roleType: agentRole.roleType,
      });
      addToast('success', `Agent "${agentRole.agentName}" executed activity`);
      fetchData();
    } catch (err: any) {
      const msg = err?.message || 'Execution failed';
      addToast('error', msg);
    } finally {
      setRunningActivity(null);
    }
  };

  // ── Bulk select handlers ──
  const collectAllNodeIds = (nodes: ProcessNode[]): string[] => {
    const ids: string[] = [];
    function walk(arr: ProcessNode[]) {
      for (const n of arr) { ids.push(n.id); if (n.children) walk(n.children); }
    }
    walk(nodes);
    return ids;
  };
  const toggleNodeSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allNodeIds = collectAllNodeIds(tree);
  const toggleSelectAllNodes = () => {
    if (selectedIds.size === allNodeIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(allNodeIds));
  };
  const handleBulkDeleteNodes = async () => {
    if (selectedIds.size === 0) return;
    // Delete sequentially. The backend cascades children, so a parent
    // delete may make later sibling/child deletes 404 — swallow those.
    let failures = 0;
    for (const id of Array.from(selectedIds)) {
      try { await apiClient.delete(`/process-catalog/nodes/${id}`); }
      catch { failures++; }
    }
    setSelectedIds(new Set());
    fetchData();
    if (failures > 0) {
      // Most failures are "already deleted by cascade" so demote to info.
      // eslint-disable-next-line no-console
      console.info(`${failures} delete(s) skipped — likely already removed by cascade.`);
    }
  };

  const handleBulkStatus = async () => {
    if (selectedIds.size === 0 || !bulkStatusValue) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) =>
        apiClient.put(`/process-catalog/nodes/${id}`, { status: bulkStatusValue }).catch(() => {})
      ));
      addToast('success', `Set ${selectedIds.size} node${selectedIds.size === 1 ? '' : 's'} to ${bulkStatusValue}`);
      setBulkStatusOpen(false);
      setBulkStatusValue('');
      setSelectedIds(new Set());
      fetchData();
    } catch { addToast('error', 'Bulk status change failed'); }
  };

  const handleBulkOwner = async () => {
    if (selectedIds.size === 0 || !bulkOwnerValue) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) =>
        apiClient.put(`/process-catalog/nodes/${id}`, { ownerId: bulkOwnerValue }).catch(() => {})
      ));
      const name = peopleList.find((p) => p.id === bulkOwnerValue)?.name || '';
      addToast('success', `Set ${name} as owner of ${selectedIds.size} node${selectedIds.size === 1 ? '' : 's'}`);
      setBulkOwnerOpen(false);
      setBulkOwnerValue('');
      setSelectedIds(new Set());
      fetchData();
    } catch { addToast('error', 'Bulk owner assignment failed'); }
  };

  const reorderNode = async (nodeId: string, direction: 'up' | 'down') => {
    // Find the node and its siblings in the tree
    function findSiblings(nodes: ProcessNode[]): ProcessNode[] | null {
      for (const n of nodes) {
        if (n.id === nodeId) return nodes;
        if (n.children) {
          const found = findSiblings(n.children);
          if (found) return found;
        }
      }
      return null;
    }
    const siblings = findSiblings(tree);
    if (!siblings) return;
    const idx = siblings.findIndex((n) => n.id === nodeId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const current = siblings[idx];
    const swap = siblings[swapIdx];
    // Swap orderIndex values (include version for optimistic locking)
    try {
      await Promise.all([
        apiClient.put(`/process-catalog/nodes/${current.id}`, {
          orderIndex: swap.orderIndex,
          ...(current.version !== undefined ? { version: current.version } : {}),
        }),
        apiClient.put(`/process-catalog/nodes/${swap.id}`, {
          orderIndex: current.orderIndex,
          ...(swap.version !== undefined ? { version: swap.version } : {}),
        }),
      ]);
      fetchData();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        alert('This item was modified by another user. The page will refresh.');
        fetchData();
      } else {
        throw err;
      }
    }
  };

  const showHistory = (nodeId: string) => { setHistoryNodeId(nodeId); };

  const addTag = async (nodeId: string, tag: string) => {
    try {
      await apiClient.post('/tags', { entityType: 'ProcessNode', entityId: nodeId, tag, orgId: activeOrgId });
      fetchData();
    } catch { /* duplicate or error */ }
  };

  const removeTag = async (tagId: string) => {
    try {
      await apiClient.delete(`/tags/${tagId}`);
      fetchData();
    } catch { /* */ }
  };

  const byLevel = stats.byLevel || {};
  const totalNodes = stats.total || 0;
  const issues = collectIssues(tree);

  // Governance maturity stats: recursively count nodes, owners, and active status
  const governanceStats = (() => {
    let total = 0;
    let withOwners = 0;
    let active = 0;
    const walk = (nodes: ProcessNode[]) => {
      for (const n of nodes) {
        total++;
        if (n.ownerId) withOwners++;
        if (n.status === 'ACTIVE') active++;
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return { total, withOwners, active };
  })();

  const handleExportExcel = () => {
    const rows: string[][] = [];
    const walk = (nodes: ProcessNode[], ancestors: string[]) => {
      for (const node of nodes) {
        const path = [...ancestors, node.name];
        const cols: string[] = [];
        const levelIdx = ['VALUE_STREAM', 'PROCESS', 'SUBPROCESS', 'ACTIVITY', 'TASK'].indexOf(node.level);
        for (let i = 0; i < 5; i++) cols.push(i === levelIdx ? node.name : (i < levelIdx ? (path[i] || '') : ''));
        cols.push(node.level, node.status, node.description || '', node.responsibleRole || '', node.frequency || '');
        rows.push(cols);
        if (node.children?.length) walk(node.children, path);
      }
    };
    walk(tree, []);
    exportCsv(
      'process-hierarchy.csv',
      ['Value Stream', 'Process', 'Sub-Process', 'Activity', 'Task', 'Level', 'Status', 'Description', 'Responsible Role', 'Frequency'],
      rows,
    );
    addToast('success', `Exported ${rows.length} process nodes`);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
            <HelpPopover id="process-catalog-overview" title="Process hierarchy">
              The required path is Value Stream → Process → Activity. Optional
              levels (Domain, Capability, Sub-Process, Task) sit between for
              detail when you need it. A Value Stream can't go ACTIVE until at
              least one Process and one Activity exist underneath.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Define your business processes. Required path: <strong>Value Stream</strong> → <strong>Process</strong> → <strong>Activity</strong>
          </p>
        </div>
        {canCreateValueStreams && (
          <div style={{ display: 'flex', gap: 6 }}>
            {totalNodes > 0 && (
              <IconButton icon="download" label="Export to Excel (CSV)"
                onClick={handleExportExcel} />
            )}
            {totalNodes > 0 && (
              <IconButton icon="eye" label="Visualize"
                onClick={() => navigate('/processes/visualization')} />
            )}
            {(byLevel.VALUE_STREAM || 0) >= 2 && (
              <IconButton icon="refresh" label="Compare value streams"
                onClick={() => navigate('/processes/compare')} />
            )}
            {canWrite && (
              <IconButton icon="settings"
                label="Generate from industry template"
                onClick={() => navigate('/processes/wizard')} />
            )}
            {canWrite && (
              <IconButton icon="users"
                variant="secondary"
                label={
                  tree.some((n) => n.name.includes('Governance') || n.name.includes('Data Management'))
                    ? 'Governance processes already exist'
                    : 'Generate governance processes'
                }
                disabled={tree.some((n) => n.name.includes('Governance') || n.name.includes('Data Management'))}
                onClick={() => setConfirmGovTemplate(true)}
              />
            )}
            {canContribute && (
              <IconButton icon="plus" label="Add value stream" variant="primary"
                onClick={() => setAddingTo('__root__')} />
            )}
          </div>
        )}
        {totalNodes > 0 && !canCreateValueStreams && (
          <div style={{ display: 'flex', gap: 6 }}>
            <IconButton icon="eye" label="Visualize"
              onClick={() => navigate('/processes/visualization')} />
            {(byLevel.VALUE_STREAM || 0) >= 2 && (
              <IconButton icon="refresh" label="Compare value streams"
                onClick={() => navigate('/processes/compare')} />
            )}
          </div>
        )}
      </div>

      {governanceStats.total > 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span>{governanceStats.total} items</span>
          <span style={{ color: 'var(--color-border)' }}>&middot;</span>
          <span>{governanceStats.withOwners} with owners</span>
          <span style={{ color: 'var(--color-border)' }}>&middot;</span>
          <span>{governanceStats.active} active</span>
        </div>
      )}

      <ConfirmDialog
        open={confirmGovTemplate}
        title="Generate Governance Processes?"
        message="This will create a 'Data Governance Management' value stream with 6 processes and 31 activities, each with DAMA-aligned roles, inputs, and outputs. You can customize everything after creation."
        confirmLabel="Generate"
        variant="primary"
        onConfirm={async () => {
          setConfirmGovTemplate(false);
          try {
            const res = await apiClient.post<{ success: boolean; message?: string }>('/process-catalog/apply-governance-template', { orgId: activeOrgId || undefined });
            addToast('success', res.message || 'Governance processes created');
            fetchData();
          } catch { addToast('error', 'Failed to generate governance processes'); }
        }}
        onCancel={() => setConfirmGovTemplate(false)}
      />

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
                {config.icon} {count} {count === 1 ? config.label : config.plural}
                {config.required && <span style={{ fontSize: 8 }}>*</span>}
              </div>
            );
          })}
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>* = required</span>
          <button
            onClick={() => setShowLevelGuide(!showLevelGuide)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-primary)', marginLeft: 'auto', padding: 0 }}
          >
            {showLevelGuide ? 'Hide' : 'What do these levels mean?'}
          </button>
        </div>
      )}
      {showLevelGuide && totalNodes > 0 && (
        <div style={{
          background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
          padding: '12px 16px', marginBottom: 12, fontSize: 12, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#1e40af' }}>Process Hierarchy Guide</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><strong>Value Stream *</strong> — A major end-to-end business flow, like "Customer Onboarding" or "Order Fulfillment."</div>
            <div><strong>Process *</strong> — A specific procedure within a value stream, like "Verify Identity" or "Generate Invoice."</div>
            <div><strong>Activity *</strong> — A concrete unit of work with clear inputs and outputs, like "Run credit check" or "Send welcome email."</div>
            <div><strong>Sub-Process</strong> — Optional grouping of related activities within a process.</div>
            <div><strong>Domain / Capability</strong> — Optional higher-level groupings for large organizations.</div>
            <div><strong>Task / Execution</strong> — Optional granular detail or system-level steps within an activity.</div>
          </div>
          <div style={{ fontSize: 11, color: '#1e40af', marginTop: 8 }}>
            Start by adding a Value Stream, then add Processes inside it, then Activities inside those. The other levels are optional.
          </div>
        </div>
      )}

      {/* Toolbar */}
      {tree.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={allNodeIds.length > 0 && selectedIds.size === allNodeIds.length}
              onChange={toggleSelectAllNodes}
            />
            Select all
          </label>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            Click any name or description to edit. Optional levels can be added at any time.
          </span>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setBulkStatusOpen(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Set Status…
          </button>
          <button
            onClick={() => setBulkOwnerOpen(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Set Owner…
          </button>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>
            Note: deleting a parent removes its descendants too.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Process Nodes?"
        message={`Delete ${selectedIds.size} selected process nodes and any descendants? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDeleteNodes(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk Status Dialog */}
      <ConfirmDialog
        open={bulkStatusOpen}
        title={`Set status for ${selectedIds.size} process node${selectedIds.size === 1 ? '' : 's'}`}
        message=""
        confirmLabel={bulkStatusValue ? `Set to ${bulkStatusValue}` : 'Select a status'}
        variant="primary"
        onConfirm={handleBulkStatus}
        onCancel={() => { setBulkStatusOpen(false); setBulkStatusValue(''); }}
      >
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            This will change the status for all selected nodes. Status lifecycle rules are bypassed for bulk operations.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['DRAFT', 'ACTIVE', 'DEPRECATED'].map((s) => (
              <label key={s} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                background: bulkStatusValue === s ? '#eff6ff' : 'var(--color-bg)',
                border: `1px solid ${bulkStatusValue === s ? '#93c5fd' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
              }}>
                <input type="radio" name="bulkProcStatus" checked={bulkStatusValue === s} onChange={() => setBulkStatusValue(s)} />
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s === 'ACTIVE' ? '#22c55e' : s === 'DEPRECATED' ? '#ef4444' : '#9ca3af' }} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
              </label>
            ))}
          </div>
        </div>
      </ConfirmDialog>

      {/* Bulk Owner Dialog */}
      <ConfirmDialog
        open={bulkOwnerOpen}
        title={`Set owner for ${selectedIds.size} process node${selectedIds.size === 1 ? '' : 's'}`}
        message=""
        confirmLabel={bulkOwnerValue ? 'Set Owner' : 'Select a person'}
        variant="primary"
        onConfirm={handleBulkOwner}
        onCancel={() => { setBulkOwnerOpen(false); setBulkOwnerValue(''); }}
      >
        <div style={{ marginTop: 8 }}>
          <select
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', appearance: 'auto' as any }}
            value={bulkOwnerValue}
            onChange={(e) => setBulkOwnerValue(e.target.value)}
          >
            <option value="">-- Select person --</option>
            {peopleList.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
          </select>
        </div>
      </ConfirmDialog>

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

      {/* Ownership gap warning */}
      {tree.length > 0 && (() => {
        const countAll = (nodes: any[]): number => nodes.reduce((s: number, n: any) => s + 1 + countAll(n.children || []), 0);
        const countOwnerless = (nodes: any[]): number => nodes.reduce((s: number, n: any) => s + (!n.ownerId && ['VALUE_STREAM', 'PROCESS'].includes(n.level) ? 1 : 0) + countOwnerless(n.children || []), 0);
        const ownerless = countOwnerless(tree);
        if (ownerless === 0) return null;
        return (
          <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 'var(--radius-md)', background: '#fef2f2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#991b1b' }}>
            <span style={{ fontWeight: 700 }}>{ownerless}</span> value stream{ownerless !== 1 ? 's' : ''} or process{ownerless !== 1 ? 'es have' : ' has'} no owner assigned
          </div>
        );
      })()}

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
          <SkeletonRows rows={5} columns={4} />
        ) : tree.length === 0 && addingTo !== '__root__' ? (
          <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Get started with your process hierarchy</h2>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
                Every process in Procela follows a simple required path:
              </p>
            </div>

            {/* Visual guide */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              {(['VALUE_STREAM', 'PROCESS', 'ACTIVITY'] as NodeLevel[]).map((level, i) => {
                const config = LEVEL_CONFIG[level];
                const examples: Record<string, string> = {
                  VALUE_STREAM: 'e.g. "Customer Onboarding," "Order Fulfillment"',
                  PROCESS: 'e.g. "Verify Identity," "Generate Invoice"',
                  ACTIVITY: 'e.g. "Check credit score," "Send confirmation email"',
                };
                return (
                  <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      background: config.bg, color: config.color, borderRadius: 8,
                      padding: '12px 16px', textAlign: 'center', minWidth: 140,
                      border: `2px solid ${config.color}44`,
                    }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{config.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{config.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{config.hint.split('.')[0]}</div>
                      <div style={{ fontSize: 10, fontStyle: 'italic', opacity: 0.7, marginTop: 4 }}>{examples[level]}</div>
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
          tree.map((node, idx) => (
            <TreeNode key={node.id} node={node} depth={0}
              onUpdate={updateNode} onDelete={deleteNode} onClone={cloneNode}
              onAddChild={(parentId) => setAddingTo(parentId)}
              expanded={expanded} toggleExpand={toggleExpand}
              selectedIds={selectedIds} toggleSelect={toggleNodeSelect}
              validChildrenMap={validChildrenMap} flows={flows}
              siblingIndex={idx} siblingCount={tree.length} onReorder={reorderNode}
              onShowHistory={showHistory}
              allTags={allTags}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              peopleList={peopleList}
              assetsList={assetsList}
              mappingsByStep={mappingsByStep}
              onAddMapping={addMapping}
              onRemoveMapping={removeMapping}
              statusMode={statusMode}
              agentExecByActivity={agentExecByActivity}
              onRunAgent={handleRunAgent}
              runningActivity={runningActivity}
              hasAgentRoles={damaAgentRoles.length > 0} />
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

      {historyNodeId && (
        <VersionHistoryModal nodeId={historyNodeId} onClose={() => setHistoryNodeId(null)} />
      )}
    </div>
  );
}
