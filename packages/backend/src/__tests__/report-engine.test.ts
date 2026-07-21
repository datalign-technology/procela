import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { people } from '../routes/people';
import { skills } from '../stores/skills';
import { processNodes } from '../routes/process-catalog';
import { dataAssets } from '../routes/data-assets';
import { systems } from '../routes/systems';

import {
  executeReport,
  validateDefinition,
  type ReportDefinition,
} from '../services/report-engine';

import { useStoreIsolation } from './_helpers/store-isolation';

const ORG = 'test-org-rpt';
const OTHER_ORG = 'test-org-rpt-other';

function person(id: string, name: string, extras: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id, orgIds: [ORG], accessibleOrgIds: [ORG], name, email: `${id}@x.io`,
    role: 'VIEWER', title: '', skillIds: [], createdAt: now, updatedAt: now,
    ...extras,
  };
}
function skill(id: string, name: string) {
  return { id, orgId: ORG, name, category: 'GOVERNANCE', description: '', createdAt: '', updatedAt: '' } as any;
}
function node(id: string, name: string, extras: Partial<Record<string, unknown>> = {}) {
  return {
    id, orgId: ORG, name, level: 'ACTIVITY',
    description: '', status: 'ACTIVE',
    responsiblePersonId: null, requiredSkillIds: [],
    createdAt: '', updatedAt: '',
    ...extras,
  } as any;
}
function asset(id: string, name: string, extras: Partial<Record<string, unknown>> = {}) {
  return {
    id, orgId: ORG, name, description: '',
    governanceTier: 'BRONZE', healthScore: 80,
    createdAt: '', updatedAt: '',
    ...extras,
  } as any;
}

useStoreIsolation(
  { file: 'people', memory: people },
  { file: 'skills', memory: skills },
  { file: 'processNodes', memory: processNodes },
  { file: 'dataAssets', memory: dataAssets },
  { file: 'systems', memory: systems },
);

describe('validateDefinition', () => {
  it('flags unknown entity', async () => {
    const errs = validateDefinition({ entity: 'nope', columns: [{ field: 'x' }], filters: [] });
    assert.ok(errs.some((e) => e.message.includes('Unknown entity')));
  });

  it('flags missing columns', async () => {
    const errs = validateDefinition({ entity: 'processNodes', columns: [], filters: [] });
    assert.ok(errs.some((e) => e.message.includes('at least one column')));
  });

  it('flags unknown direct field', async () => {
    const errs = validateDefinition({
      entity: 'processNodes',
      columns: [{ field: 'nonsense' }],
      filters: [],
    });
    assert.ok(errs.some((e) => e.field === 'nonsense'));
  });

  it('accepts a valid joined field path', async () => {
    const errs = validateDefinition({
      entity: 'processNodes',
      columns: [{ field: 'name' }, { field: 'responsiblePerson.name' }],
      filters: [],
    });
    assert.deepStrictEqual(errs, []);
  });

  it('rejects filters on joined fields', async () => {
    const errs = validateDefinition({
      entity: 'processNodes',
      columns: [{ field: 'name' }],
      filters: [{ field: 'responsiblePerson.name', op: 'eq', value: 'x' }],
    });
    assert.ok(errs.some((e) => e.field === 'responsiblePerson.name'));
  });
});

describe('executeReport — projection + filters', () => {
  it('returns direct-field rows scoped to the org', async () => {
    processNodes.push(node('n1', 'Activity 1'));
    processNodes.push(node('n2', 'Activity 2'));
    processNodes.push(node('n3', 'Other-org activity', { orgId: OTHER_ORG }));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }],
      filters: [],
    }, ORG);

    assert.strictEqual(result.totalMatched, 2);
    assert.deepStrictEqual(result.rows.map((r) => r.name).sort(), ['Activity 1', 'Activity 2']);
  });

  it('applies a contains filter case-insensitively', async () => {
    processNodes.push(node('n1', 'Outage triage'));
    processNodes.push(node('n2', 'Bill calculation'));
    processNodes.push(node('n3', 'Routine inspection'));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }],
      filters: [{ field: 'name', op: 'contains', value: 'OUTAGE' }],
    }, ORG);

    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, 'Outage triage');
  });

  it('respects the limit and reports totalMatched separately', async () => {
    for (let i = 0; i < 10; i++) processNodes.push(node(`n${i}`, `Activity ${i}`));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }],
      filters: [],
      limit: 3,
    }, ORG);

    assert.strictEqual(result.rows.length, 3);
    assert.strictEqual(result.totalMatched, 10);
  });

  it('sorts by direct field descending', async () => {
    processNodes.push(node('n1', 'Charlie'));
    processNodes.push(node('n2', 'Alpha'));
    processNodes.push(node('n3', 'Bravo'));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }],
      filters: [],
      sort: { field: 'name', direction: 'desc' },
    }, ORG);

    assert.deepStrictEqual(result.rows.map((r) => r.name), ['Charlie', 'Bravo', 'Alpha']);
  });
});

