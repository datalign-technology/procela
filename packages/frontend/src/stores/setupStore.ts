import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ──────────────────────────────────────────────────────────────────────────
// setupStore — shared state for the "Get Started" Setup Hub.
//
// Three things live here, all keyed by org so a user managing several orgs
// gets independent setup state for each:
//   • progressByOrg — the last computed 0–100 completion percentage. The
//     Hub computes it from live data and writes it here; the sidebar reads
//     it to render the nav ring and, in the default 'auto' visibility mode,
//     to hide the entry once an org is fully set up (100%). Persisted so the
//     sidebar can decide visibility before the Hub has been opened this
//     session.
//   • affirmedByOrg — task keys the user has explicitly marked "done" for
//     the subjective capture steps (org/people/processes/systems/data are
//     never truly "finished", so we let the user affirm completion rather
//     than nagging forever). Objective steps (ownership gaps, coverage)
//     derive done-ness from data and ignore this.
//   • visibilityByOrg — the user's explicit control over whether the
//     "Get Started" entry shows in the sidebar (set from the Hub's Hide
//     button and the Settings segmented control). 'auto' (default) keeps
//     the old behaviour: show while incomplete, hide at 100%. 'shown' pins
//     it regardless of progress; 'hidden' removes it regardless. Persisted
//     alongside progress. Client-side (per browser), like the rest of this
//     store.
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

interface SetupState {
  progressByOrg: Record<string, number>;
  affirmedByOrg: Record<string, string[]>;
  visibilityByOrg: Record<string, GetStartedVisibility>;
  setProgress: (orgId: string, percent: number) => void;
  toggleAffirm: (orgId: string, taskKey: string) => void;
  isAffirmed: (orgId: string, taskKey: string) => boolean;
  setVisibility: (orgId: string, visibility: GetStartedVisibility) => void;
  getVisibility: (orgId: string | null | undefined) => GetStartedVisibility;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set, get) => ({
      progressByOrg: {},
      affirmedByOrg: {},
      visibilityByOrg: {},
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
      setVisibility: (orgId, visibility) =>
        set((s) => {
          if (!orgId) return s;
          if (s.visibilityByOrg[orgId] === visibility) return s;
          return { visibilityByOrg: { ...s.visibilityByOrg, [orgId]: visibility } };
        }),
      getVisibility: (orgId) => (orgId ? get().visibilityByOrg[orgId] || 'auto' : 'auto'),
    }),
    { name: 'procela:setup' },
  ),
);
