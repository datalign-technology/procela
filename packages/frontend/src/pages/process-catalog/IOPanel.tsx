import { useEffect, useMemo, useState } from 'react';
import { Check, AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import HelpPopover from '../../components/HelpPopover';
import { tierLabel } from '../../lib/governanceTier';
import { badgeColor } from '../../lib/badgeColors';
import { useToastStore } from '../../stores/toastStore';
import type { MappingInfo, DataAssetRef, PolicyRef } from '../ProcessCatalogPage';

const DATA_FORMAT_OPTIONS = ['API', 'CSV', 'JSON', 'XML', 'Database', 'File Transfer', 'Manual Entry', 'Spreadsheet', 'Real-time Stream', 'Batch', 'Paper', 'Other'];
const CRITICALITY_OPTIONS = ['REQUIRED', 'OPTIONAL'];

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
    <div style={{ marginTop: 'var(--space-section)', padding: '8px 10px', background: '#f8fafc', borderRadius: 4, border: '1px solid var(--color-border)' }}>
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

export default IOPanel;
