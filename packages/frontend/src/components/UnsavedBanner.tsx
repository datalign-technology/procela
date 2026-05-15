interface UnsavedBannerProps {
  visible: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
}

export default function UnsavedBanner({ visible, onSave, onDiscard, saving }: UnsavedBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 16px', marginBottom: 12,
      background: '#fffbeb', border: '1px solid #fcd34d',
      borderRadius: 'var(--radius-md)', fontSize: 13,
    }}>
      <span style={{ color: '#92400e', fontWeight: 500 }}>
        You have unsaved changes
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onDiscard}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 500,
            background: 'transparent', border: '1px solid #d1d5db',
            borderRadius: 4, cursor: 'pointer', color: '#6b7280',
          }}
        >
          Discard
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 500,
            background: 'var(--color-primary)', border: 'none',
            borderRadius: 4, cursor: 'pointer', color: '#fff',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
