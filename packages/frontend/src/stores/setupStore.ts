import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './authStore';

// ──────────────────────────────────────────────────────────────────────────
// setupStore — shared state for the "Get Started" Setup Hub.
//
// Three things live here:
//   • progressByOrg — the last computed 0–100 completion percentage. The
//     Hub computes it from live data and writes it here; the sidebar reads
//     it to render the nav ring and, in the default 'auto' visibility mode,
//     to hide the entry once an org is fully set up (100%). Persisted so the
//     sidebar can decide visibility before the Hub has been opened this
//     session. Keyed by org.
//   • affirmedByOrg — task keys the user has explicitly marked "done" for
//     the subjective capture steps (org/people/processes/systems/data are
//     never truly "finished", so we let the user affirm completion rather
//     than nagging forever). Objective steps (ownership gaps, coverage)
//     derive done-ness from data and ignore this. Keyed by org.
//   • visibility — the user's explicit control over whether the
//     "Get Started" entry shows in the sidebar (set from the Hub's Hide
//     button and the Settings segmented control). 'auto' (default) keeps
//     the old behaviour: show while incomplete, hide at 100%. 'shown' pins
//     it regardless of progress; 'hidden' removes it regardless.
//
//     This is a **per-user** preference — it is scoped to the signed-in
//     user in browser storage (key `procela:get-started-visibility:<userId>`),
//     the same way the dashboard layout/density prefs are scoped, so two
//     people sharing a browser don't clobber each other's choice. It is NOT
//     keyed by org: the show/hide choice applies across every org. Because it
//     depends on who is signed in, it lives OUTSIDE the persisted zustand blob
//     below (which is browser-global) and is hydrated per-user instead.
// ──────────────────────────────────────────────────────────────────────────

export type GetStartedVisibility = 'auto' | 'shown' | 'hidden';

/** Pure visibility predicate — whether the "Get Started" nav entry should
 *  render, given the user's chosen mode and the org's setup progress.
 *  Exported so the rule is unit-testable without mounting the sidebar. */
export function shouldShowGetStarted(
  visibility: GetStartedVisibility,
  progress: number | undefined,
): boolean {
  if (visibility === 'hidden') return false;
  if (visibility === 'shown') return true;
  // 'auto' — show until the org is fully set up, then step out of the way.
  return progress === undefined || progress < 100;
}

// ── Per-user visibility persistence ───────────────────────────────────────
// Scoped to the signed-in user's id so a shared browser keeps each person's
// choice separate. Falls back to 'anon' before anyone signs in.
const LEGACY_STORE_KEY = 'procela:setup';
const visKey = (userId: string | null | undefined) =>
  `procela:get-started-visibility:${userId || 'anon'}`;
const isVisibility = (v: unknown): v is GetStartedVisibility =>
  v === 'auto' || v === 'shown' || v === 'hidden';

function writeVisibility(userId: string | null | undefined, v: GetStartedVisibility): void {
  try { localStorage.setItem(visKey(userId), v); } catch { /* storage unavailable — best-effort */ }
}

function readVisibility(userId: string | null | undefined): GetStartedVisibility {
  try {
    const raw = localStorage.getItem(visKey(userId));
    if (isVisibility(raw)) return raw;
    // One-time migration: before this was per-user, the choice was stored
    // inside the browser-global `procela:setup` blob. Inherit any explicit
    // (non-'auto') choice so an existing user doesn't silently lose it, and
    // write it through to the per-user key so it survives the persist migrate
    // below stripping it from the old blob.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    const lv = legacy?.state?.visibility;
    if (lv === 'shown' || lv === 'hidden') {
      writeVisibility(userId, lv);
      return lv;
    }
  } catch { /* storage/parse unavailable — fall through to the default */ }
  return 'auto';
}

interface SetupState {
  progressByOrg: Record<string, number>;
  affirmedByOrg: Record<string, string[]>;
  /** Per-user show/hide preference — hydrated from the per-user key, not from
   *  the persisted (browser-global) blob. */
  visibility: GetStartedVisibility;
  setProgress: (orgId: string, percent: number) => void;
  toggleAffirm: (orgId: string, taskKey: string) => void;
  isAffirmed: (orgId: string, taskKey: string) => boolean;
  setVisibility: (visibility: GetStartedVisibility) => void;
  getVisibility: () => GetStartedVisibility;
  /** Re-read the visibility for a (possibly different) signed-in user. Called
   *  when the auth user changes — login, logout, account switch. */
  syncVisibilityToUser: (userId: string | null | undefined) => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set, get) => ({
      progressByOrg: {},
      affirmedByOrg: {},
      visibility: readVisibility(useAuthStore.getState().user?.id),
      setProgress: (orgId, percent) =>
        set((s) => {
          if (!orgId) return s;
          if (s.progressByOrg[orgId] === percent) return s;
          return { progressByOrg: { ...s.progressByOrg, [orgId]: percent } };
        }),
      toggleAffirm: (orgId, taskKey) =>
        set((s) => {
          const cur = new Set(s.affirmedByOrg[orgId] || []);
          if (cur.has(taskKey)) cur.delete(taskKey);
          else cur.add(taskKey);
          return { affirmedByOrg: { ...s.affirmedByOrg, [orgId]: Array.from(cur) } };
        }),
      isAffirmed: (orgId, taskKey) => (get().affirmedByOrg[orgId] || []).includes(taskKey),
      setVisibility: (visibility) =>
        set((s) => {
          if (s.visibility === visibility) return s;
          writeVisibility(useAuthStore.getState().user?.id, visibility);
          return { visibility };
        }),
      getVisibility: () => get().visibility,
      syncVisibilityToUser: (userId) => set({ visibility: readVisibility(userId) }),
    }),
    {
      name: LEGACY_STORE_KEY,
      version: 2,
      // Only the per-org data is browser-global; visibility is per-user and
      // lives in its own key, so keep it out of this persisted blob.
      partialize: (s) => ({ progressByOrg: s.progressByOrg, affirmedByOrg: s.affirmedByOrg }),
      // Drop legacy visibility fields from older blobs (v0 stored it per-org as
      // visibilityByOrg; v1 stored a single global `visibility`). readVisibility
      // above already migrated any explicit choice into the per-user key.
      migrate: (persisted: any, _version) => {
        if (persisted) {
          delete persisted.visibility;
          delete persisted.visibilityByOrg;
        }
        return persisted;
      },
    },
  ),
);

// Re-hydrate the per-user visibility whenever the signed-in user changes
// (login, logout, or an account switch on a shared browser), so the segmented
// control and the sidebar entry reflect the current user's own choice.
let _lastUserId: string | null | undefined = useAuthStore.getState().user?.id;
useAuthStore.subscribe((state) => {
  const uid = state.user?.id;
  if (uid !== _lastUserId) {
    _lastUserId = uid;
    useSetupStore.getState().syncVisibilityToUser(uid);
  }
});
