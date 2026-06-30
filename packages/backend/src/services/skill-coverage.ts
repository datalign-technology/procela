import { skills } from '../stores/skills';
import { people } from '../routes/people';
import { processNodes } from '../routes/process-catalog';

// ──────────────────────────────────────────────────────────────────────────
// skill-coverage — shared helpers for the four "value loop" surfaces
// that closed on the otherwise-orphaned Skills data:
//
//   1. "Qualified person" check on process activities
//      → personCoverageForNode + listUnqualifiedAssignments
//   2. "Find people by skill" lookup
//      → frontend filters Person.skillIds directly, no helper needed
//   3. "Recommend role assignees"
//      → rankPeopleByRoleSkills
//   4. Skill-gap report
//      → orgSkillGapReport
//
// Every helper is org-scoped — the caller passes orgId so the math is
// computed against just that org's people + process nodes. Skills
// themselves are org-scoped too; a person's skillIds may include
// entries that don't exist in this org's catalog (e.g. they were
// added from another org) — those are still counted as "held" so a
// transferable competency isn't quietly lost.
// ──────────────────────────────────────────────────────────────────────────

export interface PersonCoverage {
  /** Which required skills are present on the person. */
  matched: string[];
  /** Which required skills are missing. The chip / warning rendering
   *  reads from this — if length is zero the person is qualified. */
  missing: string[];
  /** matched.length / required.length. 1.0 = qualified, 0 = no overlap.
   *  Always a finite number; required = 0 yields 1.0 (vacuously qualified). */
  ratio: number;
}

/** Compute one person's coverage of a specific required-skill list. */
export function personCoverage(personSkillIds: string[], requiredSkillIds: string[]): PersonCoverage {
  const have = new Set(personSkillIds);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const id of requiredSkillIds) {
    if (have.has(id)) matched.push(id);
    else missing.push(id);
  }
  const ratio = requiredSkillIds.length === 0 ? 1 : matched.length / requiredSkillIds.length;
  return { matched, missing, ratio };
}

export interface UnqualifiedAssignment {
  nodeId: string;
  nodeName: string;
  level: string;
  /** The skill names (not ids) the responsible person is missing. */
  missingSkillNames: string[];
}

/** Walk every process node in the org. Return one entry per (person,
 *  node) pair where the responsible person is missing one or more
 *  required skills. Used to populate:
 *    - The skill-coverage column on the People table (group by personId)
 *    - The warning chip on the node panel (lookup by nodeId)
 */
export function listUnqualifiedAssignments(orgId: string): Map<string, UnqualifiedAssignment[]> {
  const out = new Map<string, UnqualifiedAssignment[]>();
  for (const node of processNodes) {
    if (node.orgId !== orgId) continue;
    if (!node.responsiblePersonId) continue;
    if (!node.requiredSkillIds || node.requiredSkillIds.length === 0) continue;
    const person = people.find((p) => p.id === node.responsiblePersonId);
    if (!person) continue;
    const cov = personCoverage(person.skillIds || [], node.requiredSkillIds);
    if (cov.missing.length === 0) continue;
    const missingSkillNames = cov.missing
      .map((id) => skills.find((s) => s.id === id)?.name || id)
      .filter(Boolean);
    const entry: UnqualifiedAssignment = {
      nodeId: node.id, nodeName: node.name, level: node.level || '',
      missingSkillNames,
    };
    const list = out.get(person.id);
    if (list) list.push(entry);
    else out.set(person.id, [entry]);
  }
  return out;
}

/** Per-person summary for the People table column. The frontend
 *  consumes this as `{ personId: { unqualifiedCount, sample } }`,
 *  rendering the sample as a tooltip on hover so the operator gets
 *  a glanceable "5 activities — Customer onboarding, Bills payable, …"
 *  without an extra round trip. */
export function unqualifiedSummaryByPerson(orgId: string): Map<string, { unqualifiedCount: number; sample: string[] }> {
  const map = listUnqualifiedAssignments(orgId);
  const out = new Map<string, { unqualifiedCount: number; sample: string[] }>();
  for (const [pid, list] of map) {
    out.set(pid, {
      unqualifiedCount: list.length,
      sample: list.slice(0, 3).map((a) => a.nodeName),
    });
  }
  return out;
}

