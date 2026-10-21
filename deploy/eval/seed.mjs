// Procela evaluation seeder — loads a demo tenant on first boot.
//
// Runs in a throwaway node:20-slim container (see docker-compose.eval.yml).
// Uses only Node's built-in fetch — no repo, no dependencies.
//
// Flow:
//   1. Wait for the backend health endpoint.
//   2. Dev-login as a SUPER_ADMIN (the eval build runs AUTH_PROVIDER=dev, so
//      this is passwordless and trusts the role in the request).
//   3. If an organization already exists, STOP — we don't re-seed, so
//      restarting the stack never wipes data the evaluator added.
//   4. Otherwise POST /admin/demo-seed for the chosen industry (same endpoint
//      as Settings → "Load demo data").

const BASE = process.env.PROCELA_URL || 'http://backend:3001/api/v1';
const INDUSTRY = (process.env.DEMO_INDUSTRY || 'utilities').trim().toLowerCase();
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'eval.admin@procela.local';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    console.log('waiting for backend…');
    await sleep(2000);
  }
  throw new Error('backend did not become healthy in time');
}

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, name: 'Eval Admin', role: 'SUPER_ADMIN' }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j?.data?.accessToken;
  if (!r.ok || !token) {
    throw new Error(`login failed (${r.status}) — this assumes AUTH_PROVIDER=dev: ${JSON.stringify(j)}`);
  }
  return token;
}

async function alreadySeeded(token) {
  try {
    const r = await fetch(`${BASE}/organizations`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j?.data) && j.data.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  await waitForHealth();
  const token = await login();

  if (await alreadySeeded(token)) {
    console.log('An organization already exists — skipping demo seed (nothing was wiped).');
    return;
  }

  const r = await fetch(`${BASE}/admin/demo-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ industry: INDUSTRY }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.success) {
    throw new Error(`demo-seed failed (${r.status}): ${JSON.stringify(j)}`);
  }
  console.log(j.message || `Seeded the ${INDUSTRY} demo tenant.`);
  if (j.data?.persona?.name) {
    console.log(`Sign in as ${j.data.persona.name} to walk the demo.`);
  }
}

main().catch((e) => {
  console.error('Eval seed failed:', e.message);
  process.exit(1);
});
