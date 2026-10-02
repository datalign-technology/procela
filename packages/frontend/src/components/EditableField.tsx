import type { CSSProperties, ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// EditableField — one labelled field on an entity detail surface that renders
// its VALUE in view mode and the matching INPUT in edit mode, from the same
// call site. Replaces the per-page local `Field` helper that was copy-pasted
// across the detail pages (and could only ever render read-only).
//
// View mode: the label + `children` (custom: badges, links) or the plain
// `value` (or a muted `emptyText` when blank) — pixel-identical to the old
// `Field`, so switching a page to this changes nothing until it enters edit.
// Edit mode: the label + `renderEdit()` (custom editors: pickers) or a
// built-in text / textarea / number / select bound to `value` + `onChange`.
//
// Pair with useDetailEditMode (supplies `editing`) + <DetailEditActions>.
// ──────────────────────────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2,
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const emptyStyle: CSSProperties = { color: 'var(--color-text-muted)', fontStyle: 'italic' };
const inputStyle: CSSProperties = {
  fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '5px 8px', width: '100%', background: 'var(--color-surface)',
  color: 'var(--color-text)', boxSizing: 'border-box',
};

interface Props {
  label: string;
  editing: boolean;
  /** Custom view content (badges, links, chips). Falls back to `value`. */
  children?: ReactNode;
  /** The field's current (draft) value — the input binding and the view
   *  fallback. */
  value?: string;
  onChange?: (value: string) => void;
  type?: 'text' | 'textarea' | 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Text shown muted in view mode when the value is blank. Default "—". */
  emptyText?: string;
  /** Custom editor (org / skill pickers, chip editors). Overrides the
   *  built-in input in edit mode. */
  renderEdit?: () => ReactNode;
  /** Field wrapper style (e.g. gridColumn span). */
  style?: CSSProperties;
}

export default function EditableField({
  label, editing, children, value, onChange,
  type = 'text', options, placeholder, emptyText = '—', renderEdit, style,
}: Props) {
  return (
    <div style={style}>
      <div style={labelStyle}>{label}</div>
      {editing ? (
        <div style={{ fontSize: 13 }}>
          {renderEdit ? renderEdit() : type === 'textarea' ? (
            <textarea
              aria-label={label}
              value={value ?? ''}
              placeholder={placeholder}
              onChange={(e) => onChange?.(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', font: 'inherit' }}
            />
          ) : type === 'select' ? (
            <select
              aria-label={label}
              value={value ?? ''}
              onChange={(e) => onChange?.(e.target.value)}
              style={{ ...inputStyle, appearance: 'auto' }}
            >
              {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              aria-label={label}
              type={type === 'number' ? 'number' : 'text'}
              value={value ?? ''}
              placeholder={placeholder}
              onChange={(e) => onChange?.(e.target.value)}
              style={inputStyle}
            />
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13 }}>
          {children ?? (value ? value : <span style={emptyStyle}>{emptyText}</span>)}
        </div>
      )}
    </div>
  );
}
