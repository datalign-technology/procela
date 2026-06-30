// People suggestion service — Phase 3 expansion sibling to
// asset-suggestion.service. Ranks Persons as candidates for a process
// node's involvement (responsible person, contributor, owner).
//
// Signals:
//  - Title / jobRole token overlap with the step's name and
//    description.
//  - Skill match: people whose skillIds intersect the step's
//    requiredSkillIds.
//  - System affinity: people who own / steward / are custodians of any
//    system the step already declares it runs on.
//  - Excludes the node's existing ownerId / responsiblePersonId so we
//    don't suggest someone who's already on the card.

import { tokenise } from './asset-suggestion.service';

export interface PeopleSuggestionNode {
  id: string;
  name: string;
  description: string;
  systemIds?: string[];
  requiredSkillIds?: string[];
  ownerId?: string | null;
  responsiblePersonId?: string | null;
}

export interface PeopleSuggestionPerson {
  id: string;
  name: string;
  title?: string;
  jobRole?: string;
  skillIds?: string[];
}

export interface PeopleSuggestionSystem {
  id: string;
  ownerPersonId?: string | null;
  deputyOwnerId?: string | null;
  custodianIds?: string[];
}

export interface PeopleSuggestion {
  personId: string;
  personName: string;
  title?: string;
  jobRole?: string;
  score: number;
  rationale: string[];
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

const WEIGHT_TITLE = 0.45;
const WEIGHT_SKILL = 0.45;
const WEIGHT_SYSTEM = 0.4;

export interface PeopleRankOptions {
  limit?: number;
  minScore?: number;
}

/** Rank candidate Persons for a process node. Caller supplies people +
 *  systems narrowed to the node's org, plus any dismissed person ids. */
export function rankPeopleSuggestions(
  node: PeopleSuggestionNode,
  persons: readonly PeopleSuggestionPerson[],
  systems: readonly PeopleSuggestionSystem[],
  dismissed: ReadonlySet<string>,
  opts: PeopleRankOptions = {},
): PeopleSuggestion[] {
  if (!node || persons.length === 0) return [];

  const alreadyOn = new Set<string>();
  if (node.ownerId) alreadyOn.add(node.ownerId);
  if (node.responsiblePersonId) alreadyOn.add(node.responsiblePersonId);

  const nameTokens = tokenise(node.name);
  const descTokens = tokenise(node.description);
  const stepTextTokens = new Set<string>([...nameTokens, ...descTokens]);
  const requiredSkills = new Set(node.requiredSkillIds || []);
  const declaredSystems = new Set(node.systemIds || []);

  // Index systems by relevant person to detect "owns the system on
  // this step" affinity in a single pass.
  const systemPersonIds = new Map<string, Set<string>>(); // personId → set of system ids on this step
  if (declaredSystems.size > 0) {
    for (const sys of systems) {
      if (!declaredSystems.has(sys.id)) continue;
      const link = (pid: string) => {
        if (!systemPersonIds.has(pid)) systemPersonIds.set(pid, new Set());
        systemPersonIds.get(pid)!.add(sys.id);
      };
      if (sys.ownerPersonId) link(sys.ownerPersonId);
      if (sys.deputyOwnerId) link(sys.deputyOwnerId);
      for (const cid of sys.custodianIds || []) link(cid);
    }
  }

  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.1;

  const scored: PeopleSuggestion[] = [];
  for (const p of persons) {
    if (alreadyOn.has(p.id) || dismissed.has(p.id)) continue;

    const rationale: string[] = [];
    const titleTokens = tokenise([p.title || '', p.jobRole || ''].join(' '));
    const titleScore = overlap(stepTextTokens, titleTokens);
    if (titleScore > 0) {
      const shared = [...titleTokens].filter((t) => stepTextTokens.has(t)).slice(0, 3);
      rationale.push(`Title/role overlap on "${shared.join(', ')}"`);
    }

    let skillScore = 0;
    if (requiredSkills.size > 0 && p.skillIds && p.skillIds.length > 0) {
      let hits = 0;
      for (const sid of p.skillIds) if (requiredSkills.has(sid)) hits++;
      if (hits > 0) {
        skillScore = hits / requiredSkills.size;
        rationale.push(`Has ${hits} of ${requiredSkills.size} required skill${requiredSkills.size === 1 ? '' : 's'}`);
      }
    }

    const personSystems = systemPersonIds.get(p.id);
    const systemScore = personSystems && personSystems.size > 0
      ? Math.min(1, personSystems.size / Math.max(1, declaredSystems.size))
      : 0;
    if (systemScore > 0) {
      rationale.push(`Owns/runs ${personSystems!.size} system${personSystems!.size === 1 ? '' : 's'} this step declares`);
    }

    const total = Math.min(
      1,
      titleScore * WEIGHT_TITLE + skillScore * WEIGHT_SKILL + systemScore * WEIGHT_SYSTEM,
    );
    if (total >= minScore) {
      scored.push({
        personId: p.id,
        personName: p.name,
        title: p.title,
        jobRole: p.jobRole,
        score: Math.round(total * 1000) / 1000,
        rationale,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
