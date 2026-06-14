import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  listEntities,
  getEntity,
  getCatalog,
  LDM_VERSION,
} from '../services/data-model';

// The LDM catalog has both structural invariants (everything points to
// a real target, no duplicate ids) and contract invariants (the
// nameField must exist on the entity, fields and relationships have
// stable ids). These tests guard both.

describe('LDM catalog — structural invariants', () => {
  it('exposes a non-empty entity list', () => {
    const entities = listEntities();
    assert.ok(entities.length > 0, 'at least one entity is defined');
  });

  it('has unique entity ids', () => {
    const ids = listEntities().map((e) => e.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'entity ids are unique');
  });

  it('every entity has unique field ids', () => {
    for (const entity of listEntities()) {
      const ids = entity.fields.map((f) => f.id);
      assert.strictEqual(
        new Set(ids).size, ids.length,
        `entity ${entity.id} has unique field ids`,
      );
    }
  });

  it('every entity has unique relationship ids', () => {
    for (const entity of listEntities()) {
      const ids = entity.relationships.map((r) => r.id);
      assert.strictEqual(
        new Set(ids).size, ids.length,
        `entity ${entity.id} has unique relationship ids`,
      );
    }
  });

  it('every entity\'s nameField points at a real field', () => {
    for (const entity of listEntities()) {
      const has = entity.fields.some((f) => f.id === entity.nameField);
      assert.ok(has, `entity ${entity.id} nameField "${entity.nameField}" exists`);
    }
  });

  it('every relationship target resolves to a real entity', () => {
    const entityIds = new Set(listEntities().map((e) => e.id));
    for (const entity of listEntities()) {
      for (const rel of entity.relationships) {
        assert.ok(
          entityIds.has(rel.target),
          `${entity.id}.${rel.id} → ${rel.target} resolves`,
        );
      }
    }
  });

  it('every enum field has at least one allowed value', () => {
    for (const entity of listEntities()) {
      for (const field of entity.fields) {
        if (field.type === 'enum') {
          assert.ok(
            (field.enumValues || []).length > 0,
            `${entity.id}.${field.id} enum has values`,
          );
        }
      }
    }
  });
});

describe('LDM catalog — accessors', () => {
  it('getEntity returns the matching entity', () => {
    const e = getEntity('processNodes');
    assert.ok(e);
    assert.strictEqual(e!.id, 'processNodes');
  });

  it('getEntity returns undefined for an unknown id', () => {
    assert.strictEqual(getEntity('does-not-exist'), undefined);
  });

  it('getCatalog returns the version + entities together', () => {
    const cat = getCatalog();
    assert.strictEqual(cat.version, LDM_VERSION);
    assert.ok(cat.entities.length > 0);
  });
});

describe('LDM catalog — domain coverage', () => {
  // These tests pin down the entities we promised the Report Builder
  // would cover. If any get removed, callers should be migrated first.
  const requiredEntities = [
    'processNodes', 'dataAssets', 'systems', 'people',
    'organizations', 'mappings', 'dataDomains', 'damaRoles', 'skills',
  ];

  for (const id of requiredEntities) {
    it(`includes ${id}`, () => {
      assert.ok(getEntity(id), `${id} is in the catalog`);
    });
  }

  it('Processes can join to Responsible Person and Required Skills', () => {
    const proc = getEntity('processNodes')!;
    const relIds = proc.relationships.map((r) => r.id);
    assert.ok(relIds.includes('responsiblePerson'));
    assert.ok(relIds.includes('requiredSkills'));
  });

  it('Data Assets can join to Owner and System of Record', () => {
    const asset = getEntity('dataAssets')!;
    const relIds = asset.relationships.map((r) => r.id);
    assert.ok(relIds.includes('owner'));
    assert.ok(relIds.includes('system'));
  });
});
