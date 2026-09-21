import { useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// EditableTitle — the PageHeader H1, optionally renamable in place. When an
// `onRename` handler is supplied a quiet pencil sits after the title; clicking
// it swaps the H1 for an input pre-filled with the name. Enter or blur commits
// (only if changed and non-empty), Escape cancels. Without `onRename` it is
// just the plain H1, so pages that can't (or shouldn't) rename — e.g. a Person
// whose name is IdP-sourced — pass nothing and get the read-only heading.
// ──────────────────────────────────────────────────────────────────────────

const H1_STYLE = { fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.25, margin: 0 } as const;

interface EditableTitleProps {
  title: string;
  /** Persist the new name. May be async; throw to keep the editor open. */
  onRename?: (name: string) => void | Promise<void>;
  /** Tooltip / accessible name for the pencil + input. Defaults to "Rename". */
  renameLabel?: string;
}

function PencilGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function EditableTitle({ title, onRename, renameLabel = 'Rename' }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with the title when not actively editing (e.g. the
  // parent refetched, or a rename landed).
  useEffect(() => { if (!editing) setDraft(title); }, [title, editing]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  if (!onRename) {
    return <h1 style={H1_STYLE}>{title}</h1>;
  }

  const cancel = () => { setDraft(title); setEditing(false); };
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === title) { cancel(); return; }
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch {
      // The parent surfaces the error; stay in edit mode so the user can retry.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onBlur={commit}
        aria-label={renameLabel}
        style={{
          ...H1_STYLE,
          fontFamily: 'inherit',
          border: '1px solid var(--color-primary)', borderRadius: 4,
          padding: '1px 6px', color: 'var(--color-text)', background: 'var(--color-surface)',
          minWidth: 0, maxWidth: '100%',
        }}
      />
    );
  }

  return (
    <>
      <h1 style={H1_STYLE}>{title}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={renameLabel}
        title={renameLabel}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, padding: 0, border: 'none', background: 'transparent',
          borderRadius: 4, color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0,
          transition: 'color 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
      >
        <PencilGlyph />
      </button>
    </>
  );
}
