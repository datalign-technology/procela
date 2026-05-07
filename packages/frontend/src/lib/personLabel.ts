// Format a person for display in pickers and badges. The backend
// enriches /people GET with `orgPaths` (full hierarchy: "Root /
// Department / Team") and `orgNames` (just the leaf), plus the
// person's `title`. Pickers should render enough context that the
// user can disambiguate two people who share a name.
//
// Examples:
//   "Alice Smith — Senior Engineer · Acme / Engineering / Backend"
//   "Alice Smith · Acme / Engineering"          (no title set)
//   "Alice Smith — Senior Engineer"             (no org assignment)
//   "Alice Smith"                               (neither)
//   "Alice Smith — Senior Engineer · Acme / Eng / Backend +1"
//                                              (assigned to multiple orgs)

interface PersonLike {
  name: string;
  title?: string;
  jobRole?: string;
  orgPaths?: string[];
  orgNames?: string[];
  orgIds?: string[];
}

export function formatPersonLabel(person: PersonLike, opts: { maxOrgs?: number } = {}): string {
  const maxOrgs = opts.maxOrgs ?? 1;
  // Prefer the full hierarchy path when the backend provided it; fall
  // back to the leaf org name for older payloads still in cache.
  const orgs = (person.orgPaths && person.orgPaths.length > 0
    ? person.orgPaths
    : person.orgNames || []
  ).filter(Boolean);

  // Title is the formal job title; jobRole is a secondary descriptor
  // used by some imports. Show whichever is present, preferring title.
  const title = person.title?.trim() || person.jobRole?.trim() || '';

  const parts: string[] = [person.name];
  if (title) parts.push(title);
  let label = parts.join(' — ');

  if (orgs.length > 0) {
    const shown = orgs.slice(0, maxOrgs).join(', ');
    const overflow = orgs.length > maxOrgs ? ` +${orgs.length - maxOrgs}` : '';
    label += ` · ${shown}${overflow}`;
  }
  return label;
}
