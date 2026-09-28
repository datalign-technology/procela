// Prisma configuration (replaces the deprecated `package.json#prisma` key,
// removed in Prisma 7). Prisma auto-discovers this file at the repo root, which
// is where every prisma command runs (`npm run db:generate` / `db:migrate` /
// `db:studio`, and CI's `prisma generate` + `migrate deploy`).
//
// IMPORTANT: once a config file exists, Prisma no longer auto-loads `.env`, so
// we load it ourselves — otherwise DATABASE_URL wouldn't resolve for migrate /
// studio. `dotenv/config` is a no-op when there's no `.env` (e.g. CI, where the
// database URL is already in the environment).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Path is resolved relative to this config file (the repo root) — same value
  // the old `package.json#prisma.schema` key carried.
  schema: 'packages/backend/prisma/schema.prisma',
});
