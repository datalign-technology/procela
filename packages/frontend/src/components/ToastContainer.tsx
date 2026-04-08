import { useToastStore } from '@/stores/toastStore';

const borderColors: Record<string, string> = {
  success: '#16a34a',
  error: '#dc2626',
  info: '#2563eb',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 24,
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            backgroundColor: '#ffffff',
            borderLeft: `4px solid ${borderColors[toast.type] || borderColors.info}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 13,
            color: 'var(--color-text)',
            animation: 'toastSlideIn 0.25s ease-out',
          }}
        >
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--color-text-muted)',
              padding: '0 0 0 8px',
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
      <style>{`
        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
