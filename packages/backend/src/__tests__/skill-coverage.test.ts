import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { people } from '../routes/people';
import { skills } from '../routes/skills';
import { processNodes } from '../routes/process-catalog';
import {
  personCoverage,
  listUnqualifiedAssignments,
  unqualifiedSummaryByPerson,
  rankPeopleByRoleSkills,
  orgSkillGapReport,
} from '../services/skill-coverage';
import { snapshotStore, restoreStore, replaceArray } from './_helpers/store-isolation';

const ORG = 'test-org-skills';
const OTHER_ORG = 'test-org-other';

// Helpers to keep fixtures readable. Each test re-builds people /
// skills / processNodes from scratch so cases don't leak into each
// other.
function person(id: string, name: string, skillIds: string[], orgIds: string[] = [ORG]) {
  const now = new Date().toISOString();
  return {
    id, orgIds, accessibleOrgIds: orgIds, name, email: `${id}@x.io`,
    role: 'VIEWER', title: '', skillIds, createdAt: now, updatedAt: now,
  };
}
function skill(id: string, name: string, category: string = 'GOVERNANCE', orgId: string = ORG) {
  return { id, orgId, name, category, description: '', createdAt: '', updatedAt: '' } as any;
}
function node(id: string, name: string, opts: { responsiblePersonId?: string; requiredSkillIds?: string[]; orgId?: string }) {
  return {
    id, orgId: opts.orgId || ORG, name, level: 'ACTIVITY',
    description: '', status: 'ACTIVE',
    responsiblePersonId: opts.responsiblePersonId ?? null,
    requiredSkillIds: opts.requiredSkillIds || [],
    createdAt: '', updatedAt: '',
  } as any;
}

const snaps = {
  people: snapshotStore('people'),
  skills: snapshotStore('skills'),
  nodes: snapshotStore('processNodes'),
};

before(() => {
  replaceArray(people, []);
  replaceArray(skills, []);
  replaceArray(processNodes, []);
});

after(() => {
  replaceArray(people, []);
  replaceArray(skills, []);
  replaceArray(processNodes, []);
  restoreStore(snaps.people);
  restoreStore(snaps.skills);
  restoreStore(snaps.nodes);
});

beforeEach(() => {
  replaceArray(people, []);
  replaceArray(skills, []);
  replaceArray(processNodes, []);
});

describe('personCoverage', () => {
  it('reports full coverage when the person has every required skill', () => {
    const cov = personCoverage(['a', 'b', 'c'], ['a', 'b']);
    assert.deepStrictEqual(cov.matched.sort(), ['a', 'b']);
    assert.deepStrictEqual(cov.missing, []);
    assert.strictEqual(cov.ratio, 1);
  });

  it('reports partial coverage with the missing skills', () => {
    const cov = personCoverage(['a'], ['a', 'b', 'c']);
    assert.deepStrictEqual(cov.matched, ['a']);
    assert.deepStrictEqual(cov.missing.sort(), ['b', 'c']);
    assert.strictEqual(cov.ratio, 1 / 3);
  });

  it('vacuously qualifies when no skills are required', () => {
    const cov = personCoverage([], []);
    assert.strictEqual(cov.ratio, 1, 'no requirements = qualified');
  });
});

