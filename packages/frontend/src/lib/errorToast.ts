import { useToastStore } from '@/stores/toastStore';

// ──────────────────────────────────────────────────────────────────────────
// errorToast — central place to surface caught errors to the user. Pulls
// a readable message off the error if available, falls back to the caller-
// provided default. Use anywhere a `try { ... } catch (e) { ... }` block
// would otherwise silently swallow the error.
//
//   try { await apiClient.post(...); }
//   catch (err) { errorToast(err, 'Could not save asset'); }
// ──────────────────────────────────────────────────────────────────────────

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: string; error?: string };
    if (anyErr.message) return anyErr.message;
    if (anyErr.error) return anyErr.error;
  }
  return fallback;
}

export function errorToast(err: unknown, fallback: string = 'Something went wrong') {
  // Pulled via the store's getState() rather than the hook because callers
  // are typically inside non-component code paths (catch blocks, async
  // workflows). React rules-of-hooks doesn't apply to getState().
  useToastStore.getState().addToast('error', errorMessage(err, fallback));
}

export function successToast(message: string) {
  useToastStore.getState().addToast('success', message);
}

export function infoToast(message: string) {
  useToastStore.getState().addToast('info', message);
}
