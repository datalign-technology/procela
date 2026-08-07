import { describe, it } from 'node:test';
import assert from 'node:assert';

import { interpolate, resolveSourceSecrets, resolveConfigSecrets } from '../secrets';
import type { SecretResolvers } from '../secrets';
import type { ConnectorConfig, PostgresSource, DbtSource } from '../types';

// A source connectionString may reference a secret the host already
// holds (env var or mounted file) instead of embedding the password
// inline. These pure tests pin that resolution; index.ts wires the real
// process env + filesystem.

function resolvers(env: Record<string, string>, files: Record<string, string> = {}): SecretResolvers {
  return {
    env,
    readFile: (path: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
  };
}

describe('secrets — interpolate', () => {
  it('passes a string with no reference straight through', () => {
    const cs = 'postgres://procela_ro:hunter2@db.internal:5432/warehouse';
    assert.strictEqual(interpolate(cs, resolvers({}), 'x'), cs);
  });

  it('substitutes an env var into the DSN, leaving the rest intact', () => {
    const out = interpolate(
      'postgres://procela_ro:${PG_PW}@db.internal:5432/warehouse',
      resolvers({ PG_PW: 's3cret' }),
      'x',
    );
    assert.strictEqual(out, 'postgres://procela_ro:s3cret@db.internal:5432/warehouse');
  });

  it('reads a secret file and strips a single trailing newline', () => {
    const out = interpolate(
      'postgres://ro:${file:/run/secrets/db_pw}@h/db',
      resolvers({}, { '/run/secrets/db_pw': 'file-secret\n' }),
      'x',
    );
    assert.strictEqual(out, 'postgres://ro:file-secret@h/db');
  });

  it('resolves multiple references in one string', () => {
    const out = interpolate(
      '${SCHEME}://${USER}:${PW}@host/db',
      resolvers({ SCHEME: 'postgres', USER: 'ro', PW: 'p' }),
      'x',
    );
    assert.strictEqual(out, 'postgres://ro:p@host/db');
  });

  it('throws a labelled error when an env var is unset', () => {
    assert.throws(
      () => interpolate('a${MISSING}b', resolvers({}), "source 'wh' connectionString"),
      /source 'wh' connectionString: environment variable 'MISSING' is not set/,
    );
  });

  it('treats an empty env var as unset (fail loud, not silent blank)', () => {
    assert.throws(
      () => interpolate('${PW}', resolvers({ PW: '' }), 'x'),
      /environment variable 'PW' is not set/,
    );
  });

  it('throws when a secret file cannot be read', () => {
    assert.throws(
      () => interpolate('${file:/nope}', resolvers({}), 'x'),
      /cannot read secret file '\/nope'/,
    );
  });

  it('rejects an unrecognized reference form', () => {
    assert.throws(
      () => interpolate('${weird ref!}', resolvers({}), 'x'),
      /unrecognized secret reference/,
    );
  });
});

describe('secrets — resolveSourceSecrets', () => {
  const base: PostgresSource = {
    type: 'postgres',
    name: 'warehouse',
    connectionString: 'postgres://ro:${PG_PW}@db/wh',
    schemas: ['public'],
  };

  it('resolves the connectionString of a DB source', () => {
    const out = resolveSourceSecrets(base, resolvers({ PG_PW: 'x' }));
    assert.strictEqual(out.connectionString, 'postgres://ro:x@db/wh');
    assert.deepStrictEqual(out.schemas, ['public']); // other fields preserved
  });

  it('returns the same source object when there is no reference', () => {
    const inline: PostgresSource = { ...base, connectionString: 'postgres://ro:inline@db/wh' };
    const out = resolveSourceSecrets(inline, resolvers({}));
    assert.strictEqual(out, inline);
  });

  it('leaves a dbt source (no connectionString) untouched', () => {
    const dbt: DbtSource = { type: 'dbt', name: 'analytics', manifestPath: '/p/manifest.json' };
    const out = resolveSourceSecrets(dbt, resolvers({}));
    assert.strictEqual(out, dbt);
  });
});

describe('secrets — resolveConfigSecrets', () => {
  it('resolves every source but does not mutate the input', () => {
    const cfg: ConnectorConfig = {
      procelaUrl: 'https://p/api/v1',
      token: 'pct_x',
      heartbeatSeconds: 60,
      scanSeconds: 1800,
      sources: [
        { type: 'postgres', name: 'a', connectionString: 'postgres://ro:${A}@h/a' },
        { type: 'mysql', name: 'b', connectionString: 'mysql://ro:${B}@h/b' },
        { type: 'dbt', name: 'c', manifestPath: '/m.json' },
      ],
    };
    const out = resolveConfigSecrets(cfg, resolvers({ A: '1', B: '2' }));
    assert.strictEqual((out.sources[0] as PostgresSource).connectionString, 'postgres://ro:1@h/a');
    assert.strictEqual((out.sources[1] as { connectionString: string }).connectionString, 'mysql://ro:2@h/b');
    // input untouched
    assert.strictEqual((cfg.sources[0] as PostgresSource).connectionString, 'postgres://ro:${A}@h/a');
  });
});
