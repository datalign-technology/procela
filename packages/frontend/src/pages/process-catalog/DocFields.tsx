import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import PersonPicker from '../../components/PersonPicker';
import { GOVERNANCE_ROLES } from '../../types';
import { inputStyle, ROLE_OPTIONS, type SystemRef, type SystemLink } from '../ProcessCatalogPage';
import { clickable } from '../../lib/a11y';
import { apiClient } from '../../api/client';

// ── Field-type tag ──
// The mono "field type" annotation the Process Catalog — Enhanced mock-ups show
// beside every field label (e.g. "Short text", "Pick list", "Reference ·
// People"). Presentational only — it names what kind of value the field holds.
// Pushed to the right of the field row; wraps-safe and never clips the control.
export function TypeTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        marginLeft: 'auto', flexShrink: 0, alignSelf: 'baseline',
        fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.4,
        color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
        paddingLeft: 8,
      }}
    >
      {children}
    </span>
  );
}

// ── Calculated / rolled-up read-only field ──
// The mock-ups render derived values (systems/roles rolled up from the
// activities underneath, etc.) in a distinctly read-only way: a tinted,
// non-editable box with a leading padlock, a "Calculated" type slot in place
// of an editable field-type, and a caption stating the derivation. Presentation
// only — it never writes. Pass `chips` for a set of values, or `text` for one.
export function DocCalculated({ label, chips, text, caption, emptyText = 'None yet' }: {
  label: string;
  /** A set of derived values rendered as neutral chips. */
  chips?: string[];
  /** A single derived value (used when `chips` is absent). */
  text?: string;
  /** Short line stating how the value is derived. */
  caption?: string;
  /** Shown (italic, muted) when there is nothing to roll up. */
  emptyText?: string;
}) {
  const hasChips = !!(chips && chips.length);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 7 }}>{label}:</span>
      <div style={{ flex: 1, maxWidth: 420 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          background: 'var(--color-calc-fill)', border: '1px solid var(--color-border-subtle)',
          borderRadius: 8, padding: '6px 10px', minHeight: 26,
        }}>
          <Lock size={12} aria-hidden="true" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          {hasChips ? (
            chips!.map((c) => (
              <span key={c} style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 6, padding: '1px 7px', fontSize: 10, color: 'var(--color-text)',
              }}>{c}</span>
            ))
          ) : text ? (
            <span style={{ color: 'var(--color-text)' }}>{text}</span>
          ) : (
            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{emptyText}</span>
          )}
        </div>
        {caption && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>{caption}</div>}
      </div>
      <TypeTag>
        <Lock size={10} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 3 }} />
        Calculated
      </TypeTag>
    </div>
  );
}

// ── Inline Edit ──