export interface RoleRecommendation {
  personId: string;
  personName: string;
  ratio: number;
  matched: number;
  required: number;
}

/** Rank people by skill-name overlap with a static `requiredSkills`
 *  list (the role definitions in lib/roleDefinitions.ts carry
 *  names, not ids, so the match is name-keyed). Skips people whose
 *  ratio is 0 — they'd just be noise in the recommendation panel.
 *  Returns up to `limit` people, ties broken by name for stable
 *  rendering. */
export function rankPeopleByRoleSkills(
  orgId: string,
  requiredSkillNames: string[],
  limit: number = 5,
): RoleRecommendation[] {
  if (requiredSkillNames.length === 0) return [];
  const requiredLower = new Set(requiredSkillNames.map((n) => n.toLowerCase()));
  const out: RoleRecommendation[] = [];
  const orgPeople = people.filter((p) => p.orgIds?.includes(orgId));
  for (const p of orgPeople) {
    const personSkillNames = (p.skillIds || [])
      .map((id) => skills.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n);
    const matched = personSkillNames.filter((n) => requiredLower.has(n.toLowerCase()));
    if (matched.length === 0) continue;
    out.push({
      personId: p.id, personName: p.name,
      ratio: matched.length / requiredSkillNames.length,
      matched: matched.length,
      required: requiredSkillNames.length,
    });
  }
  out.sort((a, b) => b.ratio - a.ratio || a.personName.localeCompare(b.personName));
  return out.slice(0, limit);
}

export interface SkillGap {
  skillId: string;
  skillName: string;
  category: string;
  /** Number of process activities that require this skill. */
  requiredByActivities: number;
  /** Number of people in the org who hold this skill. */
  heldByPeople: number;
  /** requiredByActivities / max(heldByPeople, 1) — higher = worse
   *  understaffed ratio. Used to sort the report so the most-painful
   *  gaps surface first. */
  gapScore: number;
}

/** Org-wide skill-gap report. For each skill in the catalog,
 *  computes how many activities require it vs. how many people hold
 *  it; sorts descending by gap-score so the dashboard widget shows
 *  the most-painful gaps first. Skills with zero required-by count
 *  AND zero held-by count are dropped — they're noise in the
 *  catalog from neither side. */
export function orgSkillGapReport(orgId: string): SkillGap[] {
  const orgSkills = skills.filter((s) => s.orgId === orgId);
  const orgPeople = people.filter((p) => p.orgIds?.includes(orgId));
  const orgNodes = processNodes.filter((n) => n.orgId === orgId);

  // Counters keyed by skill id.
  const requiredCount = new Map<string, number>();
  const heldCount = new Map<string, number>();

  for (const node of orgNodes) {
    if (!node.requiredSkillIds || node.requiredSkillIds.length === 0) continue;
    for (const sid of node.requiredSkillIds) {
      requiredCount.set(sid, (requiredCount.get(sid) || 0) + 1);
    }
  }
  for (const p of orgPeople) {
    if (!p.skillIds || p.skillIds.length === 0) continue;
    for (const sid of p.skillIds) {
      heldCount.set(sid, (heldCount.get(sid) || 0) + 1);
    }
  }

  const rows: SkillGap[] = [];
  for (const sk of orgSkills) {
    const required = requiredCount.get(sk.id) || 0;
    const held = heldCount.get(sk.id) || 0;
    if (required === 0 && held === 0) continue;
    rows.push({
      skillId: sk.id,
      skillName: sk.name,
      category: sk.category,
      requiredByActivities: required,
      heldByPeople: held,
      // Avoid division by zero; held=0 yields gapScore == required.
      gapScore: required / Math.max(held, 1),
    });
  }
  rows.sort((a, b) =>
    b.gapScore - a.gapScore
    || b.requiredByActivities - a.requiredByActivities
    || a.skillName.localeCompare(b.skillName),
  );
  return rows;
}