describe('listUnqualifiedAssignments', () => {
  it('returns nothing when every responsible person is qualified', () => {
    people.push(person('p1', 'Alice', ['s1', 's2']) as any);
    skills.push(skill('s1', 'Skill One'), skill('s2', 'Skill Two'));
    processNodes.push(node('n1', 'Activity 1', { responsiblePersonId: 'p1', requiredSkillIds: ['s1', 's2'] }));

    const result = listUnqualifiedAssignments(ORG);
    assert.strictEqual(result.size, 0);
  });

  it('flags exactly the nodes where the responsible person is missing skills', () => {
    people.push(person('p1', 'Alice', ['s1']) as any);
    skills.push(skill('s1', 'Skill One'), skill('s2', 'Skill Two'), skill('s3', 'Skill Three'));
    processNodes.push(
      node('n1', 'Activity 1', { responsiblePersonId: 'p1', requiredSkillIds: ['s1'] }),       // qualified
      node('n2', 'Activity 2', { responsiblePersonId: 'p1', requiredSkillIds: ['s1', 's2'] }), // 1 missing
      node('n3', 'Activity 3', { responsiblePersonId: 'p1', requiredSkillIds: ['s2', 's3'] }), // 2 missing
    );

    const result = listUnqualifiedAssignments(ORG);
    assert.ok(result.has('p1'));
    const list = result.get('p1')!;
    assert.strictEqual(list.length, 2, 'only the 2 unqualified nodes show up');
    const n2 = list.find((a) => a.nodeId === 'n2')!;
    assert.deepStrictEqual(n2.missingSkillNames, ['Skill Two']);
    const n3 = list.find((a) => a.nodeId === 'n3')!;
    assert.deepStrictEqual(n3.missingSkillNames.sort(), ['Skill Three', 'Skill Two']);
  });

  it('skips nodes with no responsible person or no required skills', () => {
    people.push(person('p1', 'Alice', []) as any);
    processNodes.push(
      node('n1', 'Activity 1', { requiredSkillIds: ['s1'] }),         // no person
      node('n2', 'Activity 2', { responsiblePersonId: 'p1' }),         // no required skills
    );
    assert.strictEqual(listUnqualifiedAssignments(ORG).size, 0);
  });

  it('scopes results to the requested org', () => {
    people.push(person('p1', 'Alice', [], [OTHER_ORG]) as any);
    skills.push(skill('s1', 'Skill One', 'GOVERNANCE', OTHER_ORG));
    processNodes.push(node('n1', 'Other Org Activity', {
      responsiblePersonId: 'p1', requiredSkillIds: ['s1'], orgId: OTHER_ORG,
    }));
    // ORG has no people / nodes — the OTHER_ORG fixture must not bleed in.
    assert.strictEqual(listUnqualifiedAssignments(ORG).size, 0);
    assert.strictEqual(listUnqualifiedAssignments(OTHER_ORG).size, 1);
  });
});

describe('unqualifiedSummaryByPerson', () => {
  it('produces a per-person count + up-to-3 sample names', () => {
    people.push(person('p1', 'Alice', []) as any);
    skills.push(skill('s1', 'Skill One'));
    for (let i = 1; i <= 5; i++) {
      processNodes.push(node(`n${i}`, `Activity ${i}`, {
        responsiblePersonId: 'p1', requiredSkillIds: ['s1'],
      }));
    }
    const summary = unqualifiedSummaryByPerson(ORG);
    const entry = summary.get('p1')!;
    assert.strictEqual(entry.unqualifiedCount, 5);
    assert.strictEqual(entry.sample.length, 3, 'sample caps at 3 names');
  });
});

