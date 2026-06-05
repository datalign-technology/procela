import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Bot, Check, AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import { tierLabel } from '../lib/governanceTier';
import { badgeColor } from '../lib/badgeColors';
import { useOrgContext } from '../stores/orgContext';
import { useValueStreamScope } from '../hooks/useValueStreamScope';
import { useOrgNameLookup } from '../hooks/useOrgNameLookup';
import { usePolling } from '../hooks/usePolling';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import HelpPopover from '../components/HelpPopover';
import AttachmentsPanel from '../components/AttachmentsPanel';
import PersonPicker from '../components/PersonPicker';
import DomainLensToggle from '../components/DomainLensToggle';
import DomainLensActiveBanner from '../components/DomainLensActiveBanner';
import { GOVERNANCE_ROLES } from '../types';
import { useDomainLensStore, useDomainLens, passesLens } from '../stores/domainLensStore';
import { processDomain } from '../lib/entityDomain';
import CommentsPanel from '../components/CommentsPanel';
import ActivityFeed from '../components/ActivityFeed';
import CollapsibleSection from '../components/CollapsibleSection';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import ExportMenu from '../components/ExportMenu';
import { ExportPayload } from '../lib/export';
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
  responsiblePersonId?: string | null;
  statusJustification?: string;
  frequency?: string;
  riskLevel?: string;
  automationLevel?: string;
  estimatedDuration?: string;
  requiredSkillIds?: string[];
  /** First-class link to the systems this step (or higher-level node)
   *  runs on. Captures step→system independently of the data-asset
   *  mappings, so a step on a system without a mapped asset is still
   *  surfaced. */
  systemIds?: string[];
  domain?: 'GOVERNANCE' | 'OPERATIONAL';
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

// Buckets for Est. Duration on activities. A fixed list keeps reports
// comparable across activities (and across organisations) instead of
// the previous free-text mix of "2 hrs", "couple hours", "120 minutes",
// "half a day"… If a node already has a legacy free-text value the
// use-site appends it to the options so it stays selectable until
// edited.
const DURATION_OPTIONS = [
  '< 5 minutes',
  '5–15 minutes',
  '15–30 minutes',
  '30 minutes – 1 hour',
  '1–2 hours',
  '2–4 hours',
  '4–8 hours',
  '1 day',
  '1–2 days',
  '2–5 days',
  '1–2 weeks',
  '2–4 weeks',
  '1–3 months',
  '3+ months',
];

const ROLE_OPTIONS = [
  'Process Owner', 'Process Manager', 'Business Analyst', 'Data Analyst',
  'System Administrator', 'End User', 'Supervisor', 'Technician',
  'Customer Service Rep', 'Finance Analyst', 'Compliance Officer',
  'Operations Manager', 'IT Support', 'Quality Analyst', 'Other',
];

interface PersonRef { id: string; name: string; }
interface DataAssetRef { id: string; name: string; orgId?: string }
interface SystemRef { id: string; name: string; systemType?: string; }
interface PolicyRef { id: string; name: string; code: string; documentType: string; orgId?: string }
interface MappingInfo {
  id: string;
  processStepId: string;
  // Exactly one of these three is set per mapping row. dataAssetId
  // is the operational case (asset I/O); policyId is the governance
  // case (charter / policy / standard the activity produces or
  // consumes); attachmentId is an uploaded file or URL bound to
  // the activity.
  dataAssetId?: string;
  policyId?: string;
  attachmentId?: string;
  linkType: string;
  criticality?: string;
  dataFormat?: string;
  sla?: string;
  qualityRequirement?: string;
  /** When set, this mapping was created by clicking "Link…" next to a
   *  specific expected input/output placeholder (parsed from the node's
   *  free-text inputsOutputs field). The expected row uses this as a
   *  durable association so the visible label can stay e.g. "Business
   *  strategy" while the linked entity is "Q4 Strategy Plan.pdf",
   *  bypassing the fuzzy substring match. */
  fulfillsExpected?: string;
  assetInfo: { assetId: string; assetName: string; ownerName: string | null; stewardName: string | null; governanceTier: string; healthScore: number } | null;
  policyInfo: { policyId: string; policyName: string; policyCode: string; documentType: string; status: string } | null;
  attachmentInfo: { attachmentId: string; name: string; type: 'FILE' | 'URL'; fileName?: string; url?: string; mimeType?: string; fileSize?: number } | null;
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

// ── Person field — inline label + shared PersonPicker. Replaces the
//    flat name-only Owner dropdown / Stakeholders multiselect so users
//    get org-tree / group / search context and name disambiguation.
//    Owner stores ownerId (valueMode="id"); Stakeholders keeps the
//    legacy comma-joined *name* string (valueMode="name") so no data
//    migration is needed. ──

function DocPersonField({ label, mode, valueMode, value, onChange, disabled, domain, eligibleKeys, disabledHint, disabledHintLink, placeholder }: {
  label: string;
  mode: 'single' | 'multi';
  valueMode: 'id' | 'name';
  value: string | string[] | null;
  onChange: (v: any) => void;
  disabled: boolean;
  domain?: 'GOVERNANCE' | 'OPERATIONAL';
  /** If provided, restrict the picker's options to these keys (ids or
   *  names, matching valueMode). Used to gate selection to role-holders
   *  on governance work. */
  eligibleKeys?: Set<string>;
  /** Hint rendered next to the picker when `disabled` is true — e.g.
   *  explains why a Responsible Person picker is locked until a role
   *  is set or until someone holds that role. */
  disabledHint?: string;
  /** Optional in-place link rendered next to the disabled hint so the
   *  user can resolve the gap (open Governance Roles, etc.) without
   *  hunting through the sidebar. */
  disabledHintLink?: { to: string; label: string };
  /** Overrides the default trigger placeholder. */
  placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 7 }}>{label}:</span>
      <div style={{ flex: 1, maxWidth: 320 }}>
        <PersonPicker
          mode={mode}
          valueMode={valueMode}
          value={value}
          onChange={onChange}
          disabled={disabled}
          domain={domain}
          eligibleKeys={eligibleKeys}
          placeholder={placeholder || (mode === 'single' ? 'Select owner…' : 'Select stakeholders…')}
        />
        {disabled && (disabledHint || disabledHintLink) && (
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3, fontStyle: 'italic' }}>
            {disabledHint}
            {disabledHintLink && (
              <>
                {disabledHint ? ' ' : ''}
                <Link to={disabledHintLink.to} style={{ color: 'var(--color-primary)', textDecoration: 'underline', fontStyle: 'normal', fontWeight: 500 }}>
                  {disabledHintLink.label} →
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Domain-scoped Responsible Role selector ──
// Governance nodes only offer the DAMA governance roles; operational
// nodes offer the generic business roles. A "show all" toggle reveals
// the other set for genuine cross-overs; picking a role from the other
// domain tags the field with a visible cross-domain marker. A legacy
// free-text value that's in neither catalog is preserved as a selectable
// option until the user re-picks.
function DocRoleField({ value, onSave, disabled, domain }: {
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
  domain: 'GOVERNANCE' | 'OPERATIONAL';
}) {
  const [showAll, setShowAll] = useState(false);
  const govLabels = GOVERNANCE_ROLES.map((r) => r.label);
  const primary = domain === 'GOVERNANCE' ? govLabels : ROLE_OPTIONS;
  const secondary = domain === 'GOVERNANCE' ? ROLE_OPTIONS : govLabels;

  const inPrimary = !!value && primary.includes(value);
  const inSecondary = !!value && secondary.includes(value);
  const isLegacy = !!value && !inPrimary && !inSecondary;
  // Auto-reveal the full set if the saved value belongs to the other
  // domain (or is legacy) so it stays visible and editable.
  const effectiveShowAll = showAll || inSecondary || isLegacy;

  const options = [
    ...primary,
    ...(effectiveShowAll ? secondary : []),
    ...(isLegacy ? [value] : []),
  ];
  const crossDomain = inSecondary;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>Responsible Role:</span>
      <select
        value={value}
        onChange={(e) => onSave(e.target.value)}
        disabled={disabled}
        style={{
          fontSize: 11, border: '1px solid var(--color-border)', borderRadius: 4,
          background: 'var(--color-surface)', cursor: disabled ? 'default' : 'pointer',
          color: value ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '2px 6px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <option value="">Select role...</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {crossDomain && (
        <span title="This role is outside this process's domain"
          style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: '#fef3c7', color: '#92400e', textTransform: 'uppercase' }}>
          Cross-domain
        </span>
      )}
      {/* Two-way toggle between the primary (domain-matching) role set
         and the full set. The "less" direction is suppressed when the
         currently-saved value lives in the secondary set or is legacy —
         collapsing would hide it from the dropdown. */}
      {!disabled && !effectiveShowAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-primary)', padding: 0, textDecoration: 'underline' }}
        >
          show all roles
        </button>
      )}
      {!disabled && effectiveShowAll && !inSecondary && !isLegacy && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-primary)', padding: 0, textDecoration: 'underline' }}
        >
          show {domain === 'GOVERNANCE' ? 'governance' : 'business'} roles only
        </button>
      )}
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

// ── Systems picker — selects from registered Systems by id ─────────────────
// Distinct from DocMultiSelect because options are id/name pairs, not
// flat strings. Same visual treatment so it nests naturally with the
// other Doc* fields in the node panel.
function DocSystemsField({ selected, options, onSave, disabled }: {
  selected: string[]; options: SystemRef[]; onSave: (ids: string[]) => void; disabled: boolean;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const available = options.filter((o) => !selected.includes(o.id));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 2 }}>Systems:</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', flex: 1 }}>
        {selected.map((id) => {
          const s = byId.get(id);
          return (
            <span key={id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 500,
              background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
            }}>
              {s?.name || id}
              {!disabled && (
                <button onClick={() => onSave(selected.filter((sid) => sid !== id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#1e40af', padding: 0, lineHeight: 1 }}>&times;</button>
              )}
            </span>
          );
        })}
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
            <option value="">{selected.length === 0 ? 'Pick systems this runs on...' : '+ Add system'}</option>
            {available.map((o) => <option key={o.id} value={o.id}>{o.name}{o.systemType ? ` (${o.systemType})` : ''}</option>)}
          </select>
        )}
        {selected.length === 0 && disabled && (
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', opacity: 0.6 }}>No systems linked</span>
        )}
      </div>
    </div>
  );
}

// ── Inputs / Outputs Panel — connects an activity to its inputs
//    and outputs. A row can target one of three kinds:
//      * Data Asset — operational I/O (the legacy case)
//      * Policy / Governance Document — charter, standard, policy
//        the activity produces or consumes (the governance case)
//      * Attachment — an uploaded file or URL bound to this
//        activity (ad-hoc evidence, the actual signed Charter PDF,
//        a process diagram, etc.)
//    The link picker is segmented across the three kinds so the
//    user picks WHAT first, then the specific target.

export type AddMappingTarget = {
  kind: 'asset' | 'policy' | 'attachment';
  id: string;
  /** When the picker was opened from a specific expected input/output
   *  row ("Link…" next to "Business strategy"), this carries the
   *  placeholder name so the new mapping is durably bound to that
   *  slot rather than relying on substring matching. */
  fulfillsExpected?: string;
};

