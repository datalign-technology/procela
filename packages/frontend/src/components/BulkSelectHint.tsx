import { useState, useEffect } from 'react';

// A one-time amber hint that surfaces bulk-select. The row checkboxes
// on tables like Data Assets are very easy to miss until you realise
// they're clickable — newcomers were never told the page supported
// bulk operations at all. We show this banner the first time the page
// has rows and nothing is selected; once dismissed it never returns
// (per-key localStorage flag).

const STORAGE_PREFIX = 'procela:bulk-hint-dismissed:';

interface Props {
  /** Stable key so multiple pages don't share one dismissal flag. */
  storageKey?: string;
  /** Whether there's anything in the list to select. Hint stays hidden
   *  on empty pages where the checkboxes would be pointless. */
  hasItems: boolean;
  /** When the user has already selected something they've clearly
   *  discovered the feature — suppress the hint. */
  hasSelection: boolean;
  /** Human label for what's being bulk-edited, plural. Defaults to "rows". */
  itemLabel?: string;
}

export default function BulkSelectHint({
  storageKey = 'data-assets',
  hasItems,
  hasSelection,
  itemLabel = 'rows',
}: Props) {
  const flag = STORAGE_PREFIX + storageKey;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(flag) === 'true'; } catch { return false; }
  });

  // If the user makes a selection, treat that as discovery and quietly
  // mark the hint dismissed so it doesn't pop back later.
  useEffect(() => {
    if (hasSelection && !dismissed) {
      try { localStorage.setItem(flag, 'true'); } catch { /* */ }
      setDismissed(true);
    }
  }, [hasSelection, dismissed, flag]);

  if (dismissed || !hasItems || hasSelection) return null;

  const dismiss = () => {
    try { localStorage.setItem(flag, 'true'); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div
      role="note"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', marginBottom: 10,
        background: '#fef3c7', border: '1px solid #fde68a',
        borderRadius: 'var(--radius-md)', fontSize: 12, color: '#92400e',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14 }}>☑</span>
      <span>
        <strong>Tip:</strong> tick the checkboxes on the left to bulk-edit, delete or change tier on multiple {itemLabel} at once.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss bulk-select tip"
        style={{
          marginLeft: 'auto',
          background: 'transparent', border: 'none',
          color: '#92400e', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
