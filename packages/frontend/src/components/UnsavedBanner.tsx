import Button from './Button';

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
        <Button variant="secondary" size="sm" onClick={onDiscard}>Discard</Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={saving}>Save Changes</Button>
      </div>
    </div>
  );
}