export function InlineEdit({ value, onSave, fontSize = 13, fontWeight = 400, placeholder = 'Click to edit...', disabled = false }: {
  value: string; onSave: (v: string) => void; fontSize?: number; fontWeight?: number; placeholder?: string; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing || disabled) {
    return (
      <span {...clickable(() => { setDraft(value); setEditing(true); }, { label: 'Edit field', disabled })}
        style={{ cursor: disabled ? 'default' : 'pointer', fontSize, fontWeight, opacity: disabled ? 0.7 : 1 }}
        title={disabled ? 'Locked — change status to Draft to edit' : 'Click to edit'}>
        {value || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{placeholder}</span>}
      </span>
    );
  }
  return (
    <div>
      <input autoFocus aria-label="Value" style={{ ...inputStyle, fontSize, fontWeight, width: '100%' }} value={draft}
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

export function DocField({ label, value, onSave, disabled, placeholder, typeLabel }: {
  label: string; value: string; onSave: (v: string) => void; disabled: boolean; placeholder: string;
  /** Optional mock-up field-type annotation (e.g. "Short text", "Date"). */
  typeLabel?: string;
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
          <input autoFocus aria-label={label} style={{ ...inputStyle, fontSize: 11, padding: '2px 6px', width: '100%' }}
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
            {...clickable(() => { setDraft(value); setEditing(true); }, { label: `Edit ${label}`, disabled })}
            style={{ cursor: disabled ? 'default' : 'pointer', color: value ? 'var(--color-text)' : 'var(--color-text-muted)', fontStyle: value ? 'normal' : 'italic', opacity: disabled ? 0.6 : 1 }}
            title={disabled ? 'Locked' : 'Click to edit'}
          >
            {value || placeholder}
          </span>
          {saved && <span style={{ color: 'var(--color-success)', fontSize: 9, fontWeight: 600 }}>Saved</span>}
        </>
      )}
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Documentation Dropdown (single select from predefined list) ──

export function DocDropdown({ label, value, options, onSave, disabled, placeholder, typeLabel }: {
  label: string; value: string; options: string[]; onSave: (v: string) => void; disabled: boolean; placeholder: string;
  /** Optional mock-up field-type annotation (e.g. "Pick list"). */
  typeLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>{label}:</span>
      <select
        aria-label={label}
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
      {saved && <span style={{ color: 'var(--color-success)', fontSize: 9, fontWeight: 600 }}>Saved</span>}
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Criticality Tier + RTO Hours — BCM attributes on activities.
//    Tier maps between the stored enum ("TIER_1") and the display
//    label ("Tier 1 — Mission critical"); RTO stores hours as a
//    number. Both accept null / empty to clear. ──

const TIER_LABELS: Record<string, string> = {
  '': 'Not rated',
  TIER_1: 'Tier 1 — Mission critical',
  TIER_2: 'Tier 2 — Business critical',
  TIER_3: 'Tier 3 — Standard',
  TIER_4: 'Tier 4 — Non-critical',
};

export function TierField({ value, onSave, disabled, typeLabel }: {
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
  typeLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>Criticality:</span>
      <select
        aria-label="Criticality"
        value={value}
        onChange={(e) => { onSave(e.target.value); setSaved(true); setTimeout(() => setSaved(false), 1500); }}
        disabled={disabled}
        style={{ ...inputStyle, fontSize: 11, padding: '2px 6px', width: 260, appearance: 'auto' as any }}
      >
        {Object.entries(TIER_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
      {saved && <span style={{ color: 'var(--color-success)', fontSize: 9, fontWeight: 600 }}>Saved</span>}
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

export function RtoField({ value, onSave, disabled, typeLabel }: {
  value: number | undefined;
  onSave: (v: number | null) => void;
  disabled: boolean;
  typeLabel?: string;
}) {
  const [draft, setDraft] = useState<string>(value !== undefined ? String(value) : '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(value !== undefined ? String(value) : ''); }, [value]);
  const commit = () => {
    if (draft.trim() === '') {
      if (value !== undefined) { onSave(null); setSaved(true); setTimeout(() => setSaved(false), 1500); }
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) { setDraft(value !== undefined ? String(value) : ''); return; }
    if (n !== value) { onSave(n); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>RTO (hours):</span>
      <input
        type="number"
        aria-label="RTO (hours)"
        min={0}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        disabled={disabled}
        placeholder="e.g. 4"
        style={{ ...inputStyle, fontSize: 11, padding: '2px 6px', width: 90 }}
      />
      {saved && <span style={{ color: 'var(--color-success)', fontSize: 9, fontWeight: 600 }}>Saved</span>}
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

export function RpoField({ value, onSave, disabled, typeLabel }: {
  value: number | undefined;
  onSave: (v: number | null) => void;
  disabled: boolean;
  typeLabel?: string;
}) {
  const [draft, setDraft] = useState<string>(value !== undefined ? String(value) : '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(value !== undefined ? String(value) : ''); }, [value]);
  const commit = () => {
    if (draft.trim() === '') {
      if (value !== undefined) { onSave(null); setSaved(true); setTimeout(() => setSaved(false), 1500); }
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) { setDraft(value !== undefined ? String(value) : ''); return; }
    if (n !== value) { onSave(n); setSaved(true); setTimeout(() => setSaved(false), 1500); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>RPO (hours):</span>
      <input
        type="number"
        aria-label="RPO (hours)"
        min={0}
        step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        disabled={disabled}
        placeholder="e.g. 1"
        style={{ ...inputStyle, fontSize: 11, padding: '2px 6px', width: 90 }}
        title="Recovery Point Objective — how much data loss (in time) is tolerable"
      />
      {saved && <span style={{ color: 'var(--color-success)', fontSize: 9, fontWeight: 600 }}>Saved</span>}
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Controls Picker — multi-select for the governance controls this
//    activity implements or is subject to. Options come from the
//    governance-controls store; selection is stored as controlIds on
//    the node. ──

export function ControlsPicker({ selected, options, onChange, disabled, typeLabel }: {
  selected: string[];
  options: Array<{ id: string; code: string; name: string; policyId: string }>;
  onChange: (ids: string[]) => void;
  disabled: boolean;
  typeLabel?: string;
}) {
  const [adding, setAdding] = useState('');
  const toggle = (id: string) => onChange(selected.filter((x) => x !== id));
  const optionById = new Map(options.map((o) => [o.id, o]));
  const add = (id: string) => {
    if (!id || selected.includes(id)) return;
    onChange([...selected, id]);
    setAdding('');
  };
  const available = options.filter((o) => !selected.includes(o.id));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 3 }}>Controls:</span>
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {selected.map((id) => {
          const opt = optionById.get(id);
          if (!opt) {
            return (
              <span key={id} title="Referenced control has been deleted" style={{ background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>
                Unknown control
                {!disabled && (
                  <button onClick={() => toggle(id)} aria-label="Remove control" style={{ background: 'transparent', border: 'none', color: '#92400e', cursor: 'pointer', marginLeft: 4, padding: 0 }}><span aria-hidden="true">×</span></button>
                )}
              </span>
            );
          }
          return (
            <span key={id} title={opt.name} style={{ background: '#e0e7ff', color: '#3730a3', padding: '1px 6px', borderRadius: 3, fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <strong>{opt.code}</strong> {opt.name}
              {!disabled && (
                <button onClick={() => toggle(id)} aria-label={`Remove ${opt.name}`} style={{ background: 'transparent', border: 'none', color: '#3730a3', cursor: 'pointer', padding: 0 }}><span aria-hidden="true">×</span></button>
              )}
            </span>
          );
        })}
        {selected.length === 0 && <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>None</span>}
        {!disabled && (
          available.length > 0 ? (
            <select
              aria-label="Add control"
              value={adding}
              onChange={(e) => add(e.target.value)}
              style={{ fontSize: 10, padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)' }}
            >
              <option value="">+ Add control…</option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
              ))}
            </select>
          ) : (
            options.length === 0 && <span style={{ color: 'var(--color-text-muted)', fontSize: 9, fontStyle: 'italic' }}>Define controls on Governance Documents first</span>
          )
        )}
      </div>
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Person field — inline label + shared PersonPicker. Replaces the
//    flat name-only Owner dropdown / Stakeholders multiselect so users
//    get org-tree / group / search context and name disambiguation.
//    Owner stores ownerId (valueMode="id"); Stakeholders keeps the
//    legacy comma-joined *name* string (valueMode="name") so no data
//    migration is needed. ──

export function DocPersonField({ label, mode, valueMode, value, onChange, disabled, domain, eligibleKeys, disabledHint, disabledHintLink, placeholder, orgId, typeLabel }: {
  label: string;
  mode: 'single' | 'multi';
  valueMode: 'id' | 'name';
  value: string | string[] | null;
  onChange: (v: any) => void;
  disabled: boolean;
  domain?: 'GOVERNANCE' | 'OPERATIONAL';
  /** Scope the picker to this org's tree (the active "Working in…" org).
   *  Without it the picker lists every person the caller can see — which
   *  for a super-admin spans sibling tenants. */
  orgId?: string;
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
  /** Optional mock-up field-type annotation (e.g. "Reference · People"). */
  typeLabel?: string;
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
          orgId={orgId}
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
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
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
export function DocRoleField({ value, onSave, disabled, domain, label = 'Responsible Role', typeLabel }: {
  value: string;
  onSave: (v: string) => void;
  disabled: boolean;
  domain: 'GOVERNANCE' | 'OPERATIONAL';
  /** Field label — defaults to "Responsible Role"; set to "Accountable Role"
   *  (or similar) to reuse the same role picker for another RACI slot. */
  label?: string;
  /** Optional mock-up field-type annotation (e.g. "Reference · Roles"). */
  typeLabel?: string;
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
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0 }}>{label}:</span>
      <select
        aria-label={label}
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
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Documentation Multi-Select (chips with add dropdown) ──

export function DocMultiSelect({ label, selected, options, onSave, disabled, placeholder, typeLabel }: {
  label: string; selected: string[]; options: string[]; onSave: (vals: string[]) => void; disabled: boolean; placeholder: string;
  /** Optional mock-up field-type annotation (e.g. "Multi-select"). */
  typeLabel?: string;
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
            aria-label={`Add ${label}`}
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
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// ── Systems picker — selects from registered Systems by id ─────────────────
// Distinct from DocMultiSelect because options are id/name pairs, not
// flat strings. Same visual treatment so it nests naturally with the
// other Doc* fields in the node panel.
export function DocSystemsField({ selected, options, links, onSave, onSaveLinks, connectionsBySystem, disabled, typeLabel }: {
  selected: string[]; options: SystemRef[];
  /** Per-system reference metadata, keyed by systemId. */
  links?: SystemLink[];
  onSave: (ids: string[]) => void;
  /** Persist the full set of per-system references. Optional so the field
   *  degrades to a plain picker if a host doesn't wire references. */
  onSaveLinks?: (links: SystemLink[]) => void;
  /** Live connections available per system id — drives the discover-fed
   *  source-key picker. A system with no entry falls back to free-text refs. */
  connectionsBySystem?: Record<string, { id: string; name: string }[]>;
  disabled: boolean;
  /** Optional mock-up field-type annotation (e.g. "Reference · Systems"). */
  typeLabel?: string;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const linkById = new Map((links ?? []).map((l) => [l.systemId, l]));
  const available = options.filter((o) => !selected.includes(o.id));
  // Which system's reference editor is open (null = none).
  const [editing, setEditing] = useState<string | null>(null);
  const canEditRefs = !disabled && !!onSaveLinks;

  // Replace one system's reference in the full links array, dropping empties.
  // A reference is either a free-text externalRef (+label/url) or a structured
  // source-key pointer (connection + table + column); the pointer's three
  // parts travel together, matching the backend's validation.
  const saveRef = (systemId: string, next: {
    externalRef?: string; refLabel?: string; refUrl?: string;
    sourceConnectionId?: string; sourceAsset?: string; sourceColumn?: string; isKey?: boolean;
  }) => {
    if (!onSaveLinks) return;
    const externalRef = next.externalRef?.trim() || undefined;
    const refLabel = next.refLabel?.trim() || undefined;
    const refUrl = next.refUrl?.trim() || undefined;
    const sourceConnectionId = next.sourceConnectionId?.trim() || undefined;
    const sourceAsset = next.sourceAsset?.trim() || undefined;
    const sourceColumn = next.sourceColumn?.trim() || undefined;
    const hasPointer = !!(sourceConnectionId && sourceAsset && sourceColumn);
    const others = (links ?? []).filter((l) => l.systemId !== systemId);
    const entry: SystemLink = {
      systemId,
      ...(externalRef ? { externalRef } : {}),
      ...(refLabel ? { refLabel } : {}),
      ...(refUrl ? { refUrl } : {}),
      ...(hasPointer ? { sourceConnectionId, sourceAsset, sourceColumn, ...(next.isKey ? { isKey: true } : {}) } : {}),
    };
    const keep = externalRef || refLabel || refUrl || hasPointer;
    onSaveLinks(keep ? [...others, entry] : others);
    setEditing(null);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 2 }}>Systems:</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
          {selected.map((id) => {
            const s = byId.get(id);
            const link = linkById.get(id);
            // A structured source-key column takes display precedence over the
            // free-text externalRef; `ref` (either) drives the ✎ vs +ref label.
            const keyCol = link?.sourceColumn;
            const ref = keyCol || link?.externalRef;
            return (
              <span key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
              }}>
                <Link to={`/systems?highlight=${id}`} title={`Open ${s?.name || 'system'}`}
                  style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  {s?.name || id}
                </Link>
                {keyCol ? (
                  <span title={`${link?.sourceAsset ? link.sourceAsset + ' · ' : ''}${keyCol}${link?.isKey ? ' (unique key)' : ''}`}
                    style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, opacity: 0.85, borderLeft: '1px solid #93c5fd', paddingLeft: 3, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {link?.isKey ? '🔑' : ''}{keyCol}
                  </span>
                ) : link?.externalRef ? (
                  link.refUrl
                    ? <a href={link.refUrl} target="_blank" rel="noreferrer" title={link.refLabel || 'Open reference'}
                        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, color: '#1e40af', opacity: 0.85, textDecoration: 'underline' }}>{link.externalRef}</a>
                    : <span title={link?.refLabel || 'System reference'}
                        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, opacity: 0.8, borderLeft: '1px solid #93c5fd', paddingLeft: 3 }}>{link.externalRef}</span>
                ) : null}
                {canEditRefs && (
                  <button onClick={() => setEditing(editing === id ? null : id)}
                    title={ref ? 'Edit system reference' : 'Add a system reference (id in this system)'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#1e40af', padding: 0, lineHeight: 1, opacity: 0.75 }}>
                    {ref ? '✎' : '+ref'}
                  </button>
                )}
                {!disabled && (
                  <button onClick={() => onSave(selected.filter((sid) => sid !== id))}
                    title="Unlink system"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#1e40af', padding: 0, lineHeight: 1 }}>&times;</button>
                )}
              </span>
            );
          })}
          {!disabled && available.length > 0 && (
            <select
              aria-label="Add system"
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
        {editing && canEditRefs && (
          <SystemRefEditor
            systemName={byId.get(editing)?.name || editing}
            link={linkById.get(editing)}
            connections={connectionsBySystem?.[editing] ?? []}
            onSave={(next) => saveRef(editing, next)}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
      {typeLabel && <TypeTag>{typeLabel}</TypeTag>}
    </div>
  );
}

// Inline editor for a single activity↔system reference: the external id that
// locates this activity in the system of record, an optional label, and an
// optional deep link. Rendered under the chip row when a chip's ✎/+ref is
// clicked.
/** A discovered table/collection and its columns, as the connection's
 *  discover endpoint returns them. */
type DiscoveredAsset = { name: string; type?: string; columns?: string[] };

function SystemRefEditor({ systemName, link, connections, onSave, onCancel }: {
  systemName: string;
  link?: SystemLink;
  /** Live connections for this system — when present, the structured
   *  source-key picker is offered above the free-text fields. */
  connections: { id: string; name: string }[];
  onSave: (next: {
    externalRef?: string; refLabel?: string; refUrl?: string;
    sourceConnectionId?: string; sourceAsset?: string; sourceColumn?: string; isKey?: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [externalRef, setExternalRef] = useState(link?.externalRef ?? '');
  const [refLabel, setRefLabel] = useState(link?.refLabel ?? '');
  const [refUrl, setRefUrl] = useState(link?.refUrl ?? '');
  // Structured source-key pointer.
  const [sourceConnectionId, setSourceConnectionId] = useState(link?.sourceConnectionId ?? '');
  const [sourceAsset, setSourceAsset] = useState(link?.sourceAsset ?? '');
  const [sourceColumn, setSourceColumn] = useState(link?.sourceColumn ?? '');
  const [isKey, setIsKey] = useState(!!link?.isKey);
  // Discovered schema for the chosen connection.
  const [assets, setAssets] = useState<DiscoveredAsset[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  // Ephemeral sample preview.
  const [sampleValues, setSampleValues] = useState<string[] | null>(null);
  const [sampleTruncated, setSampleTruncated] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const field: React.CSSProperties = { ...inputStyle, fontSize: 11, padding: '3px 6px' };
  const sel: React.CSSProperties = { ...field, cursor: 'pointer' };

  async function loadSchema(connId: string) {
    setLoadingSchema(true); setSchemaError(null);
    try {
      const r = await apiClient.post<{ success: boolean; data?: { details?: { assets?: DiscoveredAsset[] } } }>(`/connections/${connId}/discover`);
      setAssets(r.data?.details?.assets ?? []);
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : 'Could not read this connection’s schema');
      setAssets([]);
    } finally {
      setLoadingSchema(false);
    }
  }

  // Load the schema for a pre-set connection (editing an existing pointer).
  useEffect(() => {
    if (sourceConnectionId) void loadSchema(sourceConnectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickConnection(connId: string) {
    setSourceConnectionId(connId);
    setSourceAsset(''); setSourceColumn(''); setAssets([]);
    setSampleValues(null); setSampleError(null); setSampleTruncated(false);
    if (connId) void loadSchema(connId);
  }

  const columns = assets.find((a) => a.name === sourceAsset)?.columns ?? [];

  async function preview() {
    if (!sourceConnectionId || !sourceAsset || !sourceColumn) return;
    setSampleLoading(true); setSampleError(null); setSampleValues(null); setSampleTruncated(false);
    try {
      const r = await apiClient.post<{ success: boolean; data: { values: string[]; truncated: boolean } }>(
        `/connections/${sourceConnectionId}/sample`, { table: sourceAsset, column: sourceColumn },
      );
      setSampleValues(r.data.values); setSampleTruncated(r.data.truncated);
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setSampleLoading(false);
    }
  }

  const save = () => onSave({
    externalRef, refLabel, refUrl,
    sourceConnectionId: sourceConnectionId || undefined,
    sourceAsset: sourceAsset || undefined,
    sourceColumn: sourceColumn || undefined,
    isKey,
  });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px',
      background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6,
    }}>
      {connections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Identifying field in {systemName}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <select aria-label="Connection" value={sourceConnectionId} onChange={(e) => pickConnection(e.target.value)} style={{ ...sel, width: 150 }}>
              <option value="">Connection…</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Table" value={sourceAsset} disabled={!sourceConnectionId || loadingSchema}
              onChange={(e) => { setSourceAsset(e.target.value); setSourceColumn(''); setSampleValues(null); }} style={{ ...sel, width: 160 }}>
              <option value="">{loadingSchema ? 'Loading…' : 'Table…'}</option>
              {assets.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            <select aria-label="Field" value={sourceColumn} disabled={!sourceAsset}
              onChange={(e) => { setSourceColumn(e.target.value); setSampleValues(null); }} style={{ ...sel, width: 150 }}>
              <option value="">Field…</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isKey} onChange={(e) => setIsKey(e.target.checked)} /> unique key
            </label>
            <button onClick={() => void preview()} disabled={!sourceColumn || sampleLoading}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: sourceColumn ? 'pointer' : 'not-allowed', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', opacity: sourceColumn ? 1 : 0.5 }}>
              {sampleLoading ? 'Sampling…' : 'Preview values'}
            </button>
          </div>
          {schemaError && <span style={{ fontSize: 10, color: 'var(--color-error)' }}>{schemaError}</span>}
          {sampleError && <span style={{ fontSize: 10, color: 'var(--color-error)' }}>{sampleError}</span>}
          {sampleValues && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {sampleValues.length === 0
                ? <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No values found</span>
                : sampleValues.map((v, i) => (
                    <span key={i} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>{v}</span>
                  ))}
              {sampleTruncated && <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>…more</span>}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
          {connections.length > 0 ? 'Or free-text ref:' : `Reference in ${systemName}:`}
        </span>
        <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="ID (e.g. INC-WF-014)"
          aria-label="System reference id" style={{ ...field, width: 150 }} autoFocus={connections.length === 0} />
        <input value={refLabel} onChange={(e) => setRefLabel(e.target.value)} placeholder="Label (optional)"
          aria-label="Reference label" style={{ ...field, width: 130 }} />
        <input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="Link URL (optional)"
          aria-label="Reference URL" style={{ ...field, width: 160 }} />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save}
          style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: '#fff' }}>Save</button>
        <button onClick={onCancel}
          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)' }}>Cancel</button>
      </div>
    </div>
  );
}
