import { useTerminologyStore, TerminologyMode } from '../stores/terminologyStore';

// ──────────────────────────────────────────────────────────────────────────
// Terminology label map.
//
// Each entry has both the DAMA-jargon form and the plain-English form.
// The `useTerm` hook returns whichever matches the current mode; the
// `term` helper returns either form without subscribing to the store
// (useful inside `useMemo` builders that already depend on `mode`).
//
// Scope is intentionally small — we add entries only when the jargon
// is confusing for first-time users. Most Procela nouns are already
// plain (Processes, Systems, Connections, etc.) and don't need an
// entry here.
// ──────────────────────────────────────────────────────────────────────────

export const TERMS = {
  custodian: { dama: 'Custodian', plain: 'Operator' },
  custodians: { dama: 'Custodians', plain: 'Operators' },
  technicalCustodians: { dama: 'Technical Custodians', plain: 'Technical Operators' },
  governanceTier: { dama: 'Governance Tier', plain: 'Trust Level' },
  governanceTierShort: { dama: 'Tier', plain: 'Trust' },
} as const;

export type TermKey = keyof typeof TERMS;

export function term(key: TermKey, mode: TerminologyMode): string {
  return TERMS[key][mode];
}

export function useTerm(key: TermKey): string {
  const mode = useTerminologyStore((s) => s.mode);
  return TERMS[key][mode];
}

export function useTerminologyMode(): TerminologyMode {
  return useTerminologyStore((s) => s.mode);
}
