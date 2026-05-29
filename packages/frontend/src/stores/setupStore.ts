import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ──────────────────────────────────────────────────────────────────────────
// setupStore — shared state for the "Get Started" Setup Hub.
//
// Two things live here, both keyed by org so a user managing several orgs
// gets independent setup state for each:
//   • progressByOrg — the last computed 0–100 completion percentage. The
//     Hub computes it from live data and writes it here; the sidebar reads
//     it to render the nav ring and to auto-hide the entry once an org is
//     fully set up (100%). Persisted so the sidebar can decide visibility
//     before the Hub has been opened this session.
//   • affirmedByOrg — task keys the user has explicitly marked "done" for
//     the subjective capture steps (org/people/processes/systems/data are
//     never truly "finished", so we let the user affirm completion rather
//     than nagging forever). Objective steps (ownership gaps, coverage)
//     derive done-ness from data and ignore this.
// ──────────────────────────────────────────────────────────────────────────

interface SetupState {
  progressByOrg: Record<string, number>;
  affirmedByOrg: Record<string, string[]>;
  setProgress: (orgId: string, percent: number) => void;
  toggleAffirm: (orgId: string, taskKey: string) => void;
  isAffirmed: (orgId: string, taskKey: string) => boolean;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set, get) => ({
      progressByOrg: {},
      affirmedByOrg: {},
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
    }),
    { name: 'procela:setup' },
  ),
);
