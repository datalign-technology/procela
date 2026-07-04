import { useAuthStore } from '@/stores/authStore';
import { useOrgContext } from '@/stores/orgContext';

/**
 * signOutLocal — clear every persisted client-side store the session
 * left behind. Auth store (tokens, user) *and* the org-context store
 * (`activeOrgId`, `activeOrgName`) both live in localStorage under
 * separate zustand keys, so a plain `authStore.logout()` leaves the
 * previously-active org name lingering in the header on the next
 * sign-in. Reset-all-data was the most visible symptom (header shows
 * an org that no longer exists), but the same bug catches any
 * account switch on a shared browser.
 *
 * Backend logout / OIDC-provider logout is the caller's job — this
 * only touches client state. Kept as a lib helper (not on the store)
 * so orgContext ↔ authStore stays acyclic.
 */
export function signOutLocal(): void {
  useOrgContext.getState().clearActiveOrg();
  useAuthStore.getState().logout();
}
