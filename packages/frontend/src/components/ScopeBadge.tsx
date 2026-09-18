import StatusBadge from './StatusBadge';

// ──────────────────────────────────────────────────────────────────────────
// ScopeBadge — the per-row marker that separates entities the governance
// program *governs* (in scope) from ones that are merely catalogued /
// connected (not governed). Composes StatusBadge so the pill styling stays
// consistent with every other state marker. Only rendered when a scope is
// actually defined (useScopeMembership().applied) — with no scope, everything
// is governed by default and a badge would be noise.
//
//   {membership.applied && <ScopeBadge inScope={membership.has('asset', a.id)} />}
// ──────────────────────────────────────────────────────────────────────────
export default function ScopeBadge({ inScope }: { inScope: boolean }) {
  return inScope ? (
    <StatusBadge variant="success" title="In your governance program's scope">In scope</StatusBadge>
  ) : (
    <StatusBadge variant="neutral" dashed title="Catalogued but outside your governance program's scope — connected, not governed">Not governed</StatusBadge>
  );
}
