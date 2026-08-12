import { useToastStore } from '@/stores/toastStore';

const borderColors: Record<string, string> = {
  success: 'var(--color-success)',
  error: 'var(--color-error)',
  info: '#2563eb',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        bottom: 80,
        right: 24,
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 380,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
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
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.handler();
                removeToast(toast.id);
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-primary)',
                color: 'var(--color-primary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--color-text-muted)',
              padding: '0 0 0 4px',
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
