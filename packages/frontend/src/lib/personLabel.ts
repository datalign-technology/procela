// Format a person for display in pickers and badges. The backend
// enriches /people GET with `orgNames` so we can append the assignment
// context inline — useful when two people share a name or a steward is
// being picked from across the org tree.
//
// "Alice Smith — Engineering"
// "Alice Smith — Engineering, Marketing" (multi-org assignment)
// "Alice Smith"                            (no org assignment recorded)

interface PersonLike {
  name: string;
  orgNames?: string[];
  orgIds?: string[];
}

export function formatPersonLabel(person: PersonLike, opts: { maxOrgs?: number } = {}): string {
  const maxOrgs = opts.maxOrgs ?? 2;
  const orgs = (person.orgNames || []).filter(Boolean);
  if (orgs.length === 0) return person.name;
  const shown = orgs.slice(0, maxOrgs).join(', ');
  const overflow = orgs.length > maxOrgs ? ` +${orgs.length - maxOrgs}` : '';
  return `${person.name} — ${shown}${overflow}`;
}