function IOPanel({ nodeId, mappings, assetsList, policiesList, disabled, orgId, isGovernance, onAdd, onRemove, onRestore, nodeInputsOutputs }: {
  nodeId: string;
  mappings: MappingInfo[];
  assetsList: DataAssetRef[];
  policiesList: PolicyRef[];
  disabled: boolean;
  orgId: string;
  // Governance activities never produce or consume operational
  // data assets — their inputs/outputs are documents (charters,
  // policies, standards) and attachments. The Data Asset tab in
  // the picker is hidden for them, and the default add-kind
  // shifts to 'policy'. Asset rows that already exist on a
  // governance node (e.g. legacy data from before this rule)
  // still render — the rule only governs new additions.
  isGovernance: boolean;
  onAdd: (nodeId: string, target: AddMappingTarget, linkType: string) => void;
  onRemove: (mappingId: string) => void;
  /** Recreates the mapping from a snapshot. Wired to the Undo action
   *  on the toast that pops when a user unlinks. */
  onRestore: (snapshot: MappingInfo) => void;
  /** The node's free-text inputsOutputs description, e.g.
   *  "In: business strategy, regulatory requirements. Out: charter."
   *  Parsed into structured placeholder slots so the panel can show
   *  the *expected* inputs/outputs with fulfilled/unfulfilled status. */
  nodeInputsOutputs?: string;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [showAdd, setShowAdd] = useState<'input' | 'output' | null>(null);
  // When the picker was opened from a specific expected I/O row
  // (e.g. the "Link…" button next to "Business strategy"), this holds
  // that placeholder name so the new mapping can be tagged with it.
  // Null when the picker was opened via the generic "+ Add Input /
  // Output" button at the bottom of the panel.
  const [linkingExpected, setLinkingExpected] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<'asset' | 'policy' | 'attachment' | 'link'>(isGovernance ? 'policy' : 'asset');
  const [pickedAsset, setPickedAsset] = useState('');
  const [pickedPolicy, setPickedPolicy] = useState('');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedUrl, setPickedUrl] = useState('');
  const [pickedUrlName, setPickedUrlName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [expandedMapping, setExpandedMapping] = useState<string | null>(null);
  const [localMappings, setLocalMappings] = useState(mappings);
  useEffect(() => { setLocalMappings(mappings); }, [mappings]);

  const inputs = localMappings.filter((m) => m.linkType === 'consumes' || m.linkType === 'references');
  const outputs = localMappings.filter((m) => m.linkType === 'produces');
  const transforms = localMappings.filter((m) => m.linkType === 'transforms');

  // ── Expected inputs / outputs ──
  // The free-text inputsOutputs field is by convention written as
  // "In: a, b, c. Out: x, y, z." Parse it into typed placeholder slots
  // so the panel can show *what's expected* alongside *what's actually
  // linked* — and call out unmet expectations as Required + Unfilled.
  // Matching: case-insensitive substring containment in either direction
  // (a placeholder "business strategy" matches an asset named "Business
  // Strategy 2026" and a doc named "Strategy"). Cheap; false negatives
  // just render as Unfilled and the user can ignore.
  const { expectedInputs, expectedOutputs } = useMemo(() => {
    const raw = nodeInputsOutputs || '';
    const inMatch  = raw.match(/(?:^|[.\n])\s*In:\s*([^.\n]+)/i);
    const outMatch = raw.match(/(?:^|[.\n])\s*Out:\s*([^.\n]+)/i);
    const split = (s: string | undefined) =>
      s ? s.split(/[,;]/).map((p) => p.trim().replace(/\.+$/, '')).filter(Boolean) : [];
    return { expectedInputs: split(inMatch?.[1]), expectedOutputs: split(outMatch?.[1]) };
  }, [nodeInputsOutputs]);

  function findMatches(placeholder: string, candidates: MappingInfo[]): MappingInfo[] {
    const p = placeholder.toLowerCase().trim();
    if (!p) return [];
    const out: MappingInfo[] = [];
    // Explicit bindings first. Any mapping created via "Link…" or
    // "+ Link another" next to this placeholder carries
    // fulfillsExpected; user-asserted matches sort ahead of fuzzy
    // ones and survive the linked entity being renamed.
    for (const m of candidates) {
      if (m.fulfillsExpected && m.fulfillsExpected.toLowerCase().trim() === p) out.push(m);
    }
    // Then fuzzy substring matches on legacy rows and untagged ones
    // added via the generic "+ Add Input/Output" path.
    for (const m of candidates) {
      if (m.fulfillsExpected) continue;
      const name = (m.assetInfo?.assetName || m.policyInfo?.policyName || m.attachmentInfo?.name || '').toLowerCase();
      if (!name) continue;
      if (name.includes(p) || p.includes(name)) out.push(m);
    }
    return out;
  }

  // Linked-entity display name, used in toast copy.
  const entityName = (m: MappingInfo): string =>
    m.assetInfo?.assetName || m.policyInfo?.policyName || m.attachmentInfo?.name || 'this link';

  // Unlink with optimistic remove + 6-second Undo toast. Follows the
  // same pattern as single-item deletes elsewhere in the app (Data
  // Asset, System, Person) — confirms reserved for catastrophic
  // actions; reversible ones get an undo affordance instead.
  const unlinkWithUndo = (m: MappingInfo) => {
    onRemove(m.id);
    addToast('info', `Unlinked "${entityName(m)}"`, {
      action: { label: 'Undo', handler: () => onRestore(m) },
      duration: 6000,
    });
  };

  // Compact inline rendering of a linked mapping's name + type. Used
  // inside the expected-field rows so the linked entity sits next to
  // its placeholder label like a form value. The full row with the
  // expand-to-edit chevron + advanced fields is still rendered for
  // mappings that don't fulfill any expected slot ("Additional…").
  const renderInlineMapping = (m: MappingInfo) => {
    if (m.assetInfo) {
      const tierC = badgeColor('tier', m.assetInfo.governanceTier);
      return (
        <>
          <span style={{ fontWeight: 500 }}>{m.assetInfo.assetName}</span>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: tierC.bg, color: tierC.color }}>
            {tierLabel(m.assetInfo.governanceTier)}
          </span>
        </>
      );
    }
    if (m.policyInfo) {
      return (
        <>
          <a href="/governance-documents" style={{ fontWeight: 500, color: 'var(--color-primary)', textDecoration: 'none' }} title={`${m.policyInfo.documentType} — open Governance Documents`}>
            {m.policyInfo.policyName}
          </a>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{m.policyInfo.policyCode}</span>
          <StatusBadge variant="agent">{m.policyInfo.documentType}</StatusBadge>
        </>
      );
    }
    if (m.attachmentInfo) {
      const isFile = m.attachmentInfo.type === 'FILE';
      const href = isFile ? `/api/v1/attachments/${m.attachmentInfo.attachmentId}/download` : (m.attachmentInfo.url || '#');
      return (
        <>
          <a href={href} target={isFile ? undefined : '_blank'} rel={isFile ? undefined : 'noopener noreferrer'} download={isFile ? (m.attachmentInfo.fileName || m.attachmentInfo.name) : undefined} style={{ fontWeight: 500, color: 'var(--color-primary)', textDecoration: 'none' }}>
            {m.attachmentInfo.name}
          </a>
          <StatusBadge variant="info">{isFile ? 'File' : 'URL'}</StatusBadge>
        </>
      );
    }
    return <span style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Linked target no longer exists</span>;
  };

  // Style for both the empty-state CTA and the "+ Link another" button
  // — kept identical so the act of adding another doc reads as the
  // same affordance whether the slot is empty or already partly filled.
  const linkCtaStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 12px', fontSize: 11, fontWeight: 500,
    background: 'var(--color-surface)', color: 'var(--color-primary)',
    border: '1px dashed var(--color-primary)',
    borderRadius: 3, cursor: 'pointer', width: '100%', justifyContent: 'flex-start',
  };

  const renderExpected = (placeholder: string, kind: 'input' | 'output') => {
    const candidates = kind === 'input' ? inputs : outputs;
    const matches = findMatches(placeholder, candidates);
    const filled = matches.length > 0;
    const label = placeholder.replace(/^\w/, (c) => c.toUpperCase());
    // Stacked form-field layout: the placeholder name + Required badge
    // sits on the top line; each linked entity (or the empty-state CTA)
    // sits on its own line below, indented to read as the field's
    // value(s). A "+ Link another" affordance after the list lets the
    // user pile on more documents under the same slot — the slot reads
    // as a repeating fieldset rather than a single value.
    const openPicker = () => { setLinkingExpected(placeholder); setShowAdd(kind); };
    return (
      <div
        key={`expected-${kind}-${placeholder}`}
        style={{
          fontSize: 11,
          padding: '6px 10px',
          background: filled ? '#f0fdf4' : '#fffbeb',
          border: '1px solid var(--color-border)',
          borderLeft: `3px solid ${filled ? '#22c55e' : '#f59e0b'}`,
          borderRadius: 4,
        }}
      >
        {/* Top line — field label. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
            background: filled ? '#22c55e' : '#f59e0b', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{filled ? <Check size={9} strokeWidth={3.5} /> : <AlertTriangle size={9} strokeWidth={3} />}</span>
          <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
          <StatusBadge variant="danger">Required</StatusBadge>
          {matches.length > 1 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>· {matches.length} linked</span>
          )}
        </div>
        {/* Value lines — one per linked entity, plus the add affordance
            below. paddingLeft 20 keeps everything visually tied to the
            label above. */}
        <div style={{
          marginTop: 4, paddingLeft: 20,
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
        }}>
          {matches.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
              {renderInlineMapping(m)}
              {!disabled && (
                <button
                  onClick={() => unlinkWithUndo(m)}
                  title="Unlink this document"
                  aria-label="Unlink"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '2px 4px', display: 'inline-flex', borderRadius: 3, marginLeft: 'auto' }}
                >
                  <X size={12} strokeWidth={2.2} />
                </button>
              )}
            </div>
          ))}
          {!disabled ? (
            <button
              onClick={openPicker}
              title={filled
                ? `Link another document, asset, or attachment to "${label}"`
                : `Link a document, asset, or attachment to fulfill "${label}"`}
              style={linkCtaStyle}
            >
              {filled ? '+ Link another' : '+ Link document, asset, or attachment'}
            </button>
          ) : !filled ? (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>not yet linked</span>
          ) : null}
        </div>
      </div>
    );
  };

  const resetAdd = () => {
    setPickedAsset(''); setPickedPolicy(''); setPickedFile(null);
    setPickedUrl(''); setPickedUrlName('');
    setShowAdd(null); setAddKind(isGovernance ? 'policy' : 'asset');
    setLinkingExpected(null);
  };

  // Light client-side URL check just to gate the Save button; the backend
  // does the authoritative validation via new URL().
  const isValidUrl = (raw: string): boolean => {
    const v = raw.trim();
    if (!v) return false;
    try { new URL(v); return true; } catch { return false; }
  };

  const handleAdd = async (linkType: string) => {
    // Tag the new mapping with the expected placeholder (if the picker
    // was opened from an expected row's "Link…" button) so the
    // association survives the linked entity being renamed and works
    // even when the names don't substring-match.
    const tag = linkingExpected ? { fulfillsExpected: linkingExpected } : {};
    if (addKind === 'asset') {
      if (!pickedAsset) return;
      onAdd(nodeId, { kind: 'asset', id: pickedAsset, ...tag }, linkType);
      resetAdd();
      return;
    }
    if (addKind === 'policy') {
      if (!pickedPolicy) return;
      onAdd(nodeId, { kind: 'policy', id: pickedPolicy, ...tag }, linkType);
      resetAdd();
      return;
    }
    if (addKind === 'attachment') {
      if (!pickedFile) return;
      setUploading(true);
      try {
        // Upload first, then create the mapping row with the
        // returned attachment id. Two round-trips, but it keeps
        // the mapping store flat (no half-uploaded rows).
        const params = new URLSearchParams({
          entityType: 'ProcessNode',
          entityId: nodeId,
          name: pickedFile.name,
          description: '',
        });
        if (orgId) params.set('orgId', orgId);
        const uploaded = await apiClient.upload<{ success: boolean; data: { id: string } }>(`/attachments/upload?${params.toString()}`, pickedFile);
        const id = uploaded.data?.id;
        if (id) onAdd(nodeId, { kind: 'attachment', id, ...tag }, linkType);
        resetAdd();
      } catch { /* parent toast handles errors */ }
      finally { setUploading(false); }
    }
    if (addKind === 'link') {
      if (!isValidUrl(pickedUrl)) return;
      setUploading(true);
      try {
        // Create a URL-type attachment, then bind it as an I/O row —
        // same two-step flow as the file upload, so the mapping always
        // points at a persisted attachment id.
        const created = await apiClient.post<{ success: boolean; data: { id: string } }>('/attachments/url', {
          entityType: 'ProcessNode',
          entityId: nodeId,
          name: pickedUrlName.trim() || pickedUrl.trim(),
          description: '',
          url: pickedUrl.trim(),
          ...(orgId ? { orgId } : {}),
        });
        const id = created.data?.id;
        if (id) onAdd(nodeId, { kind: 'attachment', id, ...tag }, linkType);
        resetAdd();
      } catch { /* parent toast handles errors */ }
      finally { setUploading(false); }
    }
  };

  const updateMapping = async (mappingId: string, updates: Record<string, any>) => {
    try {
      await apiClient.put(`/mappings/${mappingId}`, updates);
      setLocalMappings((prev) => prev.map((m) => m.id === mappingId ? { ...m, ...updates } : m));
    } catch { /* */ }
  };

  const renderRow = (m: MappingInfo) => {
    // The row presentation depends on which kind of target this
    // mapping points at. Exactly one of *Info fields is set.
    const isExp = expandedMapping === m.id;
    let head: React.ReactNode = null;
    if (m.assetInfo) {
      const tierC = badgeColor('tier', m.assetInfo.governanceTier);
      head = (
        <>
          <span style={{ fontWeight: 500 }}>{m.assetInfo.assetName}</span>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: tierC.bg, color: tierC.color }}>
            {tierLabel(m.assetInfo.governanceTier)}
          </span>
          {m.assetInfo.ownerName && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Owner: {m.assetInfo.ownerName}</span>
          )}
        </>
      );
    } else if (m.policyInfo) {
      head = (
        <>
          <a href="/governance-documents" style={{ fontWeight: 500, color: 'var(--color-primary)', textDecoration: 'none' }} title={`${m.policyInfo.documentType} — open Governance Documents`}>
            {m.policyInfo.policyName}
          </a>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{m.policyInfo.policyCode}</span>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#ede9fe', color: '#5b21b6' }}>
            {m.policyInfo.documentType}
          </span>
        </>
      );
    } else if (m.attachmentInfo) {
      const isFile = m.attachmentInfo.type === 'FILE';
      const href = isFile ? `/api/v1/attachments/${m.attachmentInfo.attachmentId}/download` : (m.attachmentInfo.url || '#');
      head = (
        <>
          <a href={href} target={isFile ? undefined : '_blank'} rel={isFile ? undefined : 'noopener noreferrer'} download={isFile ? (m.attachmentInfo.fileName || m.attachmentInfo.name) : undefined} style={{ fontWeight: 500, color: 'var(--color-primary)', textDecoration: 'none' }}>
            {m.attachmentInfo.name}
          </a>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#dbeafe', color: '#1e40af' }}>
            {isFile ? 'File' : 'URL'}
          </span>
        </>
      );
    } else {
      // Orphaned row — target was deleted out from under it.
      head = <span style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Linked target no longer exists</span>;
    }
    return (
      <div key={m.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', flexWrap: 'wrap' }}>
          <span onClick={() => setExpandedMapping(isExp ? null : m.id)} style={{ cursor: 'pointer', fontSize: 8, color: 'var(--color-text-muted)' }}>
            {isExp ? '▼' : '▶'}
          </span>
          {head}
          {m.criticality && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: m.criticality === 'REQUIRED' ? '#fee2e2' : '#f1f5f9', color: m.criticality === 'REQUIRED' ? '#991b1b' : '#64748b' }}>
              {m.criticality}
            </span>
          )}
          {m.dataFormat && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#e0e7ff', color: '#3730a3' }}>{m.dataFormat}</span>
          )}
          {!disabled && (
            <button onClick={() => unlinkWithUndo(m)}
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
    if (showAdd !== (linkType === 'consumes' ? 'input' : 'output')) {
      return (
        <button onClick={() => setShowAdd(linkType === 'consumes' ? 'input' : 'output')}
          style={{ fontSize: 10, padding: '2px 8px', marginTop: 4, background: 'transparent', border: '1px dashed var(--color-border)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
          + Add {linkType === 'consumes' ? 'Input' : 'Output'}
        </button>
      );
    }
    const canSave = (addKind === 'asset' && !!pickedAsset)
      || (addKind === 'policy' && !!pickedPolicy)
      || (addKind === 'attachment' && !!pickedFile && !uploading)
      || (addKind === 'link' && isValidUrl(pickedUrl) && !uploading);
    return (
      <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Segmented control — pick WHAT kind of target first.
            Governance activities lose the Data Asset tab; their
            I/O is documents and attachments only. */}
        <div role="tablist" aria-label="Link target kind" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden', background: 'var(--color-bg)', alignSelf: 'flex-start' }}>
          {(isGovernance
            ? [
                { value: 'policy',     label: 'Document' },
                { value: 'attachment', label: 'Upload' },
                { value: 'link',       label: 'Link' },
              ] as const
            : [
                { value: 'asset',      label: 'Data Asset' },
                { value: 'policy',     label: 'Document' },
                { value: 'attachment', label: 'Upload' },
                { value: 'link',       label: 'Link' },
              ] as const
          ).map((opt) => {
            const active = addKind === opt.value;
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                onClick={() => setAddKind(opt.value)}
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: active ? 600 : 400,
                  border: 'none', cursor: 'pointer',
                  background: active ? 'var(--color-primary)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-text)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {/* Picker per kind. */}
        {addKind === 'asset' && (
          <select value={pickedAsset} onChange={(e) => setPickedAsset(e.target.value)} autoFocus
            style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}>
            <option value="">-- Select data asset --</option>
            {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {addKind === 'policy' && (
          <select value={pickedPolicy} onChange={(e) => setPickedPolicy(e.target.value)} autoFocus
            style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}>
            <option value="">-- Select governance document --</option>
            {policiesList.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        )}
        {addKind === 'attachment' && (
          <input
            type="file"
            onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
            style={{ fontSize: 11 }}
          />
        )}
        {addKind === 'link' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="url"
              autoFocus
              value={pickedUrl}
              onChange={(e) => setPickedUrl(e.target.value)}
              placeholder="https://… (link to a doc, dashboard, spec)"
              style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
            />
            <input
              type="text"
              value={pickedUrlName}
              onChange={(e) => setPickedUrlName(e.target.value)}
              placeholder="Label (optional — defaults to the URL)"
              style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => handleAdd(linkType)} disabled={!canSave}
            style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 3, cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.5 }}>
            {uploading ? (addKind === 'link' ? 'Saving…' : 'Uploading…') : 'Save'}
          </button>
          <button onClick={resetAdd}
            style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 4, border: '1px solid var(--color-border)' }}>
      {/* The original free-text inputsOutputs prose used to live as an
          editable note above this panel. The structured Expected
          placeholders below now make the prose redundant for action,
          but the prose itself is still useful as *context* — exact
          wording the template used, sentence framing, etc. Surface it
          as a quiet help-tip rather than an input field. */}
      {nodeInputsOutputs && (
        <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>From template</span>
          <HelpPopover id={`io-prose-${nodeId}`} title="Inputs & Outputs (from the template)">
            <p style={{ margin: 0, textTransform: 'none', letterSpacing: 'normal' }}>{nodeInputsOutputs}</p>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 'normal' }}>
              The slots below are parsed from this text. Link an asset, document, or attachment to each expected item to mark it fulfilled.
            </p>
          </HelpPopover>
        </div>
      )}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {(['input', 'output'] as const).map((kind) => {
          const expected = kind === 'input' ? expectedInputs : expectedOutputs;
          const list = kind === 'input' ? inputs : outputs;
          const linkType = kind === 'input' ? 'consumes' : 'produces';
          // Mappings that fulfill an expected slot already render inline
          // inside that slot's row, so don't duplicate them below.
          // Every mapping matched by any expected slot — across all
          // slots, since a slot can hold many — gets folded out of the
          // "Additional" section so it appears in exactly one place.
          const matchedIds = new Set<string>();
          for (const p of expected) {
            for (const m of findMatches(p, list)) matchedIds.add(m.id);
          }
          const extras = list.filter((m) => !matchedIds.has(m.id));
          // A slot counts as filled if it has at least one match —
          // multiplicity within a slot doesn't bump the counter.
          const filledCount = expected.filter((p) => findMatches(p, list).length > 0).length;
          return (
            <div key={kind} style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {kind === 'input' ? 'Inputs' : 'Outputs'} ({list.length}{expected.length > 0 ? ` · ${filledCount} of ${expected.length} expected` : ''})
              </div>
              {expected.length > 0 && (
                <div style={{ marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {expected.map((p) => renderExpected(p, kind))}
                </div>
              )}
              {list.length === 0 && expected.length === 0 && !showAdd && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No {kind}s defined</div>
              )}
              {/* "Additional" — mappings that don't correspond to any
                  expected placeholder. These render as full rows with
                  the expand-to-edit chevron (Criticality / Format /
                  SLA / Quality requirement). Header label only shows
                  when there's at least one extra so the section title
                  doesn't appear empty. */}
              {expected.length > 0 && extras.length > 0 && (
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 2px' }}>
                  Additional
                </div>
              )}
              {extras.map(renderRow)}
              {!disabled && renderAddRow(linkType)}
            </div>
          );
        })}
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

function TreeNode({ node, depth, onUpdate, onDelete, onClone, onAddChild, expanded, toggleExpand, validChildrenMap, flows, siblingIndex, siblingCount, onReorder, onShowHistory, allTags, onAddTag, onRemoveTag, selectedIds, toggleSelect, peopleList, assetsList, policiesList, systemsList, mappingsByStep, activePageOrgId, onAddMapping, onRemoveMapping, onRestoreMapping, statusMode, agentExecByActivity, onRunAgent, onReviewExecution, onPromoteExecution, runningActivity, agentRoles, governanceHolderIds, holdersByRoleLabel, viewMode, ancestorStatusChain, schedulesByActivity, onCreateSchedule, onToggleSchedule, onDeleteSchedule }: {
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
  policiesList: PolicyRef[];
  systemsList: SystemRef[];
  mappingsByStep: Record<string, MappingInfo[]>;
  activePageOrgId: string;
  onAddMapping: (nodeId: string, target: AddMappingTarget, linkType: string) => void;
  onRemoveMapping: (mappingId: string) => void;
  onRestoreMapping: (snapshot: MappingInfo) => void;
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
  agentExecByActivity?: Record<string, { id: string; status: string; output: string; error: string | null; reviewStatus: string; reviewedBy: string | null; completedAt: string | null; agentName: string; durationMs: number | null; promotedDocumentId?: string | null }>;
  onRunAgent?: (activityId: string, activityName: string, agentRole: { agentId: string; agentName: string | null; roleType: string }) => void;
  onReviewExecution?: (executionId: string, reviewStatus: 'APPROVED' | 'REJECTED' | 'PENDING') => void;
  onPromoteExecution?: (executionId: string, payload: { name: string; documentType: string; description?: string }) => Promise<boolean>;
  /** Status of each ancestor from root to immediate parent. Empty at the
   *  top level. Used to warn when an agent is about to run, or a draft is
   *  about to be promoted, against an unfinished part of the catalogue. */
  ancestorStatusChain?: Array<{ level: string; status: string; name: string }>;
  /** Schedules grouped by activityId — used by the agent panel to list
   *  active and paused schedules inline. */
  schedulesByActivity?: Record<string, Array<{
    id: string; agentId: string; agentName: string; roleType: string;
    frequency: 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
    nextRunAt: string; lastRunAt: string | null; runCount: number;
  }>>;
  onCreateSchedule?: (payload: {
    activityId: string; agentId: string; roleType: string;
    frequency: 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    startAt: string;
  }) => Promise<boolean>;
  onToggleSchedule?: (scheduleId: string, nextStatus: 'ACTIVE' | 'PAUSED') => Promise<void>;
  onDeleteSchedule?: (scheduleId: string) => Promise<void>;
  runningActivity?: string | null;
  /** Agents available to run governance work (one entry per agent). */
  agentRoles?: Array<{ agentId: string; agentName: string | null; roleType: string }>;
  /** Union of personIds holding ANY governance role in this org —
   *  used to gate Owner / Stakeholders on governance value streams
   *  and processes. */
  governanceHolderIds: Set<string>;
  /** Per-role-label → personIds. Used by the Responsible Person picker
   *  on activities to restrict to people who hold the activity's
   *  Responsible Role. */
  holdersByRoleLabel: Map<string, Set<string>>;
  /** Simple hides Compliance, Frequency, Risk Level, Automation and
   *  Est. Duration from the per-node panel. Advanced shows everything. */
  viewMode: 'simple' | 'advanced';
}) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  // Collaboration panels (Attachments / Discussion / Activity) are collapsed
  // by default to keep the tree compact; counts come from the panels via
  // onCount so the header badge is accurate before the section is opened.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [sectionCounts, setSectionCounts] = useState<{ attachments?: number; discussion?: number }>({});
  const toggleSection = (key: string) => setOpenSections((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const setSectionCount = (key: 'attachments' | 'discussion', n: number) =>
    setSectionCounts((prev) => (prev[key] === n ? prev : { ...prev, [key]: n }));
  // Which available agent to run on this activity, and whether the produced
  // draft is expanded for review.
  const [runAgentId, setRunAgentId] = useState('');
  const [showAgentResult, setShowAgentResult] = useState(false);
  // Schedule inline form state. When `scheduleFormOpen` is true the form
  // is rendered beneath the Run / Schedule button row.
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  // datetime-local stores naive "YYYY-MM-DDTHH:mm"; default to roughly
  // "ten minutes from now" so a user who just clicks Save doesn't get
  // an instantly-firing run they didn't intend.
  const defaultScheduleStart = () => {
    const d = new Date(Date.now() + 10 * 60 * 1000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  };
  const [scheduleStartLocal, setScheduleStartLocal] = useState<string>(defaultScheduleStart);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  // Walk the ancestor chain + the current node looking for the most-
  // senior level whose status is not ACTIVE. Used to warn (not block) on
  // agent runs and document promotions whose source is in flux. Anything
  // other than ACTIVE counts as "not settled" — DRAFT/PROPOSED/UNDER_REVIEW
  // mean still-designing, DEPRECATED means shouldn't be used for new work.
  const fullStatusChain = [...(ancestorStatusChain || []), { level: node.level, status: node.status, name: node.name }];
  const firstUnsettled = fullStatusChain.find((s) => s.status !== 'ACTIVE');
  const sourceUnsettled = !!firstUnsettled;
  const unsettledLabel = (() => {
    if (!firstUnsettled) return '';
    const friendly: Record<string, string> = {
      VALUE_STREAM: 'Value stream', PROCESS: 'Process', SUBPROCESS: 'Sub-process',
      ACTIVITY: 'Activity', TASK: 'Task', DOMAIN: 'Domain', CAPABILITY: 'Capability',
    };
    return `${friendly[firstUnsettled.level] || firstUnsettled.level} is ${firstUnsettled.status}`;
  })();
  // Promote-agent-draft inline form. Open keyed by the execution id so
  // the same form can be opened from either the agent panel or the
  // Outputs panel chip for the same execution.
  const [promoteOpen, setPromoteOpen] = useState<string | null>(null);
  const [promoteName, setPromoteName] = useState('');
  const [promoteDocType, setPromoteDocType] = useState<'POLICY' | 'STANDARD' | 'CHARTER' | 'FRAMEWORK'>('POLICY');
  const [promoting, setPromoting] = useState(false);
  const openPromoteForm = (execId: string, defaultName: string) => {
    setPromoteOpen(execId);
    setPromoteName(defaultName);
    setPromoteDocType('POLICY');
  };
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
      <div
        data-node-id={node.id}
        style={{
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
              {/* "Where it runs" connection summary — read-only one-liner
                 above the editable fields so the entire connection
                 landscape (owner · role · systems · data) is visible at
                 a glance when you open a node. Skipped for value streams
                 where systems/assets aren't applicable, and for
                 governance nodes where the system / data-asset counts
                 are inherently zero — governance happens in policies,
                 decisions and meetings, not on systems. */}
              {node.level !== 'VALUE_STREAM' && node.domain !== 'GOVERNANCE' && (() => {
                const ownerName = node.ownerId ? peopleList.find((p) => p.id === node.ownerId)?.name : null;
                const sysCount = (node.systemIds || []).length;
                const assetCount = (mappingsByStep[node.id] || []).length;
                const role = node.responsibleRole || null;
                const bits: string[] = [];
                if (ownerName) bits.push(`Owner: ${ownerName}`);
                if (role) bits.push(`Role: ${role}`);
                bits.push(`${sysCount} system${sysCount === 1 ? '' : 's'}`);
                bits.push(`${assetCount} data asset${assetCount === 1 ? '' : 's'}`);
                return (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    fontSize: 11, marginBottom: 6,
                    padding: '6px 8px',
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    borderRadius: 4,
                  }}>
                    {/* Label column matches the 100px / muted-color
                        treatment used by the DocField rows directly
                        below, so "Where it runs" lines up with "Owner",
                        "Purpose", etc. instead of being a different
                        widget. */}
                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>Where it runs:</span>
                    <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{bits.join(' · ')}</span>
                  </div>
                );
              })()}
              {/* Value Stream fields */}
              {node.level === 'VALUE_STREAM' && (() => {
                const isGov = node.domain === 'GOVERNANCE';
                // On governance nodes, restrict the person pickers to
                // people who hold a governance role. If nobody has a
                // role assigned yet, the picker is locked with a hint
                // pointing the user at the Governance Roles page.
                const govNamesEligible = new Set(
                  peopleList.filter((p) => governanceHolderIds.has(p.id)).map((p) => p.name),
                );
                const noHolders = governanceHolderIds.size === 0;
                const govHint = 'Locked until at least one person is given a governance role on the Governance Roles page.';
                return (
                  <>
                    {/* Purpose and Business Outcome sit above Owner
                        on value streams because they're the "what
                        does this stream actually deliver" framing —
                        users want to read or set the strategic
                        intent first, then assign accountability for
                        it. Process nodes keep Owner-first since
                        their fields are more operational. */}
                    <DocField label="Purpose" value={node.purpose || ''} onSave={(v) => onUpdate(node.id, { purpose: v })} disabled={isLocked} placeholder="What does this accomplish?" />
                    <DocField label="Business Outcome" value={node.businessOutcome || ''} onSave={(v) => onUpdate(node.id, { businessOutcome: v })} disabled={isLocked} placeholder="What value does this deliver?" />
                    <DocPersonField label="Owner" mode="single" valueMode="id" value={node.ownerId || null} onChange={(id) => onUpdate(node.id, { ownerId: id || null })} disabled={isLocked || (isGov && noHolders)} domain={isGov ? 'GOVERNANCE' : 'OPERATIONAL'} eligibleKeys={isGov ? governanceHolderIds : undefined} disabledHint={isGov && noHolders ? govHint : undefined} disabledHintLink={isGov && noHolders ? { to: '/dama-roles', label: 'Open Governance Roles' } : undefined} />
                    <DocPersonField label="Stakeholders" mode="multi" valueMode="name" value={(node.stakeholders || '').split(',').map((s) => s.trim()).filter(Boolean)} onChange={(vals) => onUpdate(node.id, { stakeholders: (vals as string[]).join(', ') })} disabled={isLocked || (isGov && noHolders)} domain={isGov ? 'GOVERNANCE' : 'OPERATIONAL'} eligibleKeys={isGov ? govNamesEligible : undefined} disabledHint={isGov && noHolders ? govHint : undefined} disabledHintLink={isGov && noHolders ? { to: '/dama-roles', label: 'Open Governance Roles' } : undefined} />
                    {viewMode === 'advanced' && (
                      <DocMultiSelect label="Compliance" selected={node.complianceTags || []} options={COMPLIANCE_OPTIONS} onSave={(vals) => onUpdate(node.id, { complianceTags: vals })} disabled={isLocked} placeholder="Select compliance tags..." />
                    )}
                  </>
                );
              })()}
              {/* Process fields */}
              {node.level === 'PROCESS' && (() => {
                const isGov = node.domain === 'GOVERNANCE';
                const noHolders = governanceHolderIds.size === 0;
                const govHint = 'Locked until at least one person is given a governance role on the Governance Roles page.';
                return (
                  <>
                    {/* Purpose sits above Owner on processes for the
                        same reason as value streams — the strategic
                        framing comes before accountability for it.
                        Sub-Process / Activity / Task levels keep
                        Owner-first since they're execution units
                        without a strategic purpose of their own. */}
                    <DocField label="Purpose" value={node.purpose || ''} onSave={(v) => onUpdate(node.id, { purpose: v })} disabled={isLocked} placeholder="What does this accomplish?" />
                    <DocPersonField label="Owner" mode="single" valueMode="id" value={node.ownerId || null} onChange={(id) => onUpdate(node.id, { ownerId: id || null })} disabled={isLocked || (isGov && noHolders)} domain={isGov ? 'GOVERNANCE' : 'OPERATIONAL'} eligibleKeys={isGov ? governanceHolderIds : undefined} disabledHint={isGov && noHolders ? govHint : undefined} disabledHintLink={isGov && noHolders ? { to: '/dama-roles', label: 'Open Governance Roles' } : undefined} />
                    {/* Stakeholders is intentionally absent at the
                        Process level. It lives only on Value Streams
                        — the strategic level where "who cares about
                        this end-to-end flow" is a useful quick
                        answer. At Process and below, the RACI Matrix
                        is the structured home for who-needs-to-be-
                        informed-or-consulted; a parallel free-text
                        Stakeholders field there just drifted from
                        RACI. Existing process rows with a stored
                        stakeholders value keep it on the record
                        (it's just not edited from the panel). */}
                    {viewMode === 'advanced' && (
                      <>
                        <DocMultiSelect label="Compliance" selected={node.complianceTags || []} options={COMPLIANCE_OPTIONS} onSave={(vals) => onUpdate(node.id, { complianceTags: vals })} disabled={isLocked} placeholder="Select compliance tags..." />
                        <DocDropdown label="Frequency" value={node.frequency || ''} options={FREQUENCY_OPTIONS} onSave={(v) => onUpdate(node.id, { frequency: v })} disabled={isLocked} placeholder="How often?" />
                        <DocDropdown label="Risk Level" value={node.riskLevel || ''} options={RISK_OPTIONS} onSave={(v) => onUpdate(node.id, { riskLevel: v })} disabled={isLocked} placeholder="Select risk..." />
                      </>
                    )}
                  </>
                );
              })()}
              {/* Sub-Process fields — no level-specific fields; the
                 Inputs / Outputs note now lives next to the data-asset
                 panel below so the text and the structured list sit
                 together. */}
              {node.level === 'SUBPROCESS' && null}
              {/* Activity fields */}
              {node.level === 'ACTIVITY' && (
                <>
                  <DocRoleField value={node.responsibleRole || ''} onSave={(v) => onUpdate(node.id, { responsibleRole: v })} disabled={isLocked} domain={node.domain === 'GOVERNANCE' ? 'GOVERNANCE' : 'OPERATIONAL'} />
                  {/* Responsible Person — restricted to people who
                     currently hold node.responsibleRole. Disabled until
                     the role is set, or if no one holds that role yet
                     (with hints pointing the user at where to fix it). */}
                  {(() => {
                    const role = node.responsibleRole || '';
                    const holders = role ? (holdersByRoleLabel.get(role) || new Set<string>()) : new Set<string>();
                    const noRole = !role;
                    const noHolders = !noRole && holders.size === 0;
                    const hint = noRole
                      ? 'Pick a Responsible Role first — then the person list will be filtered to people who hold it.'
                      : noHolders
                        ? `No one currently holds "${role}". Assign it on the Governance Roles page first.`
                        : undefined;
                    return (
                      <DocPersonField
                        label="Responsible Person"
                        mode="single"
                        valueMode="id"
                        value={node.responsiblePersonId || null}
                        onChange={(id) => onUpdate(node.id, { responsiblePersonId: id || null })}
                        disabled={isLocked || noRole || noHolders}
                        domain={node.domain === 'GOVERNANCE' ? 'GOVERNANCE' : 'OPERATIONAL'}
                        eligibleKeys={holders}
                        disabledHint={hint}
                        disabledHintLink={noHolders && !noRole ? { to: '/dama-roles', label: 'Open Governance Roles' } : undefined}
                        placeholder={noRole ? 'Pick a role first…' : 'Select responsible person…'}
                      />
                    );
                  })()}
                  {viewMode === 'advanced' && (
                    <>
                      <DocDropdown label="Automation" value={node.automationLevel || ''} options={AUTOMATION_OPTIONS} onSave={(v) => onUpdate(node.id, { automationLevel: v })} disabled={isLocked} placeholder="Automation level..." />
                      <DocDropdown
                        label="Est. Duration"
                        value={node.estimatedDuration || ''}
                        /* Append any legacy free-text value so it remains
                           visible in the dropdown until the user picks a
                           canonical bucket. */
                        options={node.estimatedDuration && !DURATION_OPTIONS.includes(node.estimatedDuration)
                          ? [...DURATION_OPTIONS, node.estimatedDuration]
                          : DURATION_OPTIONS}
                        onSave={(v) => onUpdate(node.id, { estimatedDuration: v })}
                        disabled={isLocked}
                        placeholder="Pick a duration..."
                      />
                    </>
                  )}
                  <SkillPicker compact orgId={node.orgIds?.[0]} selectedSkillIds={node.requiredSkillIds || []} onChange={(ids) => onUpdate(node.id, { requiredSkillIds: ids })} disabled={isLocked} label="Required Skills" />
                  {/* Agent execution — have an agent PERFORM this activity.
                      Scoped to the governance value stream; the backend enforces
                      the same rule. */}
                  {node.domain === 'GOVERNANCE' && onRunAgent && (agentRoles?.length ?? 0) > 0 && (() => {
                    const ex = agentExecByActivity?.[node.id];
                    const selectedId = runAgentId || agentRoles![0].agentId;
                    const selected = agentRoles!.find((a) => a.agentId === selectedId) || agentRoles![0];
                    const running = runningActivity === node.id;
                    const reviewMap: Record<string, { bg: string; c: string; t: string }> = {
                      APPROVED: { bg: '#d1fae5', c: '#065f46', t: 'Approved' },
                      REJECTED: { bg: '#fee2e2', c: '#991b1b', t: 'Rejected' },
                      PENDING: { bg: '#fef3c7', c: '#92400e', t: 'Pending review' },
                    };
                    return (
                      <div style={{ marginTop: 4, padding: '6px 8px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexWrap: 'wrap' }}>
                          <span style={{ color: '#6b21a8', fontWeight: 600 }}>Perform with agent:</span>
                          <select value={selectedId} onChange={(e) => setRunAgentId(e.target.value)} disabled={running}
                            style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}>
                            {agentRoles!.map((a) => <option key={a.agentId} value={a.agentId}>{a.agentName || 'Agent'}{a.roleType ? ` — ${a.roleType}` : ''}</option>)}
                          </select>
                          <button onClick={() => onRunAgent(node.id, node.name, selected)} disabled={running}
                            style={{ padding: '2px 10px', fontSize: 10, fontWeight: 600, background: running ? '#e5e7eb' : '#7c3aed', color: running ? '#6b7280' : '#fff', border: 'none', borderRadius: 4, cursor: running ? 'not-allowed' : 'pointer' }}>
                            {running ? 'Running…' : (ex ? 'Re-run' : 'Run')}
                          </button>
                          {onCreateSchedule && (
                            <button onClick={() => setScheduleFormOpen((v) => !v)}
                              title="Schedule this agent to run once at a later time, or on a recurring cadence"
                              style={{ padding: '2px 10px', fontSize: 10, fontWeight: 600, background: 'transparent', color: '#6b21a8', border: '1px solid #c4b5fd', borderRadius: 4, cursor: 'pointer' }}>
                              {scheduleFormOpen ? 'Cancel schedule' : 'Schedule…'}
                            </button>
                          )}
                          {/* Soft warning when the source definition isn't
                             ACTIVE. Doesn't block — iterative design with
                             agent assistance is a legitimate use case —
                             but makes the design state legible. */}
                          {sourceUnsettled && (
                            <span title={`Agents can still run, but the draft will reference an unfinished definition. ${unsettledLabel}.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                              <span aria-hidden>!</span> {unsettledLabel}
                            </span>
                          )}
                          {ex && (() => {
                            const sc = ex.status === 'SUCCESS' ? '#065f46' : ex.status === 'FAILED' ? '#b91c1c' : '#92400e';
                            const sb = ex.status === 'SUCCESS' ? '#d1fae5' : ex.status === 'FAILED' ? '#fef2f2' : '#fef3c7';
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: sb, color: sc }}>{ex.status}</span>
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{ex.agentName} {ex.completedAt ? new Date(ex.completedAt).toLocaleString() : ''}</span>
                              </span>
                            );
                          })()}
                        </div>
                        {ex && ex.status === 'SUCCESS' && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <button onClick={() => setShowAgentResult((v) => !v)}
                                style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-primary)' }}>
                                {showAgentResult ? 'Hide draft' : 'View draft'}
                              </button>
                              {(() => { const m = reviewMap[ex.reviewStatus] || reviewMap.PENDING; return (
                                <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: m.bg, color: m.c }}>
                                  {m.t}{ex.reviewedBy && ex.reviewStatus !== 'PENDING' ? ` · ${ex.reviewedBy}` : ''}
                                </span>
                              ); })()}
                              {onReviewExecution && ex.reviewStatus === 'PENDING' && (
                                <>
                                  <button onClick={() => onReviewExecution(ex.id, 'APPROVED')}
                                    style={{ fontSize: 10, padding: '2px 8px', background: '#065f46', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>Approve</button>
                                  <button onClick={() => onReviewExecution(ex.id, 'REJECTED')}
                                    style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 3, cursor: 'pointer' }}>Reject</button>
                                </>
                              )}
                              {onReviewExecution && ex.reviewStatus !== 'PENDING' && (
                                <button onClick={() => onReviewExecution(ex.id, 'PENDING')}
                                  style={{ fontSize: 10, padding: '2px 6px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}>Reset</button>
                              )}
                              {/* Promote-to-document affordance. An approved-but-
                                 unpromoted draft can be turned into a Governance
                                 Document and attached as an OUTPUT in one step.
                                 Available also on PENDING drafts as a fast-path
                                 (the backend marks them APPROVED on promote). */}
                              {onPromoteExecution && ex.reviewStatus !== 'REJECTED' && !ex.promotedDocumentId && (
                                <button onClick={() => openPromoteForm(ex.id, node.name)}
                                  style={{ fontSize: 10, padding: '2px 8px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                                  title="Create a Governance Document from this draft and attach it as an Output of this activity">
                                  Promote to Document
                                </button>
                              )}
                              {ex.promotedDocumentId && (
                                <a href="/governance-documents"
                                  style={{ fontSize: 10, padding: '2px 8px', background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd', borderRadius: 3, textDecoration: 'none', fontWeight: 600 }}
                                  title="This draft has been promoted to a Governance Document and now appears in the activity's Outputs.">
                                  Promoted →
                                </a>
                              )}
                            </div>
                            {showAgentResult && (
                              <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 360, overflowY: 'auto' }}>
                                <div style={{ fontSize: 9, fontWeight: 600, color: '#92400e', background: '#fef3c7', display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginBottom: 6 }}>AI DRAFT — review before use</div>
                                <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ex.output}</div>
                              </div>
                            )}
                            {/* Inline promote form — shown when openPromoteForm
                               was called for this execution. The form's name
                               defaults to the activity name; documentType
                               defaults to POLICY. The "Outputs panel" chip
                               opens this same form via the same state. */}
                            {promoteOpen === ex.id && onPromoteExecution && (
                              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid #c4b5fd', borderRadius: 4 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: '#5b21b6' }}>Promote draft to Governance Document</div>
                                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                                  Creates a new <strong>{promoteDocType.toLowerCase()}</strong> in the Governance Documents catalogue with this draft's content, and links it as an <strong>Output</strong> of this activity.
                                </div>
                                {sourceUnsettled && (
                                  <div style={{ fontSize: 10, padding: '6px 8px', marginBottom: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, color: '#92400e', lineHeight: 1.5 }}>
                                    <strong>{unsettledLabel}.</strong> The document will reference an unfinished process. It will be created as a <strong>DRAFT</strong> document, and its description will record the source status at promotion time. Promote anyway?
                                  </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
                                  <div>
                                    <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Name</label>
                                    <input value={promoteName} onChange={(e) => setPromoteName(e.target.value)}
                                      style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, width: '100%', background: 'var(--color-surface)' }} />
                                  </div>
                                  <div>
                                    <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Document type</label>
                                    <select value={promoteDocType} onChange={(e) => setPromoteDocType(e.target.value as typeof promoteDocType)}
                                      style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, width: '100%', background: 'var(--color-surface)' }}>
                                      <option value="POLICY">Policy</option>
                                      <option value="STANDARD">Standard</option>
                                      <option value="CHARTER">Charter</option>
                                      <option value="FRAMEWORK">Framework</option>
                                    </select>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <button onClick={() => setPromoteOpen(null)} disabled={promoting}
                                    style={{ fontSize: 10, padding: '3px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 3, cursor: promoting ? 'not-allowed' : 'pointer' }}>
                                    Cancel
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!promoteName.trim() || !onPromoteExecution) return;
                                      setPromoting(true);
                                      const ok = await onPromoteExecution(ex.id, { name: promoteName.trim(), documentType: promoteDocType });
                                      setPromoting(false);
                                      if (ok) setPromoteOpen(null);
                                    }}
                                    disabled={promoting || !promoteName.trim()}
                                    style={{ fontSize: 10, padding: '3px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 3, cursor: (promoting || !promoteName.trim()) ? 'not-allowed' : 'pointer', opacity: (promoting || !promoteName.trim()) ? 0.6 : 1 }}>
                                    {promoting ? 'Promoting…' : 'Promote'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {ex && ex.status === 'FAILED' && ex.error && (
                          <div style={{ marginTop: 6, fontSize: 10, color: '#991b1b' }}>{ex.error}</div>
                        )}

                        {/* Inline schedule form. Frequency + start datetime;
                            saves a new agent-schedules row. ONCE schedules
                            auto-COMPLETED after their single run. */}
                        {scheduleFormOpen && onCreateSchedule && (
                          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--color-bg)', border: '1px solid #c4b5fd', borderRadius: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: '#5b21b6' }}>Schedule this agent</div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                              The agent runs on the cadence you pick. The activity's responsible person is notified when each run completes; every run is recorded in the audit log.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Frequency</label>
                                <select value={scheduleFrequency} onChange={(e) => setScheduleFrequency(e.target.value as typeof scheduleFrequency)}
                                  style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, width: '100%', background: 'var(--color-surface)' }}>
                                  <option value="ONCE">Once (run at this time)</option>
                                  <option value="HOURLY">Hourly</option>
                                  <option value="DAILY">Daily</option>
                                  <option value="WEEKLY">Weekly</option>
                                  <option value="MONTHLY">Monthly</option>
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>{scheduleFrequency === 'ONCE' ? 'Run at' : 'First run at'}</label>
                                <input type="datetime-local" value={scheduleStartLocal} onChange={(e) => setScheduleStartLocal(e.target.value)}
                                  style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, width: '100%', background: 'var(--color-surface)' }} />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button onClick={() => { setScheduleFormOpen(false); setScheduleStartLocal(defaultScheduleStart()); }} disabled={scheduleSaving}
                                style={{ fontSize: 10, padding: '3px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 3, cursor: scheduleSaving ? 'not-allowed' : 'pointer' }}>
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  if (!scheduleStartLocal || !onCreateSchedule) return;
                                  // datetime-local is naive local time; convert to ISO.
                                  const iso = new Date(scheduleStartLocal).toISOString();
                                  setScheduleSaving(true);
                                  const ok = await onCreateSchedule({
                                    activityId: node.id, agentId: selectedId, roleType: selected.roleType,
                                    frequency: scheduleFrequency, startAt: iso,
                                  });
                                  setScheduleSaving(false);
                                  if (ok) { setScheduleFormOpen(false); setScheduleStartLocal(defaultScheduleStart()); }
                                }}
                                disabled={scheduleSaving || !scheduleStartLocal}
                                style={{ fontSize: 10, padding: '3px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 3, cursor: scheduleSaving ? 'not-allowed' : 'pointer', opacity: scheduleSaving ? 0.6 : 1 }}>
                                {scheduleSaving ? 'Saving…' : 'Save schedule'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Existing schedules for this activity (ACTIVE or
                            PAUSED — COMPLETED ones drop off automatically
                            on the next tick). */}
                        {(() => {
                          const list = (schedulesByActivity?.[node.id] || []).filter((s) => s.status !== 'COMPLETED');
                          if (list.length === 0) return null;
                          return (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                                Scheduled runs ({list.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {list.map((s) => {
                                  const isActive = s.status === 'ACTIVE';
                                  return (
                                    <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '3px 8px', background: isActive ? '#ede9fe' : '#f5f3ff', color: '#5b21b6', borderRadius: 4, fontSize: 11, border: `1px solid ${isActive ? '#c4b5fd' : 'var(--color-border)'}` }}>
                                      <Bot size={12} strokeWidth={2.4} />
                                      <span>{s.agentName}</span>
                                      <span style={{ color: '#7c3aed' }}>·</span>
                                      <span>{s.frequency.toLowerCase()}</span>
                                      <span style={{ color: '#7c3aed' }}>·</span>
                                      <span title={`Next run: ${new Date(s.nextRunAt).toLocaleString()}`}>
                                        next: {new Date(s.nextRunAt).toLocaleString()}
                                      </span>
                                      {s.runCount > 0 && (
                                        <>
                                          <span style={{ color: '#7c3aed' }}>·</span>
                                          <span style={{ color: 'var(--color-text-muted)' }}>{s.runCount} run{s.runCount === 1 ? '' : 's'}</span>
                                        </>
                                      )}
                                      {!isActive && <StatusBadge variant="warning">Paused</StatusBadge>}
                                      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                                        {onToggleSchedule && (
                                          <button onClick={() => onToggleSchedule(s.id, isActive ? 'PAUSED' : 'ACTIVE')}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#5b21b6', fontSize: 11, padding: 0, textDecoration: 'underline' }}>
                                            {isActive ? 'Pause' : 'Resume'}
                                          </button>
                                        )}
                                        {onDeleteSchedule && (
                                          <button onClick={() => onDeleteSchedule(s.id)}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 11, padding: 0, textDecoration: 'underline' }}>
                                            Delete
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </>
              )}
              {/* Task fields — required skills */}
              {node.level === 'TASK' && (
                <SkillPicker compact orgId={node.orgIds?.[0]} selectedSkillIds={node.requiredSkillIds || []} onChange={(ids) => onUpdate(node.id, { requiredSkillIds: ids })} disabled={isLocked} label="Required Skills" />
              )}
              {/* Systems this step runs on — first-class link, distinct
                 from the data-asset mappings below (a step may run on a
                 system even before any data asset is linked). Available
                 on every level except value streams (too abstract) and
                 governance nodes (a Data Governance Council meeting
                 isn't really "running on" the corporate ERP — governance
                 outputs are policies and decisions, not system flows). */}
              {node.level !== 'VALUE_STREAM' && node.domain !== 'GOVERNANCE' && (
                <DocSystemsField
                  selected={node.systemIds || []}
                  options={systemsList}
                  onSave={(ids) => onUpdate(node.id, { systemIds: ids })}
                  disabled={isLocked}
                />
              )}
            </div>
          )}
          {/* Free-text Inputs / Outputs note — sits directly above the
             structured IOPanel so the description and the attached
             assets read as one block (it used to live up among the
             other doc fields, separated from the panel by Skills /
             Agent rows). */}
          {/* Structured Inputs / Outputs panel — rows can target a
              data asset, a governance document (policy), or an
              uploaded attachment. Picker is segmented across the
              three kinds.

              Scoped to Activity-level nodes only. A process's
              effective inputs/outputs are a roll-up of its child
              activities; declaring them independently at the process
              level creates a two-sources-of-truth maintenance trap
              (and disagrees with how the governance template, the
              agent execution model, and the mappings already work).
              Higher-level nodes get a quiet pointer instead. */}
          {isExpanded && node.level === 'ACTIVITY' && (
            <IOPanel
              nodeId={node.id}
              mappings={mappingsByStep[node.id] || []}
              assetsList={assetsList}
              policiesList={policiesList}
              orgId={activePageOrgId}
              disabled={isLocked}
              isGovernance={node.domain === 'GOVERNANCE'}
              onAdd={onAddMapping}
              onRemove={onRemoveMapping}
              onRestore={onRestoreMapping}
              nodeInputsOutputs={node.inputsOutputs}
            />
          )}
          {isExpanded && node.level !== 'VALUE_STREAM' && node.level !== 'ACTIVITY' && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#f8fafc', border: '1px dashed var(--color-border)', borderRadius: 4, fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              <strong>Inputs and outputs are defined at the activity level.</strong> Open one of this {node.level === 'PROCESS' ? 'process’s' : 'node’s'} activities to declare data assets, governance documents, and attachments — its effective I/O is the roll-up of its children.
            </div>
          )}
          {/* Approved agent drafts that haven't yet been promoted to a
             Governance Document — surfaced here in the Outputs area so
             the answer to "where's my approved draft as an output?" is
             one click away. Promoted drafts disappear from this chip
             list because they show up as proper Output mappings above. */}
          {isExpanded && (() => {
            const ex = agentExecByActivity?.[node.id];
            if (!ex || ex.status !== 'SUCCESS') return null;
            if (ex.reviewStatus !== 'APPROVED') return null;
            if (ex.promotedDocumentId) return null;
            return (
              <div style={{ marginTop: 6, padding: '6px 10px', background: '#faf5ff', border: '1px dashed #d8b4fe', borderRadius: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  Approved draft pending promotion
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', background: '#ede9fe', color: '#5b21b6', borderRadius: 12, fontSize: 11 }}>
                  <Bot size={12} strokeWidth={2.4} />
                  <span>Agent draft by {ex.agentName}</span>
                  <button onClick={() => setShowAgentResult(true)} style={{ background: 'transparent', border: 'none', color: '#5b21b6', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>View</button>
                  <span style={{ color: '#a78bfa' }}>·</span>
                  {onPromoteExecution && (
                    <button onClick={() => openPromoteForm(ex.id, node.name)} style={{ background: 'transparent', border: 'none', color: '#5b21b6', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>Promote</button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Promote to a Governance Document to make this an Output of the activity.
                </div>
              </div>
            );
          })()}
          {/* Collaboration panels — collapsed by default to keep the tree
            *  compact. The panels stay mounted (hidden) so their header
            *  counts populate without the user opening each one. */}
          {isExpanded && (
            <>
              {/* Attachments — docs, diagrams, external links */}
              <CollapsibleSection
                title="Attachments"
                count={sectionCounts.attachments}
                open={openSections.has('attachments')}
                onToggle={() => toggleSection('attachments')}
              >
                <AttachmentsPanel
                  entityType="ProcessNode"
                  entityId={node.id}
                  orgId={node.orgIds?.[0]}
                  disabled={isLocked}
                  hideHeader
                  onCount={(n) => setSectionCount('attachments', n)}
                />
              </CollapsibleSection>
              {/* Discussion — threaded comments + @mentions for this node.
                *  Process-level conversations stay attached to the node
                *  rather than living in someone's email. */}
              <CollapsibleSection
                title="Discussion"
                count={sectionCounts.discussion}
                open={openSections.has('discussion')}
                onToggle={() => toggleSection('discussion')}
              >
                <CommentsPanel
                  entityType="ProcessNode"
                  entityId={node.id}
                  entityLabel={`${LEVEL_CONFIG[node.level].label}: ${node.name}`}
                  onCount={(n) => setSectionCount('discussion', n)}
                />
              </CollapsibleSection>
              {/* No count badge here: the feed is capped at limit=30, so a
                *  badge could undercount a long audit trail. */}
              <CollapsibleSection
                title="Activity"
                open={openSections.has('activity')}
                onToggle={() => toggleSection('activity')}
              >
                <ActivityFeed
                  entityType="ProcessNode"
                  entityId={node.id}
                  inline
                  initialRows={5}
                />
              </CollapsibleSection>
            </>
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
          policiesList={policiesList}
          systemsList={systemsList}
          mappingsByStep={mappingsByStep}
          activePageOrgId={activePageOrgId}
          onAddMapping={onAddMapping}
          onRemoveMapping={onRemoveMapping}
          onRestoreMapping={onRestoreMapping}
          statusMode={statusMode}
          agentExecByActivity={agentExecByActivity}
          onRunAgent={onRunAgent}
          onReviewExecution={onReviewExecution}
          onPromoteExecution={onPromoteExecution}
          runningActivity={runningActivity}
          agentRoles={agentRoles}
          governanceHolderIds={governanceHolderIds}
          holdersByRoleLabel={holdersByRoleLabel}
          viewMode={viewMode}
          ancestorStatusChain={[...(ancestorStatusChain || []), { level: node.level, status: node.status, name: node.name }]}
          schedulesByActivity={schedulesByActivity}
          onCreateSchedule={onCreateSchedule}
          onToggleSchedule={onToggleSchedule}
          onDeleteSchedule={onDeleteSchedule} />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function ProcessCatalogPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, activeOrgType, canCreateValueStreams, setActiveOrg } = useOrgContext();
  // Block "create value stream" entry points when the active org is a
  // multi-division company (e.g. Tidewater Utilities → Electric /
  // Water). The wizard already enforces this; the manual create
  // surfaces on this page enforce it too so users can't sidestep the
  // guard via the "+ Add value stream" header button or the empty
  // state. Read-only surfaces (Visualize, Compare, Export) stay
  // available.
  const { divisions: subtreeDivisions, companyWithDivisions } = useValueStreamScope();
  const canCreateHere = canCreateValueStreams && !companyWithDivisions;
  // Governance value streams are exempt from the multi-division
  // block. Corporate governance (policies, decision rights, the
  // overall data-governance program) is intentionally one
  // enterprise-wide program — duplicating it into every division
  // and reconciling later is the wrong model. So the "Generate
  // governance processes" wand needs the level guard
  // (canCreateValueStreams) but not the
  // !companyWithDivisions guard.
  const canCreateGovernanceHere = canCreateValueStreams;
  // Used by addMapping to detect cross-division links — when an
  // activity's value-stream org and the data asset's owner org are
  // on different vertical axes (e.g. Tidewater Water activity ↔
  // Tidewater Electric asset), pop a confirm before linking.
  const { getOrgName, isOrgInScope } = useOrgNameLookup();
  const { canWrite, canContribute } = usePermissions();
  const addToast = useToastStore((s) => s.addToast);
  const currentUser = useAuthStore((s) => s.user);
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [validChildrenMap, setValidChildrenMap] = useState<Record<string, string[]>>({});
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Notifications (and the Source-panel link on the Governance Documents
  // page) deep-link the user to a specific catalog node via ?node=<id>
  // (accepted synonym: ?activity=<id>). The effect below honours that:
  // walks the tree to find the ancestor chain, expands them all, then
  // on the next paint scrolls the row into view and flashes a brief
  // highlight so the user's eye lands on it. Falls back silently if
  // the node isn't in the current scope.
  const location = useLocation();
  useEffect(() => {
    if (!tree.length) return;
    const params = new URLSearchParams(location.search);
    const targetId = params.get('node') || params.get('activity');
    if (!targetId) return;
    function findAncestorIds(nodes: ProcessNode[], id: string, path: string[] = []): string[] | null {
      for (const n of nodes) {
        if (n.id === id) return path;
        if (n.children?.length) {
          const sub = findAncestorIds(n.children, id, [...path, n.id]);
          if (sub) return sub;
        }
      }
      return null;
    }
    const ancestors = findAncestorIds(tree, targetId);
    if (!ancestors) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      next.add(targetId);
      return next;
    });
    // Defer the scroll + flash to the next paint so the freshly-expanded
    // rows are actually in the DOM by then.
    const handle = setTimeout(() => {
      const el = document.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof el.animate === 'function') {
        el.animate(
          [
            { backgroundColor: '#fef3c7', boxShadow: '0 0 0 3px #fde68a inset' },
            { backgroundColor: 'transparent', boxShadow: '0 0 0 0 transparent inset' },
          ],
          { duration: 1800, easing: 'ease-out' },
        );
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [tree, location.search]);

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
  const [policiesList, setPoliciesList] = useState<PolicyRef[]>([]);
  const [systemsList, setSystemsList] = useState<SystemRef[]>([]);
  const [mappingsByStep, setMappingsByStep] = useState<Record<string, MappingInfo[]>>({});
  // When the user picks an asset whose owner org is on a different
  // vertical axis from the process node's value-stream org (e.g.
  // a Water activity reaching for an Electric asset, sibling
  // divisions), addMapping defers the POST and surfaces a
  // ConfirmDialog. Holds the link details until the user
  // confirms or cancels.
  const [pendingCrossLink, setPendingCrossLink] = useState<
    | { nodeId: string; target: AddMappingTarget; linkType: string; nodeName: string; assetName: string; assetOrgName: string; nodeOrgName: string }
    | null
  >(null);
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [showLevelGuide, setShowLevelGuide] = useState(false);
  // Simple / Advanced view mode — Simple is the default for newcomers
  // and hides the rarely-used per-level fields (Compliance, Frequency,
  // Risk Level, Automation, Est. Duration) plus the rarely-used node
  // levels in the legend. Toggle persists across visits.
  const [viewMode, setViewMode] = useState<'simple' | 'advanced'>(() => {
    try {
      return (localStorage.getItem('procela:catalog-view-mode') as 'simple' | 'advanced') || 'simple';
    } catch { return 'simple'; }
  });
  const setViewModePersist = (m: 'simple' | 'advanced') => {
    setViewMode(m);
    try { localStorage.setItem('procela:catalog-view-mode', m); } catch { /* noop */ }
  };

  // Agent execution state
  interface AgentExecutionInfo { id: string; agentId: string; agentName: string; activityId: string; status: string; output: string; error: string | null; reviewStatus: string; reviewedBy: string | null; completedAt: string | null; durationMs: number | null; createdAt: string; promotedDocumentId?: string | null; }
  interface DamaRoleInfo { agentId: string; agentName: string | null; roleType: string; }
  // Schedules are stored per-activity for the agent panel's list view.
  interface AgentScheduleInfo {
    id: string; orgId: string; agentId: string; agentName: string;
    activityId: string; activityName: string; roleType: string;
    frequency: 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
    startAt: string; nextRunAt: string; lastRunAt: string | null; runCount: number;
    createdAt: string; updatedAt: string;
  }
  const [agentExecByActivity, setAgentExecByActivity] = useState<Record<string, AgentExecutionInfo>>({});
  const [damaAgentRoles, setDamaAgentRoles] = useState<DamaRoleInfo[]>([]);
  const [schedulesByActivity, setSchedulesByActivity] = useState<Record<string, AgentScheduleInfo[]>>({});
  const [runningActivity, setRunningActivity] = useState<string | null>(null);
  // Agents available to run governance work — one entry per agent (an agent
  // may hold several DAMA roles; we only need it listed once in the picker).
  const agentRoleOptions = useMemo(
    () => Array.from(new Map(damaAgentRoles.map((r) => [r.agentId, r])).values()),
    [damaAgentRoles],
  );

  // Governance role assignments in this org — drives the role-gated
  // person pickers below. governanceHolderIds is the union (any
  // governance role) and powers Owner/Stakeholders on governance VS /
  // Process. holdersByRoleLabel is per-role and powers the Responsible
  // Person picker on activities.
  interface RoleAssignment { personId: string; roleType: string; }
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [catalogRes, flowsRes, tagsRes, peopleRes, assetsRes, policiesRes, systemsRes, mappingsRes, rolesRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>(`/process-catalog${qp}`),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
        apiClient.get<{ success: boolean; data: TagEntry[] }>(`/tags?entityType=ProcessNode${activeOrgId ? `&orgId=${activeOrgId}` : ''}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataAssetRef[] }>(`/data-assets${qp}`),
        // Pulled for the IOPanel governance-document picker so a
        // governance activity can be linked to the charter / policy
        // it produces or consumes.
        apiClient.get<{ success: boolean; data: PolicyRef[] }>(`/governance-policies${qp}`),
        apiClient.get<{ success: boolean; data: SystemRef[] }>(`/systems${qp}`),
        apiClient.get<{ success: boolean; data: MappingInfo[] }>(`/mappings${qp}`),
        apiClient.get<{ success: boolean; data: RoleAssignment[] }>(`/dama-roles${qp}`),
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
      setAssetsList((assetsRes.data || []).map((a: any) => ({ id: a.id, name: a.name, orgId: a.orgId })));
      setPoliciesList((policiesRes.data || []).map((p: any) => ({ id: p.id, name: p.name, code: p.code, documentType: p.documentType, orgId: p.orgId })));
      setSystemsList((systemsRes.data || []).map((s: any) => ({ id: s.id, name: s.name, systemType: s.systemType })));
      setRoleAssignments((rolesRes.data || []).map((r: any) => ({ personId: r.personId, roleType: r.roleType })));
      // Fetch agent executions, DAMA roles, and schedules for agent-assigned activities
      try {
        const [execsRes, rolesRes, schedRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: AgentExecutionInfo[] }>(`/agent-executions${qp}`),
          apiClient.get<{ success: boolean; data: DamaRoleInfo[] }>(`/dama-roles${qp}`),
          apiClient.get<{ success: boolean; data: AgentScheduleInfo[] }>(`/agent-schedules${qp}`),
        ]);
        // Group schedules by activityId so the panel can list them inline.
        const byActSched: Record<string, AgentScheduleInfo[]> = {};
        for (const s of (schedRes.data || [])) {
          (byActSched[s.activityId] = byActSched[s.activityId] || []).push(s);
        }
        setSchedulesByActivity(byActSched);
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

  // Performs the actual link POST. Split out from addMapping so the
  // cross-division confirm path can call it directly after the
  // user accepts. Polymorphic on target kind — exactly one of
  // dataAssetId / policyId / attachmentId is sent.
  const submitMapping = async (nodeId: string, target: AddMappingTarget, linkType: string) => {
    try {
      const body: Record<string, any> = {
        processStepId: nodeId,
        linkType,
        notes: '',
        aiSuggested: false,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
        ...(target.fulfillsExpected ? { fulfillsExpected: target.fulfillsExpected } : {}),
      };
      if (target.kind === 'asset') body.dataAssetId = target.id;
      else if (target.kind === 'policy') body.policyId = target.id;
      else if (target.kind === 'attachment') body.attachmentId = target.id;
      await apiClient.post('/mappings', body);
      fetchData();
    } catch { /* */ }
  };

  // Entry point used by IOPanel. Runs the cross-division guard
  // before POSTing — if the target's owner org is on a different
  // vertical axis from any of the process node's orgIds (i.e.
  // sibling divisions), pop a confirm. Same-axis (parent <->
  // child, or identical) links go through silently. The guard
  // covers data-asset and policy targets; attachments are scoped
  // to the node directly so there's no cross-org concern.
  const addMapping = async (nodeId: string, target: AddMappingTarget, linkType: string) => {
    const node = findNodeInTree(tree, nodeId);
    const nodeOrgIds = node?.orgIds ?? [];
    let targetOrgId: string | undefined;
    let targetName = '';
    if (target.kind === 'asset') {
      const asset = assetsList.find((a) => a.id === target.id);
      targetOrgId = asset?.orgId;
      targetName = asset?.name || 'the asset';
    } else if (target.kind === 'policy') {
      const policy = policiesList.find((p) => p.id === target.id);
      targetOrgId = policy?.orgId;
      targetName = policy?.name || 'the document';
    }
    const onSameAxis = target.kind === 'attachment' || nodeOrgIds.length === 0 || !targetOrgId
      ? true
      : nodeOrgIds.some((nodeOrg) => isOrgInScope(targetOrgId, nodeOrg));
    if (!onSameAxis) {
      const nodeOrgName = getOrgName(nodeOrgIds[0]);
      const targetOrgName = getOrgName(targetOrgId);
      setPendingCrossLink({
        nodeId,
        target,
        linkType,
        nodeName: node?.name || 'this activity',
        assetName: targetName,
        assetOrgName: targetOrgName || 'a different division',
        nodeOrgName: nodeOrgName || 'this division',
      });
      return;
    }
    await submitMapping(nodeId, target, linkType);
  };

  const removeMapping = async (mappingId: string) => {
    try {
      await apiClient.delete(`/mappings/${mappingId}`);
      fetchData();
    } catch { /* */ }
  };

  // Recreates a mapping from a snapshot. Used as the Undo handler on
  // the toast that pops when a user unlinks an input/output — costs
  // nothing on the intentional click, saves a misclick. Bypasses the
  // cross-division guard (addMapping) because the user just had this
  // exact link and is restoring it; nothing to confirm.
  const restoreMapping = async (m: MappingInfo) => {
    try {
      const body: Record<string, any> = {
        processStepId: m.processStepId,
        linkType: m.linkType,
        notes: '',
        aiSuggested: false,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
        ...(m.dataAssetId ? { dataAssetId: m.dataAssetId } : {}),
        ...(m.policyId ? { policyId: m.policyId } : {}),
        ...(m.attachmentId ? { attachmentId: m.attachmentId } : {}),
        ...(m.fulfillsExpected ? { fulfillsExpected: m.fulfillsExpected } : {}),
        ...(m.criticality ? { criticality: m.criticality } : {}),
        ...(m.dataFormat ? { dataFormat: m.dataFormat } : {}),
        ...(m.sla ? { sla: m.sla } : {}),
        ...(m.qualityRequirement ? { qualityRequirement: m.qualityRequirement } : {}),
      };
      await apiClient.post('/mappings', body);
      fetchData();
    } catch { /* */ }
  };

  // ── Agent execution handler ──
  // The agent actually performs the governance activity: the backend assembles
  // the activity's context, runs it through the agent's instructions via Claude,
  // and returns a draft for review. The caller picks which assigned agent runs.
  const handleRunAgent = async (activityId: string, activityName: string, agentRole: { agentId: string; agentName: string | null; roleType: string }) => {
    setRunningActivity(activityId);
    try {
      const res = await apiClient.post<{ success: boolean; data: AgentExecutionInfo }>('/agent-executions', {
        orgId: activeOrgId,
        agentId: agentRole.agentId,
        activityId,
        activityName,
        roleType: agentRole.roleType,
      });
      if (res.data?.status === 'FAILED') {
        addToast('error', res.data.error || 'Agent run failed');
      } else {
        addToast('success', `${agentRole.agentName || 'Agent'} produced a draft — review it below`);
      }
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Execution failed');
    } finally {
      setRunningActivity(null);
    }
  };

  // Approve / reject / reset the human review of an agent's draft.
  const handleReviewExecution = async (executionId: string, reviewStatus: 'APPROVED' | 'REJECTED' | 'PENDING') => {
    try {
      await apiClient.patch(`/agent-executions/${executionId}/review`, { reviewStatus, reviewedBy: currentUser?.name });
      addToast('success', reviewStatus === 'PENDING' ? 'Review reset' : `Draft ${reviewStatus.toLowerCase()}`);
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update review');
    }
  };

  // Promote an approved agent draft to a real Governance Document and
  // attach it as an OUTPUT mapping of the activity. The backend does
  // all three (create doc, create mapping, mark execution APPROVED with
  // a promotedDocumentId back-link) in one call.
  const handlePromoteExecution = async (
    executionId: string,
    payload: { name: string; documentType: string; description?: string },
  ) => {
    try {
      await apiClient.post(`/agent-executions/${executionId}/promote`, {
        name: payload.name,
        documentType: payload.documentType,
        description: payload.description,
        reviewedBy: currentUser?.name,
      });
      addToast('success', 'Draft promoted to Governance Document');
      fetchData();
      return true;
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to promote draft');
      return false;
    }
  };

  // ── Agent schedules ──
  const handleCreateSchedule = async (payload: {
    activityId: string; agentId: string; roleType: string;
    frequency: 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    startAt: string;
  }): Promise<boolean> => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return false; }
    try {
      await apiClient.post('/agent-schedules', {
        orgId: activeOrgId,
        agentId: payload.agentId,
        activityId: payload.activityId,
        roleType: payload.roleType,
        frequency: payload.frequency,
        startAt: payload.startAt,
      });
      addToast('success', payload.frequency === 'ONCE' ? 'One-time schedule created' : `${payload.frequency.toLowerCase()} schedule created`);
      fetchData();
      return true;
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create schedule');
      return false;
    }
  };
  const handleToggleSchedule = async (scheduleId: string, nextStatus: 'ACTIVE' | 'PAUSED'): Promise<void> => {
    try {
      await apiClient.patch(`/agent-schedules/${scheduleId}`, { status: nextStatus });
      addToast('success', nextStatus === 'PAUSED' ? 'Schedule paused' : 'Schedule resumed');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update schedule');
    }
  };
  const handleDeleteSchedule = async (scheduleId: string): Promise<void> => {
    try {
      await apiClient.delete(`/agent-schedules/${scheduleId}`);
      addToast('success', 'Schedule removed');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to remove schedule');
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
  // Domain lens — value streams carry a governance/operational domain;
  // filtering at the root hides whole subtrees. Page-scoped (key
  // 'process-catalog'), and force-reset to All on entry so the catalog
  // always opens showing everything — without touching any other
  // page's lens (the bug this replaces). Switching it here only affects
  // this page.
  const domainLens = useDomainLens('process-catalog', 'ALL');
  const setLens = useDomainLensStore((s) => s.setLens);
  useEffect(() => {
    setLens('process-catalog', 'ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lensedTree = useMemo(
    () => tree.filter((vs) => passesLens(domainLens, processDomain(vs))),
    [tree, domainLens],
  );

  // Build the role-eligibility maps. Activity.responsibleRole is stored
  // as a label string (e.g. "Business Data Steward"); dama-roles uses
  // the roleType code ("BUSINESS_DATA_STEWARD"). Walk GOVERNANCE_ROLES
  // once to map label → roleType, then group personIds by both.
  const { governanceHolderIds, holdersByRoleLabel } = useMemo(() => {
    const roleTypeByLabel = new Map<string, string>();
    for (const r of GOVERNANCE_ROLES) roleTypeByLabel.set(r.label, r.roleType);
    const govHolders = new Set<string>();
    const byLabel = new Map<string, Set<string>>();
    const personsByRoleType = new Map<string, Set<string>>();
    for (const a of roleAssignments) {
      govHolders.add(a.personId);
      if (!personsByRoleType.has(a.roleType)) personsByRoleType.set(a.roleType, new Set());
      personsByRoleType.get(a.roleType)!.add(a.personId);
    }
    for (const r of GOVERNANCE_ROLES) {
      byLabel.set(r.label, personsByRoleType.get(r.roleType) || new Set());
    }
    return { governanceHolderIds: govHolders, holdersByRoleLabel: byLabel };
  }, [roleAssignments]);

  const issues = collectIssues(lensedTree);

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

  const buildProcessExport = (): ExportPayload => {
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
    addToast('success', `Exported ${rows.length} process nodes`);
    return {
      filenameBase: 'process-hierarchy',
      sheetName: 'Process Hierarchy',
      headers: ['Value Stream', 'Process', 'Sub-Process', 'Activity', 'Task', 'Level', 'Status', 'Description', 'Responsible Role', 'Frequency'],
      rows,
    };
  };

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Process Catalog"
        subtitle={<>Define your business processes. Required path: <strong>Value Stream</strong> → <strong>Process</strong> → <strong>Activity</strong></>}
        meta={
          <>
            <DomainLensToggle pageKey="process-catalog" />
            {/* Simple ↔ Advanced view toggle — Simple hides Compliance,
                Frequency, Risk Level, Automation and Est. Duration from
                the per-node panel and downplays rare levels in the
                legend. Default is Simple for first-time users. */}
            <div role="tablist" aria-label="View detail" style={{
              display: 'inline-flex', border: '1px solid var(--color-border)',
              borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface)',
            }}>
              {(['simple', 'advanced'] as const).map((m) => {
                const active = viewMode === m;
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewModePersist(m)}
                    title={m === 'simple' ? 'Hide rarely-used fields and levels' : 'Show every field and level'}
                    style={{
                      padding: '4px 12px', fontSize: 11,
                      fontWeight: active ? 600 : 400, border: 'none', cursor: 'pointer',
                      background: active ? 'var(--color-primary)' : 'transparent',
                      color: active ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {m === 'simple' ? 'Simple' : 'Advanced'}
                  </button>
                );
              })}
            </div>
            {/* Read-only indicator for the org's status lifecycle mode.
                The actual toggle lives in Settings — pinning it here
                would confuse users into thinking it's page-local. */}
            <span
              title={`Status lifecycle for ${statusMode === 'advanced' ? 'this org is Advanced (6 statuses: Draft → Proposed → Under Review → Approved → Active → Deprecated)' : 'this org is Simple (3 statuses: Draft → Active → Deprecated)'}. Change in Settings → Process & Asset Lifecycle.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 999,
                fontSize: 11, fontWeight: 500,
                background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
              }}
            >
              Lifecycle: <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{statusMode === 'advanced' ? 'Advanced' : 'Simple'}</strong>
              <button
                type="button"
                onClick={() => navigate('/settings')}
                title="Change lifecycle mode in Settings"
                style={{
                  padding: 0, marginLeft: 2, background: 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--color-primary)', fontSize: 11, fontWeight: 500,
                }}
              >
                Change
              </button>
            </span>
          </>
        }
        actions={
          canCreateValueStreams ? (
            <>
              {totalNodes > 0 && (
                <IconButton icon="eye" label="Visualize"
                  onClick={() => navigate('/processes/visualization')} />
              )}
              {(byLevel.VALUE_STREAM || 0) >= 2 && (
                <IconButton icon="refresh" label="Compare value streams"
                  onClick={() => navigate('/processes/compare')} />
              )}
              {canWrite && canCreateHere && (
                <IconButton icon="wand"
                  label="Generate from industry template"
                  onClick={() => navigate('/processes/wizard')} />
              )}
              {canWrite && canCreateGovernanceHere && (
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
              {totalNodes > 0 && (
                <ExportMenu build={buildProcessExport} label="Export process hierarchy" />
              )}
              {canContribute && canCreateHere && (
                <IconButton icon="plus" label="Add value stream" variant="primary"
                  onClick={() => setAddingTo('__root__')} />
              )}
            </>
          ) : totalNodes > 0 ? (
            <>
              <IconButton icon="eye" label="Visualize"
                onClick={() => navigate('/processes/visualization')} />
              {(byLevel.VALUE_STREAM || 0) >= 2 && (
                <IconButton icon="refresh" label="Compare value streams"
                  onClick={() => navigate('/processes/compare')} />
              )}
            </>
          ) : undefined
        }
      >
        <HelpPopover id="process-catalog-overview" title="Process hierarchy">
          The required path is Value Stream → Process → Activity. Optional
          levels (Domain, Capability, Sub-Process, Task) sit between for
          detail when you need it. A Value Stream can't go ACTIVE until at
          least one Process and one Activity exist underneath.
        </HelpPopover>
      </PageHeader>

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
      {activeOrgId && canCreateValueStreams && companyWithDivisions && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b33', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
          <div>
            <strong>{activeOrgName}</strong> has {subtreeDivisions.length === 1 ? 'a division' : `${subtreeDivisions.length} divisions`}. <strong>Operational</strong> value streams almost always live at the division level so each division gets its own process catalog. <strong>Governance</strong> processes are the exception — they stay corporate (one enterprise-wide program), so the <em>Generate governance processes</em> wand still works here.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 12, alignSelf: 'center', marginRight: 2 }}>Switch to:</span>
            {subtreeDivisions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setActiveOrg(d.id, d.name, 'division')}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 500,
                  background: '#fff', color: '#92400e',
                  border: '1px solid #f59e0b', borderRadius: 999, cursor: 'pointer',
                }}
              >
                {d.name}
              </button>
            ))}
          </div>
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

      {/* Cross-division link confirm. Fires when the asset's owner
          org isn't on the same vertical axis as the process node's
          org — i.e. Tidewater Water activity linking to a Tidewater
          Electric asset. Default is "warn" not "block": confirming
          creates the link normally, but the user has to acknowledge
          the cross-division reference first because it almost
          always means the wrong asset was picked. */}
      <ConfirmDialog
        open={!!pendingCrossLink}
        title="Link across divisions?"
        message={pendingCrossLink
          ? `${pendingCrossLink.assetName} is owned by ${pendingCrossLink.assetOrgName}, but ${pendingCrossLink.nodeName} sits in ${pendingCrossLink.nodeOrgName}. Cross-division links usually mean the wrong asset was picked — pick again, or confirm if this is genuinely a shared dependency.`
          : ''}
        confirmLabel="Link anyway"
        variant="primary"
        onConfirm={async () => {
          if (!pendingCrossLink) return;
          const { nodeId, target, linkType } = pendingCrossLink;
          setPendingCrossLink(null);
          await submitMapping(nodeId, target, linkType);
        }}
        onCancel={() => setPendingCrossLink(null)}
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
          <PersonPicker
            mode="single"
            valueMode="id"
            value={bulkOwnerValue || null}
            onChange={(id) => setBulkOwnerValue(id || '')}
            placeholder="-- Select person --"
          />
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

      <DomainLensActiveBanner pageKey="process-catalog" entityLabel="value streams" />

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

            {canCreateHere ? (
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
                {companyWithDivisions
                  ? <>Pick a division from the "Working in" dropdown to add value streams here.</>
                  : <>Select a <strong>company or division</strong> from the "Working in" dropdown to get started.</>}
              </p>
            )}
          </div>
        ) : lensedTree.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 2rem', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            No {domainLens === 'GOVERNANCE' ? 'governance' : 'operational'} value streams.
            {' '}Switch the lens above to see {domainLens === 'GOVERNANCE' ? 'operational' : 'governance'} processes.
          </div>
        ) : (
          lensedTree.map((node, idx) => (
            <TreeNode key={node.id} node={node} depth={0}
              onUpdate={updateNode} onDelete={deleteNode} onClone={cloneNode}
              onAddChild={(parentId) => setAddingTo(parentId)}
              expanded={expanded} toggleExpand={toggleExpand}
              selectedIds={selectedIds} toggleSelect={toggleNodeSelect}
              validChildrenMap={validChildrenMap} flows={flows}
              siblingIndex={idx} siblingCount={lensedTree.length} onReorder={reorderNode}
              onShowHistory={showHistory}
              allTags={allTags}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              peopleList={peopleList}
              assetsList={assetsList}
              policiesList={policiesList}
              systemsList={systemsList}
              mappingsByStep={mappingsByStep}
              activePageOrgId={activeOrgId || ''}
              onAddMapping={addMapping}
              onRemoveMapping={removeMapping}
              onRestoreMapping={restoreMapping}
              statusMode={statusMode}
              agentExecByActivity={agentExecByActivity}
              onRunAgent={handleRunAgent}
              onReviewExecution={handleReviewExecution}
              onPromoteExecution={handlePromoteExecution}
              runningActivity={runningActivity}
              agentRoles={agentRoleOptions}
              governanceHolderIds={governanceHolderIds}
              holdersByRoleLabel={holdersByRoleLabel}
              viewMode={viewMode}
              ancestorStatusChain={[]}
              schedulesByActivity={schedulesByActivity}
              onCreateSchedule={handleCreateSchedule}
              onToggleSchedule={handleToggleSchedule}
              onDeleteSchedule={handleDeleteSchedule} />
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