describe('rankPeopleByRoleSkills', () => {
  it('returns empty when no required skills are passed', () => {
    people.push(person('p1', 'Alice', ['s1']) as any);
    skills.push(skill('s1', 'Stakeholder Management'));
    assert.deepStrictEqual(rankPeopleByRoleSkills(ORG, []), []);
  });

  it('ranks people by name-keyed overlap, descending', () => {
    people.push(
      person('p1', 'Alice', ['s1', 's2', 's3']) as any,    // 3/3 — perfect
      person('p2', 'Bob',   ['s1', 's2']) as any,           // 2/3
      person('p3', 'Carol', ['s1']) as any,                 // 1/3
      person('p4', 'Dave',  ['s4']) as any,                 // 0/3 — dropped
    );
    skills.push(
      skill('s1', 'Stakeholder Management'),
      skill('s2', 'Compliance Monitoring'),
      skill('s3', 'Executive Reporting'),
      skill('s4', 'Unrelated Skill'),
    );

    const ranked = rankPeopleByRoleSkills(ORG, ['Stakeholder Management', 'Compliance Monitoring', 'Executive Reporting']);
    assert.strictEqual(ranked.length, 3, 'zero-overlap dropped');
    assert.strictEqual(ranked[0].personId, 'p1');
    assert.strictEqual(ranked[0].ratio, 1);
    assert.strictEqual(ranked[1].personId, 'p2');
    assert.strictEqual(ranked[2].personId, 'p3');
  });

  it('is case-insensitive on skill-name match', () => {
    people.push(person('p1', 'Alice', ['s1']) as any);
    skills.push(skill('s1', 'Stakeholder Management'));
    const ranked = rankPeopleByRoleSkills(ORG, ['STAKEHOLDER MANAGEMENT']);
    assert.strictEqual(ranked.length, 1);
  });

  it('honours the limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      people.push(person(`p${i}`, `Person ${i}`, ['s1']) as any);
    }
    skills.push(skill('s1', 'Skill One'));
    const ranked = rankPeopleByRoleSkills(ORG, ['Skill One'], 3);
    assert.strictEqual(ranked.length, 3);
  });

  it('only counts people assigned to the org', () => {
    people.push(person('p1', 'Other-org person', ['s1'], [OTHER_ORG]) as any);
    skills.push(skill('s1', 'Skill One'));
    assert.deepStrictEqual(rankPeopleByRoleSkills(ORG, ['Skill One']), []);
  });
});

describe('orgSkillGapReport', () => {
  it('lists each required-or-held skill with counts', () => {
    skills.push(
      skill('s1', 'Data Profiling'),
      skill('s2', 'Anomaly Detection'),
      skill('s3', 'Unused Skill'),  // dropped (0 required, 0 held)
    );
    people.push(
      person('p1', 'Alice', ['s1']) as any,
      person('p2', 'Bob',   ['s1', 's2']) as any,
    );
    processNodes.push(
      node('n1', 'Activity 1', { requiredSkillIds: ['s1'] }),
      node('n2', 'Activity 2', { requiredSkillIds: ['s2'] }),
      node('n3', 'Activity 3', { requiredSkillIds: ['s2'] }),
    );

    const report = orgSkillGapReport(ORG);
    // s3 dropped — neither required nor held.
    assert.strictEqual(report.length, 2);
    const s1 = report.find((r) => r.skillId === 's1')!;
    assert.strictEqual(s1.requiredByActivities, 1);
    assert.strictEqual(s1.heldByPeople, 2);
    const s2 = report.find((r) => r.skillId === 's2')!;
    assert.strictEqual(s2.requiredByActivities, 2);
    assert.strictEqual(s2.heldByPeople, 1);
  });

  it('sorts highest gap score first', () => {
    skills.push(
      skill('s1', 'Well-staffed'),  // 1 required, 5 held — gap 0.2
      skill('s2', 'Painful gap'),    // 5 required, 1 held — gap 5
      skill('s3', 'Critical gap'),   // 3 required, 0 held — gap 3
    );
    // 5 holders for s1, 1 for s2, 0 for s3.
    for (let i = 0; i < 5; i++) people.push(person(`h1-${i}`, `H1 ${i}`, ['s1']) as any);
    people.push(person('h2', 'H2', ['s2']) as any);
    // 1 requiring node for s1, 5 for s2, 3 for s3.
    processNodes.push(node('n-s1-1', 'N s1-1', { requiredSkillIds: ['s1'] }));
    for (let i = 0; i < 5; i++) processNodes.push(node(`n-s2-${i}`, `N s2-${i}`, { requiredSkillIds: ['s2'] }));
    for (let i = 0; i < 3; i++) processNodes.push(node(`n-s3-${i}`, `N s3-${i}`, { requiredSkillIds: ['s3'] }));

    const report = orgSkillGapReport(ORG);
    assert.strictEqual(report[0].skillName, 'Painful gap',   'highest gap-score first');
    assert.strictEqual(report[1].skillName, 'Critical gap');
    assert.strictEqual(report[2].skillName, 'Well-staffed');
  });
});
