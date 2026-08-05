// Config-doc guard (GA audit §G): every process.env.X the backend reads
// must be discoverable in the repo-root .env.example — as a `KEY=` line or
// mentioned in a comment (e.g. a deprecated alias). Prevents the doc gap
// the audit flagged from silently re-growing as new knobs are added.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');
const ENV_EXAMPLE = path.resolve(process.cwd(), '../../.env.example');

// Vars intentionally NOT in .env.example — platform/runtime vars set by
// the environment rather than Procela config. Add here with a reason.
const ALLOWLIST = new Set<string>([
  // (empty today)
]);

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walkTs(p, acc);
    } else if (entry.name.endsWith('.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

function readEnvVarsFromSource(): Set<string> {
  const vars = new Set<string>();
  for (const file of walkTs(SRC)) {
    const txt = fs.readFileSync(file, 'utf8');
    for (const m of txt.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) vars.add(m[1]);
  }
  return vars;
}

// Every UPPER_SNAKE token in .env.example (keys AND comment mentions).
function documentedTokens(): Set<string> {
  const txt = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const tokens = new Set<string>();
  for (const m of txt.matchAll(/[A-Z_][A-Z0-9_]{2,}/g)) tokens.add(m[0]);
  return tokens;
}

describe('.env.example documents every env var the backend reads', () => {
  it('has no undocumented process.env reads', () => {
    const read = readEnvVarsFromSource();
    const documented = documentedTokens();
    const missing = [...read]
      .filter((v) => !documented.has(v) && !ALLOWLIST.has(v))
      .sort();
    assert.deepStrictEqual(
      missing, [],
      `Undocumented env var(s) — add to .env.example: ${missing.join(', ')}`,
    );
  });
});
