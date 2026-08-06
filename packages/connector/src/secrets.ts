// Secret interpolation for connector source connection strings.
//
// Instead of embedding a database password inline in connector.yaml,
// a connectionString may reference a secret the host already holds, so
// the credential is delivered by the operator's secret store (Docker /
// Kubernetes secrets, Vault, a systemd credential, etc.) rather than
// sitting in plaintext in the config file:
//
//   ${VAR}         -> value of environment variable VAR
//   ${file:/path}  -> trimmed contents of the file at /path
//                     (e.g. a Docker/K8s secret mounted at /run/secrets/db_pw)
//
// Only the referenced span is substituted, so the readable parts of the
// DSN stay in the file:
//
//   connectionString: postgres://procela_ro:${PG_PASSWORD}@db.internal:5432/warehouse
//
// A string with no ${...} reference is returned unchanged, so existing
// inline connection strings keep working. A reference that can't be
// resolved throws — a missing secret must fail loudly rather than
// silently produce a broken DSN.
//
// Pure given the injected env + readFile, so it is unit-testable without
// touching the real filesystem. Resolution happens at scan time (not at
// config load), so the config the connector rewrites with its pairing
// token never has a resolved secret written back into it, and a rotated
// secret file is picked up on the next scan without a restart.

import type { ConnectorConfig, Source } from './types';

export interface SecretResolvers {
  env: NodeJS.ProcessEnv;
  /** Reads a file as UTF-8. Injected so tests need no real filesystem. */
  readFile: (path: string) => string;
}

/** Default resolvers wiring the real process env + filesystem. */
export function defaultResolvers(readFile: (path: string) => string): SecretResolvers {
  return { env: process.env, readFile };
}

const REF = /\$\{([^}]+)\}/g;

/** Resolve every ${...} reference in a single string. `label` names the
 *  field so an error points the operator at the right config line. */
export function interpolate(value: string, resolvers: SecretResolvers, label: string): string {
  return value.replace(REF, (_match, ref: string) => {
    const token = ref.trim();

    if (token.startsWith('file:')) {
      const path = token.slice('file:'.length).trim();
      if (!path) throw new Error(`${label}: empty file reference in \${file:}`);
      let contents: string;
      try {
        contents = resolvers.readFile(path);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${label}: cannot read secret file '${path}': ${msg}`);
      }
      // Secret files conventionally carry a single trailing newline
      // (e.g. `echo -n` is easy to forget); strip one, keep the rest.
      return contents.replace(/\r?\n$/, '');
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      const v = resolvers.env[token];
      if (v === undefined || v === '') {
        throw new Error(`${label}: environment variable '${token}' is not set`);
      }
      return v;
    }

    throw new Error(
      `${label}: unrecognized secret reference '\${${ref}}' (use \${ENV_VAR} or \${file:/path})`,
    );
  });
}

/** Return a copy of the source with secret references resolved in its
 *  connectionString. Sources without a connectionString (dbt) and
 *  strings with no reference are returned unchanged. */
export function resolveSourceSecrets<S extends Source>(source: S, resolvers: SecretResolvers): S {
  if (
    'connectionString' in source &&
    typeof (source as { connectionString?: unknown }).connectionString === 'string' &&
    (source as { connectionString: string }).connectionString.includes('${')
  ) {
    const cs = (source as { connectionString: string }).connectionString;
    return {
      ...source,
      connectionString: interpolate(cs, resolvers, `source '${source.name}' connectionString`),
    };
  }
  return source;
}

/** Convenience: resolve secrets across every source in a config. Not used
 *  on the load path (see the module note) but handy for callers that want
 *  the whole set resolved at once. */
export function resolveConfigSecrets(cfg: ConnectorConfig, resolvers: SecretResolvers): ConnectorConfig {
  return { ...cfg, sources: cfg.sources.map((s) => resolveSourceSecrets(s, resolvers)) };
}
