import { create } from 'zustand';

// ──────────────────────────────────────────────────────────────────────────
// Toast — in-app notifications. Three types (success/error/info) and an
// optional single-action button (used for "Undo" after bulk deletes).
//
// Tokens:
//   - `duration` lets specific toasts live longer than the 3s default.
//     Undo toasts want ~10s; errors with long context text want longer.
//   - `action` is a {label, handler} — handler is fired on click and the
//     toast is dismissed. The handler is not awaited, so it must be fire-
//     and-forget or manage its own async errors.
// ──────────────────────────────────────────────────────────────────────────

export interface ToastAction {
  label: string;
  handler: () => void;
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  action?: ToastAction;
}

interface AddToastOptions {
  action?: ToastAction;
  duration?: number;  // ms; default 3000
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string, options?: AddToastOptions) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (type, message, options) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const duration = options?.duration ?? (options?.action ? 10000 : 3000);
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, action: options?.action }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
    return id;
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
