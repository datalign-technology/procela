import { useCallback, useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// useDetailEditMode — the shared view/edit state machine for entity detail
// surfaces (detail pages and detail modals).
//
// Every detail surface opens in VIEW mode (read-only) and flips the SAME
// layout into editable inputs when the user hits Edit — one Save writes the
// staged draft, Cancel discards it. This hook owns that state so no page
// hand-rolls it (which is how Person drifted into always-on inline editing
// while Agent/Skill/… stayed read-only).
//
// Pair it with <DetailEditActions> (the Edit / Save·Cancel header cluster)
// and <EditableField> (renders a value in view mode, the right input in edit
// mode). See components/README.md → "Detail view/edit".
//
// Usage:
//   const m = useDetailEditMode(editableSubsetOfRecord, (draft) =>
//     apiClient.put(`/organizations/${id}`, draft).then(fetchAll));
//   ...
//   <EditableField label="Industry" editing={m.isEditing}
//     value={m.draft.industry} onChange={(v) => m.set('industry', v)} />
//
// `initial` may be a fresh object each render — the hook reseeds the draft
// from it only while in VIEW mode and only when its VALUE changed (serialised
// compare), so a re-fetch after Save flows in without clobbering an active
// edit or looping on referential churn.
// ──────────────────────────────────────────────────────────────────────────

export interface DetailEditMode<T> {
  mode: 'view' | 'edit';
  isEditing: boolean;
  draft: T;
  /** draft differs from the baseline it was entered/seeded with. */
  dirty: boolean;
  saving: boolean;
  enter: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  patch: (partial: Partial<T>) => void;
}

export function useDetailEditMode<T extends object>(
  initial: T,
  onSave: (draft: T) => Promise<void>,
): DetailEditMode<T> {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  // Baseline we diff against for `dirty` and restore to on cancel.
  const baseline = useRef<T>(initial);
  // Value-identity of the last `initial` we seeded from, so fresh-but-equal
  // objects on every render don't trigger a reseed / render loop.
  const seededKey = useRef<string>(JSON.stringify(initial));

  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    if (mode === 'view' && seededKey.current !== initialKey) {
      seededKey.current = initialKey;
      baseline.current = initial;
      setDraft(initial);
    }
    // Keep the key current even while editing so re-entering view doesn't
    // reseed from stale server data the user already moved past.
    if (mode === 'view') seededKey.current = initialKey;
  }, [initialKey, mode, initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);

  const enter = useCallback(() => {
    setDraft((d) => { baseline.current = d; return d; });
    setMode('edit');
  }, []);

  const cancel = useCallback(() => {
    setDraft(baseline.current);
    setMode('view');
  }, []);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const patch = useCallback((partial: Partial<T>) => {
    setDraft((d) => ({ ...d, ...partial }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      baseline.current = draft;
      seededKey.current = JSON.stringify(draft);
      setMode('view');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  return { mode, isEditing: mode === 'edit', draft, dirty, saving, enter, cancel, save, set, patch };
}
