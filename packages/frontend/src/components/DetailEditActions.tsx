import type { ReactNode } from 'react';
import Button from './Button';
import SecondaryButton from './SecondaryButton';

// ──────────────────────────────────────────────────────────────────────────
// DetailEditActions — the Edit / Save·Cancel control cluster for an entity
// detail surface, dropped into a PageHeader `actions` slot or a Modal
// `actions` slot. Pairs with useDetailEditMode + <EditableField>.
//
// View mode → an "Edit" button (hidden when !canEdit; disabled with a hint
// when a reason is supplied, e.g. an inherited / locked record).
// Edit mode → "Cancel" (discards) + "Save changes" (disabled until dirty).
//
// `before` renders to the LEFT of the cluster in both modes — the slot for a
// detail page's "← Back to X" link, so navigation stays put while the right
// cluster swaps.
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  editing: boolean;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** Label for the view-mode trigger. Defaults to "Edit". */
  editLabel?: string;
  /** When canEdit is false but there's a reason worth surfacing (inherited /
   *  locked record), pass it: the Edit button then shows disabled with this
   *  tooltip instead of being hidden. */
  disabledHint?: string;
  /** Rendered to the left of the cluster in both modes (e.g. a Back link). */
  before?: ReactNode;
}

export default function DetailEditActions({
  editing, canEdit, dirty, saving, onEdit, onCancel, onSave,
  editLabel = 'Edit', disabledHint, before,
}: Props) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {before}
      {editing ? (
        <>
          <SecondaryButton onClick={onCancel} disabled={saving}>Cancel</SecondaryButton>
          <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!dirty || saving}>
            Save changes
          </Button>
        </>
      ) : canEdit ? (
        <Button variant="primary" size="sm" onClick={onEdit}>{editLabel}</Button>
      ) : disabledHint ? (
        <Button variant="primary" size="sm" disabled title={disabledHint}>{editLabel}</Button>
      ) : null}
    </div>
  );
}
