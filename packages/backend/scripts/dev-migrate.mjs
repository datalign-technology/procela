// predev guard — keep a local Postgres schema in step with prisma/migrations so
// that pulling new migrations "just works" on `npm run dev`, without breaking the
// zero-config path.
//
// Runs automatically before `npm run dev` (the `predev` npm hook). It loads the
// same .env files the backend does — repo-root first, then packages/backend/.env
// overriding — and then decides:
//
//   • no DATABASE_URL  → the JSON-file store is in use; skip (nothing to migrate).
//   • DATABASE_URL set → `prisma migrate deploy`, applying any pending migrations.
//       It fails loudly (non-zero exit) if a migration can't apply, so dev never
//       boots against a schema that's behind the code.
//
// `migrate deploy` (not `migrate dev`) is deliberate: it is non-interactive and
// only applies already-committed migrations — it never prompts, generates, or
// resets. DATABASE_URL is passed through in the environment, so Prisma sees it
// even when it lives only in the repo-root .env (which Prisma would not auto-load
// on its own when run from packages/backend).
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(backendDir, '..', '..');

// Same precedence as src/index.ts: repo-root .env first, packages/backend/.env
// overrides. Missing files are a no-op.
for (const envPath of [path.join(repoRoot, '.env'), path.join(backendDir, '.env')]) {
  dotenv.config({ path: envPath, override: true });
}

if (!process.env.DATABASE_URL) {
  console.log('[dev-migrate] No DATABASE_URL set — using the JSON-file store; skipping Prisma migrations.');
  process.exit(0);
}

try {
  console.log('[dev-migrate] DATABASE_URL set — applying any pending migrations (prisma migrate deploy)…');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: backendDir, env: process.env });
} catch {
  console.error(
    '\n[dev-migrate] `prisma migrate deploy` failed. Resolve the database / migration error above, ' +
    'then re-run `npm run dev`. (To develop against the zero-config JSON store instead, unset DATABASE_URL.)',
  );
  process.exit(1);
}