describe('executeReport — cross-entity joins', () => {
  it('renders a one-to-one joined field', async () => {
    people.push(person('p1', 'Alice'));
    processNodes.push(node('n1', 'Activity 1', { responsiblePersonId: 'p1' }));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [
        { field: 'name' },
        { field: 'responsiblePerson.name' },
      ],
      filters: [],
    }, ORG);

    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0]['responsiblePerson.name'], 'Alice');
  });

  it('returns null on a one-to-one join when the FK is missing', async () => {
    processNodes.push(node('n1', 'Orphan activity'));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }, { field: 'responsiblePerson.name' }],
      filters: [],
    }, ORG);

    assert.strictEqual(result.rows[0]['responsiblePerson.name'], null);
  });

  it('joins a many-relationship as a comma-joined string', async () => {
    skills.push(skill('s1', 'Data Profiling'));
    skills.push(skill('s2', 'Anomaly Detection'));
    processNodes.push(node('n1', 'Activity 1', { requiredSkillIds: ['s1', 's2'] }));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }, { field: 'requiredSkills.name' }],
      filters: [],
    }, ORG);

    assert.strictEqual(result.rows[0]['requiredSkills.name'], 'Data Profiling, Anomaly Detection');
  });

  it('returns an empty string for an empty many-relationship', async () => {
    processNodes.push(node('n1', 'Activity 1'));

    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'requiredSkills.name' }],
      filters: [],
    }, ORG);

    assert.strictEqual(result.rows[0]['requiredSkills.name'], '');
  });
});

describe('executeReport — column labels', () => {
  it('uses the LDM label by default', async () => {
    processNodes.push(node('n1', 'Activity 1'));
    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name' }, { field: 'responsiblePerson.name' }],
      filters: [],
    }, ORG);
    assert.strictEqual(result.columns[0].label, 'Name');
    assert.strictEqual(result.columns[1].label, 'Responsible Person — Name');
  });

  it('honours an explicit column label override', async () => {
    processNodes.push(node('n1', 'Activity 1'));
    const result = await executeReport({
      entity: 'processNodes',
      columns: [{ field: 'name', label: 'Activity' }],
      filters: [],
    }, ORG);
    assert.strictEqual(result.columns[0].label, 'Activity');
  });
});

describe('executeReport — people org-scoping', () => {
  it('scopes People by orgIds, not orgId', async () => {
    people.push(person('p1', 'In-org'));
    people.push(person('p2', 'Other-org', { orgIds: [OTHER_ORG] }));

    const result = await executeReport({
      entity: 'people',
      columns: [{ field: 'name' }],
      filters: [],
    }, ORG);

    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, 'In-org');
  });
});

describe('executeReport — data assets', () => {
  it('reads enum + numeric fields and filters with gte', async () => {
    dataAssets.push(asset('a1', 'Healthy', { healthScore: 95 }));
    dataAssets.push(asset('a2', 'Mediocre', { healthScore: 60 }));
    dataAssets.push(asset('a3', 'Poor', { healthScore: 30 }));

    const result = await executeReport({
      entity: 'dataAssets',
      columns: [{ field: 'name' }, { field: 'healthScore' }],
      filters: [{ field: 'healthScore', op: 'gte', value: 70 }],
      sort: { field: 'healthScore', direction: 'desc' },
    }, ORG);

    assert.strictEqual(result.totalMatched, 1);
    assert.strictEqual(result.rows[0].name, 'Healthy');
  });
});
