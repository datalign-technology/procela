#!/usr/bin/env node
/**
 * Seed script — loads an in-app demo tenant fixture via the
 * /admin/demo-seed endpoint (the SAME mechanism as the Settings →
 * "Load demo data" button). This gives every demo industry npm + docker
 * parity with the Settings UI, alongside the bespoke seed-tidewater.js /
 * seed-momentum-governance.js scripts (which seed a different, older
 * test-data tenant and are left untouched).
 *
 * Run:
 *   node packages/backend/scripts/seed-demo.js <industry> [BASE_URL]
 *   npm run db:seed:demo -- <industry>            # from packages/backend
 *
 * <industry> is one of the DemoIndustry keys:
 *   utilities | shipbuilding | healthcare | manufacturing | financial |
 *   government | logistics | insurance | telecom | education
 *
 * The fixture is idempotent — every row is stamped `demo-*`, and a second
 * run wipes the prior demo tenant and reloads, so it converges on a known
 * state (identical to clicking the button twice in the UI).
 *
 * Defaults (override via env or argv):
 *   BASE_URL          argv[3] or SEED_BASE_URL  (http://localhost:3001/api/v1)
 *   super-admin email SEED_ADMIN_EMAIL          (eleanor.briggs@tidewater-utilities.com)
 *
 * Auth: the /admin/demo-seed endpoint is SUPER_ADMIN-only. Like the other
 * seed scripts this assumes the default dev auth provider (AUTH_PROVIDER=dev),
 * which mints a token for the requested email + role with no password. Point
 * SEED_ADMIN_EMAIL at your bootstrapped SUPER_ADMIN for non-dev setups.
 */

const INDUSTRIES = [
  'utilities', 'shipbuilding', 'healthcare', 'manufacturing', 'financial',
  'government', 'logistics', 'insurance', 'telecom', 'education',
];

const industry = String(process.argv[2] || '').trim().toLowerCase();
const BASE = process.argv[3] || process.env.SEED_BASE_URL || 'http://localhost:3001/api/v1';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'eleanor.briggs@tidewater-utilities.com';

if (!industry || !INDUSTRIES.includes(industry)) {
  console.error(
    `Usage: node packages/backend/scripts/seed-demo.js <industry> [BASE_URL]\n` +
    `       npm run db:seed:demo -- <industry>\n\n` +
    `  <industry> must be one of:\n    ${INDUSTRIES.join(', ')}`,
  );
  process.exit(1);
}

async function main() {
  // Dev login (passwordless) as a SUPER_ADMIN — the dev auth provider
  // trusts the role in the request body, and this email has no Person
  // row so that role is what the token carries.
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, name: 'Demo Seeder', role: 'SUPER_ADMIN' }),
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson?.data?.accessToken;
  if (!loginRes.ok || !token) {
    throw new Error(
      `login failed (${loginRes.status}) as ${ADMIN_EMAIL}: ${JSON.stringify(loginJson)}\n` +
      `  (the /admin/demo-seed endpoint needs a SUPER_ADMIN; this assumes AUTH_PROVIDER=dev)`,
    );
  }

  const res = await fetch(`${BASE}/admin/demo-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ industry }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    throw new Error(`demo-seed failed (${res.status}): ${JSON.stringify(json)}`);
  }

  console.log(json.message || `Seeded the ${industry} demo tenant.`);
  if (json.data?.persona?.name) {
    console.log(`  Sign in as ${json.data.persona.name} (CDO) to walk the demo.`);
  }
}

main().catch((e) => {
  console.error('Demo seed failed:', e.message);
  process.exit(1);
});
