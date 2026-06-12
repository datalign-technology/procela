import { people } from '../routes/people';
import { skills } from '../routes/skills';
import { processNodes } from '../routes/process-catalog';

/**
 * Skill coverage / gap math. Pure helpers, shared between the four
 * value-loop surfaces (qualified-person check, find-people-by-skill,
 * role recommendations, dashboard gap report). Centralising the math
 * keeps the four surfaces in sync.
 */

export interface PersonCoverage {
  matched: string[];
  missing: string[];
  ratio: number;
}

/** How many of `requiredSkillIds` does this person hold? */
export function personCoverage(personSkillIds: string[], requiredSkillIds: string[]): PersonCoverage {
  if (requiredSkillIds.length === 0) {
    return { matched: [], missing: [], ratio: 1 };
  }
  const held = new Set(personSkillIds);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const sid of requiredSkillIds) {
    if (held.has(sid)) matched.push(sid);
    else missing.push(sid);
  }
  return { matched, missing, ratio: matched.length / requiredSkillIds.length };
}

export interface UnqualifiedAssignment {
  nodeId: string;
  nodeName: string;
  missingSkillIds: string[];
  missingSkillNames: string[];
}

/**
 * For each person, the list of process nodes where they're the
 * responsible owner but lack one or more required skills.
 * Scoped to a single org.
 */
export function listUnqualifiedAssignments(orgId: string): Map<string, UnqualifiedAssignment[]> {
  const result = new Map<string, UnqualifiedAssignment[]>();
  const orgPeople = people.filter((p) => p.orgIds.includes(orgId));
  const peopleById = new Map(orgPeople.map((p) => [p.id, p]));
  const skillNameById = new Map(skills.filter((s) => s.orgId === orgId).map((s) => [s.id, s.name]));

  for (const node of processNodes) {
    if (node.orgId !== orgId) continue;
    if (!node.responsiblePersonId) continue;
    const required = node.requiredSkillIds || [];
    if (required.length === 0) continue;
    const person = peopleById.get(node.responsiblePersonId);
    if (!person) continue;
    const cov = personCoverage(person.skillIds || [], required);
    if (cov.missing.length === 0) continue;
    const entry: UnqualifiedAssignment = {
      nodeId: node.id,
      nodeName: node.name,
      missingSkillIds: cov.missing,
      missingSkillNames: cov.missing.map((sid) => skillNameById.get(sid) || sid),
    };
    const list = result.get(person.id) || [];
    list.push(entry);
    result.set(person.id, list);
  }
  return result;
}

/** Per-person summary: count + up to 3 sample activity names. */
export function unqualifiedSummaryByPerson(orgId: string): Map<string, { unqualifiedCount: number; sample: string[] }> {
  const detailed = listUnqualifiedAssignments(orgId);
  const out = new Map<string, { unqualifiedCount: number; sample: string[] }>();
  for (const [personId, list] of detailed.entries()) {
    out.set(personId, {
      unqualifiedCount: list.length,
      sample: list.slice(0, 3).map((a) => a.nodeName),
    });
  }
  return out;
}

export interface RoleRecommendation {
  personId: string;
  personName: string;
  matched: number;
  required: number;
  ratio: number;
}

/**
 * Rank people by overlap between their held skills and a list of
 * required skill *names* (not ids). Role definitions carry skill
 * names because they're catalog-agnostic; matching is
 * case-insensitive. People with zero overlap are dropped.
 */
export function rankPeopleByRoleSkills(
  orgId: string,
  requiredSkillNames: string[],
  limit: number = 5,
): RoleRecommendation[] {
  if (requiredSkillNames.length === 0) return [];
  const requiredLc = new Set(requiredSkillNames.map((n) => n.toLowerCase()));
  const required = requiredSkillNames.length;

  // Map skill id → lowercased name for this org's catalog.
  const skillNameLcById = new Map<string, string>();
  for (const s of skills) {
    if (s.orgId === orgId) skillNameLcById.set(s.id, s.name.toLowerCase());
  }

  const out: RoleRecommendation[] = [];
  for (const p of people) {
    if (!p.orgIds.includes(orgId)) continue;
    let matched = 0;
    for (const sid of p.skillIds || []) {
      const lc = skillNameLcById.get(sid);
      if (lc && requiredLc.has(lc)) matched++;
    }
    if (matched === 0) continue;
    out.push({
      personId: p.id,
      personName: p.name,
      matched,
      required,
      ratio: matched / required,
    });
  }
  out.sort((a, b) => b.ratio - a.ratio || a.personName.localeCompare(b.personName));
  return out.slice(0, limit);
}

export interface SkillGap {
  skillId: string;
  skillName: string;
  category: string;
  requiredByActivities: number;
  heldByPeople: number;
  /** Higher = bigger gap. requiredByActivities / max(heldByPeople, 1) */
  gapScore: number;
}

/**
 * Org-wide skill gap report: each skill that is either required by an
 * activity or held by a person, with counts on both sides and a gap
 * score. Sorted highest-gap-first.
 */
export function orgSkillGapReport(orgId: string): SkillGap[] {
  const orgSkills = skills.filter((s) => s.orgId === orgId);
  const requiredCount = new Map<string, number>();
  const heldCount = new Map<string, number>();

  for (const node of processNodes) {
    if (node.orgId !== orgId) continue;
    for (const sid of node.requiredSkillIds || []) {
      requiredCount.set(sid, (requiredCount.get(sid) || 0) + 1);
    }
  }
  for (const p of people) {
    if (!p.orgIds.includes(orgId)) continue;
    for (const sid of p.skillIds || []) {
      heldCount.set(sid, (heldCount.get(sid) || 0) + 1);
    }
  }

  const out: SkillGap[] = [];
  for (const s of orgSkills) {
    const req = requiredCount.get(s.id) || 0;
    const held = heldCount.get(s.id) || 0;
    if (req === 0 && held === 0) continue;
    out.push({
      skillId: s.id,
      skillName: s.name,
      category: s.category,
      requiredByActivities: req,
      heldByPeople: held,
      gapScore: req / Math.max(held, 1),
    });
  }
  out.sort((a, b) => b.gapScore - a.gapScore || a.skillName.localeCompare(b.skillName));
  return out;
}
