import { Router, Request, Response } from 'express';
import { randomBytes, randomInt, createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import { loadStore, registerStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import { dataAssets } from './data-assets';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { createNotification } from './notifications';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { getConnectorsRepository } from '../db/connectors.repo';
import { getConnectorEventsRepository } from '../db/connector-events.repo';

// ──────────────────────────────────────────────────────────────────────────
// Connectors — the on-prem agent surface.
//
// Two halves:
//   1. Admin-side: register / list / revoke connector instances.
//      Authenticated via the standard Bearer-token middleware mounted
//      by index.ts; only ORG_ADMIN+ should be exposing connector
//      management to the UI.
//   2. Connector-side: pair / heartbeat / report. These take a
//      connector-issued token in the Authorization header rather
//      than a user JWT. Validated against the connector store's
//      hashed token field below — never compare plaintext.
//
// Pairing flow:
//   1. Admin clicks "Add connector" in Settings → POST /pair/start
//      with the desired name. Backend mints a 8-digit pairing code
//      and a placeholder connector row. Code TTLs in 10 minutes.
//   2. Admin runs the agent container; it prints the pairing code in
//      its logs (admin types it back into the UI) OR the admin
//      passes the code as an env var to the container directly.
//      Either way the connector calls POST /pair/claim with the
//      code.
//   3. Backend returns a long-lived token; connector writes it to
//      its local config and starts the steady-state poll loop.
//
// Token shape: 48 bytes of random hex (96 chars) prefixed with
// "pct_" so a leaked one is obviously a Procela connector token
// when it shows up in a logfile or pastebin. Stored as a SHA-256
// hash; the plaintext is only returned at pair-claim time.
// ──────────────────────────────────────────────────────────────────────────

export interface StoredConnector {
  id: string;
  orgId: string;
  /** Human-given name — shown in the registry list. */
  name: string;
  /** SHA-256 hash of the plaintext token. Plaintext is shown to the
   *  admin once at pair-claim time, then never re-displayed. */
  tokenHash: string | null;
  /** 8-digit pairing code awaiting claim. Cleared once the connector
   *  claims it and exchanges for a token. */
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  /** Which Systems this connector is responsible for. Population
   *  happens out of band — admin assigns systems on the connector
   *  detail or on the System edit form. v1 leaves it empty and the
   *  connector reports against any system the admin tags. */
  systemIds: string[];
  /** Reported by the agent on every heartbeat. Drives the offline
   *  notification: when (now - lastHeartbeatAt) > offlineThresholdMs
   *  the row turns amber and a notification fires. */
  lastHeartbeatAt: string | null;
  /** Free-form version string the agent self-reports (e.g. "1.0.0"). */
  agentVersion: string | null;
  /** Whether the row is currently considered offline. Computed at
   *  list time but persisted here so we can fire the notification
   *  exactly once on the transition. */
  status: 'PAIRED' | 'ONLINE' | 'STALE' | 'OFFLINE' | 'REVOKED';
  createdAt: string;
  updatedAt: string;
}

export const connectors: StoredConnector[] = loadStore<StoredConnector>('connectors');
registerStore('connectors', connectors);

// Audit / detail entries the agent posts. Lives in its own store so
// the per-connector activity tab can scan a focused slice rather than
// filter the global audit log.
export interface StoredConnectorEvent {
  id: string;
  connectorId: string;
  orgId: string;
  type: 'PAIRED' | 'HEARTBEAT' | 'SCAN_STARTED' | 'SCAN_COMPLETED' | 'SCAN_FAILED' | 'ASSETS_REPORTED';
  ts: string;
  /** Optional payload — counts, durations, error text. Keep small. */
  data: Record<string, any>;
}
export const connectorEvents: StoredConnectorEvent[] = loadStore<StoredConnectorEvent>('connectorEvents');
registerStore('connectorEvents', connectorEvents);

const connectorsRepo = getConnectorsRepository(connectors);
// Foreign data-asset writes go through the repository (Postgres or JSON) — PR 7b.
const dataAssetsRepo = getDataAssetsRepository(dataAssets);
const connectorEventsRepo = getConnectorEventsRepository(connectorEvents);

const router = Router();

// Pairing-code brute force throttle. The codes are 8 digits with a
// 10-min TTL so the search space is small enough that a tight
// per-IP limit is worth the cost. 10 attempts per minute and 100
// per hour keys on IP only — the body has no identity yet.
const pairClaimLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyBy: (req) => `pair-claim:${req.ip || 'noip'}`,
  label: 'connector_pair_claim',
});
const pairClaimHourLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 100,
  keyBy: (req) => `pair-claim-hr:${req.ip || 'noip'}`,
  label: 'connector_pair_claim_hour',
});

const PAIRING_TTL_MS = 10 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;   // amber after 30m silence
const OFFLINE_THRESHOLD_MS = 4 * 60 * 60_000; // red after 4h silence

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
function generatePairingCode(): string {
  // 8 digits, zero-padded. Avoids ambiguous characters by sticking
  // to numerics — admins type these by hand, and 'O' vs '0' is the
  // classic time-waster.
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}
function generateToken(): string {
  return 'pct_' + randomBytes(48).toString('hex');
}
function nowIso(): string {
  return new Date().toISOString();
}

/** Compute the freshness bucket for a row at read time. We don't
 *  persist this — clients always see the live computation. Persist
 *  status only when the state actually transitions to OFFLINE so we
 *  can fire the notification exactly once. */
function freshnessFor(row: StoredConnector): StoredConnector['status'] {
  if (row.status === 'REVOKED') return 'REVOKED';
  if (!row.lastHeartbeatAt) return 'PAIRED';
  const ms = Date.now() - new Date(row.lastHeartbeatAt).getTime();
  if (ms < STALE_THRESHOLD_MS) return 'ONLINE';
  if (ms < OFFLINE_THRESHOLD_MS) return 'STALE';
  return 'OFFLINE';
}

// Connector-token middleware — used by the agent-side endpoints.
// The admin-side endpoints continue to use the standard authenticateToken
// from index.ts and are mounted under the same /connectors prefix.
async function requireConnectorToken(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.header('authorization') || '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) { res.status(401).json({ success: false, error: 'connector token required' }); return; }
  const provided = m[1];
  if (!provided.startsWith('pct_')) { res.status(401).json({ success: false, error: 'not a connector token' }); return; }
  const hash = hashToken(provided);
  const row = (await connectorsRepo.list()).find((c) => c.tokenHash === hash && c.status !== 'REVOKED');
  if (!row) { res.status(401).json({ success: false, error: 'invalid or revoked connector token' }); return; }
  (req as any).connector = row;
  next();
}

// ── Admin-side: registry CRUD ────────────────────────────────────────────

/** GET /connectors — list every connector in scope. Each row carries
 *  its live freshness bucket so the UI doesn't have to re-derive it. */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  // Defensive: a single corrupt row shouldn't turn the whole list
  // endpoint into a 500 — the Settings page shows On-prem connectors
  // even when no connectors are paired, and a red "Internal Server
  // Error" banner where an empty list belongs is worse UX than
  // silently skipping a bad row.
  try {
    const { orgId } = req.query;
    const oid = (orgId as string | undefined) || req.user?.orgId;
    const rows = (await connectorsRepo.list(oid ? { orgId: oid } : undefined))
      .map((c) => {
        try {
          return {
            id: c.id,
            orgId: c.orgId,
            name: c.name,
            status: freshnessFor(c),
            lastHeartbeatAt: c.lastHeartbeatAt,
            agentVersion: c.agentVersion,
            systemIds: c.systemIds,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            // Surface whether a pair code is still active so the UI can
            // prompt the admin to enter it on the connector side.
            pairingCodeActive: !!c.pairingCode && !!c.pairingCodeExpiresAt
              && new Date(c.pairingCodeExpiresAt).getTime() > Date.now(),
          };
        } catch (rowErr) {
          logger.warn({ err: rowErr, connectorId: c?.id }, 'Skipping malformed connector row');
          return null;
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list connectors');
    res.json({ success: true, data: [] });
  }
});

/** POST /connectors/pair/start — admin creates a connector row and
 *  receives a pairing code. Body: { name, orgId?, systemIds? }. */
router.post('/pair/start', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (!name) { res.status(400).json({ success: false, error: 'name is required' }); return; }
  const orgId = (req.body?.orgId as string | undefined) || req.user?.orgId || '';
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const code = generatePairingCode();
  const now = nowIso();
  const row: StoredConnector = {
    id: uuid(),
    orgId,
    name,
    tokenHash: null,
    pairingCode: code,
    pairingCodeExpiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    systemIds: Array.isArray(req.body?.systemIds) ? req.body.systemIds : [],
    lastHeartbeatAt: null,
    agentVersion: null,
    status: 'PAIRED',
    createdAt: now,
    updatedAt: now,
  };
  await connectorsRepo.create(row);
  auditService.log(orgId, req.user?.sub ?? null, 'Connector', row.id, 'CREATE', null, { name });
  res.status(201).json({
    success: true,
    data: { id: row.id, name: row.name, pairingCode: code, expiresAt: row.pairingCodeExpiresAt },
  });
});

/** PATCH /connectors/:id — update mutable admin fields. v1 only
 *  surfaces name + systemIds; everything else (token, freshness,
 *  agentVersion) is set by the agent or by lifecycle events. */
router.patch('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const row = await connectorsRepo.get(String(req.params.id));
  if (!row) { res.status(404).json({ success: false, error: 'connector not found' }); return; }
  const before = { name: row.name, systemIds: [...row.systemIds] };
  const patch: Partial<StoredConnector> = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    patch.name = req.body.name.trim();
  }
  if (Array.isArray(req.body?.systemIds)) {
    // Coerce to strings and de-dupe so a sloppy frontend can't
    // wedge the store with duplicate entries.
    patch.systemIds = Array.from(new Set(
      req.body.systemIds.map((s: unknown) => String(s)).filter((s: string) => s.length > 0),
    ));
  }
  patch.updatedAt = nowIso();
  await connectorsRepo.update(row.id, patch);
  auditService.log(row.orgId, req.user?.sub ?? null, 'Connector', row.id, 'UPDATE', before, {
    name: row.name, systemIds: row.systemIds,
  });
  res.json({
    success: true,
    data: { id: row.id, name: row.name, systemIds: row.systemIds, status: freshnessFor(row) },
  });
});

/** DELETE /connectors/:id — revoke a connector. Marks it REVOKED so
 *  the row sticks around for audit, but the token is dead and no
 *  further heartbeats are accepted. */
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const row = await connectorsRepo.get(String(req.params.id));
  if (!row) { res.status(404).json({ success: false, error: 'connector not found' }); return; }
  await connectorsRepo.update(row.id, {
    status: 'REVOKED',
    tokenHash: null,
    pairingCode: null,
    pairingCodeExpiresAt: null,
    updatedAt: nowIso(),
  });
  auditService.log(row.orgId, req.user?.sub ?? null, 'Connector', row.id, 'REVOKE', null, { name: row.name });
  res.json({ success: true });
});

/** GET /connectors/:id/events — recent activity for one connector.
 *  Reverse chronological, capped at 200. Drives the Activity tab on
 *  the connector detail drawer. */
router.get('/:id/events', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const events = (await connectorEventsRepo.list())
    .filter((e) => e.connectorId === req.params.id)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 200);
  res.json({ success: true, data: events });
});

// ── Connector-side: pair / heartbeat / report ────────────────────────────

/** POST /connectors/pair/claim — connector hands in its pairing code,
 *  gets back a long-lived token. The code is one-shot; subsequent
 *  claims with the same code 404. */
router.post('/pair/claim', pairClaimLimiter, pairClaimHourLimiter, async (req: Request, res: Response) => {
  const code = String(req.body?.code || '').trim();
  const agentVersion = String(req.body?.agentVersion || '').trim();
  if (!code) { res.status(400).json({ success: false, error: 'code is required' }); return; }
  const row = (await connectorsRepo.list()).find((c) => c.pairingCode === code);
  if (!row) { res.status(404).json({ success: false, error: 'pairing code not found' }); return; }
  if (!row.pairingCodeExpiresAt || new Date(row.pairingCodeExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ success: false, error: 'pairing code expired — start a new pair' });
    return;
  }
  const token = generateToken();
  await connectorsRepo.update(row.id, {
    tokenHash: hashToken(token),
    pairingCode: null,
    pairingCodeExpiresAt: null,
    agentVersion: agentVersion || null,
    lastHeartbeatAt: nowIso(),
    status: 'ONLINE',
    updatedAt: nowIso(),
  });
  await connectorEventsRepo.create({
    id: uuid(), connectorId: row.id, orgId: row.orgId,
    type: 'PAIRED', ts: nowIso(), data: { agentVersion: row.agentVersion },
  });
  auditService.log(row.orgId, null, 'Connector', row.id, 'PAIRED', null, { name: row.name });
  res.json({ success: true, data: { connectorId: row.id, token } });
});

/** POST /connectors/heartbeat — agent says "still here". Plain
 *  freshness ping; no payload required beyond the token. */
router.post('/heartbeat', requireConnectorToken, async (req: Request, res: Response) => {
  const row = (req as any).connector as StoredConnector;
  const agentVersion = String(req.body?.agentVersion || '').trim();
  const wasOffline = freshnessFor(row) === 'OFFLINE';
  const patch: Partial<StoredConnector> = {
    lastHeartbeatAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (agentVersion) patch.agentVersion = agentVersion;
  await connectorsRepo.update(row.id, patch);
  if (wasOffline) {
    // Transitioned back online — note it; the notification path
    // doesn't need a "we're back" entry but the audit log row helps
    // with forensics.
    auditService.log(row.orgId, null, 'Connector', row.id, 'BACK_ONLINE', null, { name: row.name });
  }
  res.json({ success: true });
});

/** POST /connectors/report — agent ships a metadata snapshot. v1
 *  accepts a flat list of "assets" each with `name`, optional
 *  `systemId`, `schema`, `description`, `rowCount`, `lastWriteAt`.
 *  Behaviour:
 *    - Upsert by (orgId, systemId, name): existing assets get
 *      healthScore + lastWriteAt refreshed; missing ones get
 *      created as Bronze with the reported description.
 *    - Audit-only — no destructive sync of "anything not reported".
 *      Removing an asset is still an explicit admin action.
 *  Returns the number of created vs updated rows so the connector
 *  can log it. */
router.post('/report', requireConnectorToken, async (req: Request, res: Response) => {
  const row = (req as any).connector as StoredConnector;
  const incoming = Array.isArray(req.body?.assets) ? req.body.assets : [];
  let created = 0;
  let updated = 0;
  // Snapshot the assets once; new rows are pushed back in so a later same-name
  // asset in this same batch still dedups against them (PR 7b).
  const allAssets = await dataAssetsRepo.list();
  for (const a of incoming) {
    const name = String(a?.name || '').trim();
    if (!name) continue;
    const systemId = String(a?.systemId || '').trim();
    const rowCount = typeof a?.rowCount === 'number' ? a.rowCount : null;
    const lastWriteAt = typeof a?.lastWriteAt === 'string' ? a.lastWriteAt : null;
    const existing = allAssets.find((d) => d.orgId === row.orgId && d.name === name);
    if (existing) {
      if (lastWriteAt) (existing as any).healthScoreAt = lastWriteAt;
      // Refresh a coarse health signal: 90 if recently written, 60
      // otherwise. v2 will replace this with a real freshness model
      // driven by the row count delta + writeAt delta.
      const fresh = lastWriteAt && (Date.now() - new Date(lastWriteAt).getTime()) < 24 * 60 * 60_000;
      existing.healthScore = fresh ? 90 : 60;
      existing.updatedAt = nowIso();
      // Tag the asset with the connector that owns its freshness
      // signal — surfaced as the "Synced N min ago" chip on the
      // Data Asset detail page.
      (existing as any).lastSyncedByConnectorId = row.id;
      (existing as any).lastSyncedAt = nowIso();
      await dataAssetsRepo.update(existing.id, existing);
      updated++;
    } else {
      const now = nowIso();
      const fresh = lastWriteAt && (Date.now() - new Date(lastWriteAt).getTime()) < 24 * 60 * 60_000;
      const newAsset = {
        id: uuid(), orgId: row.orgId, name,
        description: String(a?.description || ''),
        systemId: systemId || row.systemIds[0] || '',
        owner: '', stewardIds: [],
        governanceTier: 'BRONZE',
        healthScore: fresh ? 90 : 60,
        createdAt: now, updatedAt: now,
        lastSyncedByConnectorId: row.id,
        lastSyncedAt: now,
      } as any;
      await dataAssetsRepo.create(newAsset);
      allAssets.push(newAsset);
      created++;
    }
  }
  await connectorsRepo.update(row.id, { lastHeartbeatAt: nowIso(), updatedAt: nowIso() });
  await connectorEventsRepo.create({
    id: uuid(), connectorId: row.id, orgId: row.orgId,
    type: 'ASSETS_REPORTED', ts: nowIso(),
    data: { incoming: incoming.length, created, updated, rowCount: incoming.length },
  });
  res.json({ success: true, data: { created, updated, total: incoming.length } });
});

/** Internal helper used by the scheduled-offline scan (next file).
 *  Lifts the silent connectors into OFFLINE state and writes one
 *  notification per transition. Exposed so the test suite can drive
 *  it directly without waiting on a real timer. */
export async function scanForOfflineConnectors(): Promise<{ transitioned: number }> {
  let transitioned = 0;
  for (const row of await connectorsRepo.list()) {
    if (row.status === 'REVOKED') continue;
    if (!row.lastHeartbeatAt) continue;
    const live = freshnessFor(row);
    if (live === 'OFFLINE' && row.status !== 'OFFLINE') {
      row.status = 'OFFLINE';
      row.updatedAt = nowIso();
      transitioned++;
      await connectorsRepo.update(row.id, { status: 'OFFLINE', updatedAt: row.updatedAt });
      createNotification({
        orgId: row.orgId,
        type: 'WARNING',
        title: `${row.name} connector has been offline for over 4 hours`,
        message: `Last heartbeat ${row.lastHeartbeatAt}. Check the connector host and re-pair if needed.`,
        link: '/settings?tab=connectors',
      });
      logger.warn({ connectorId: row.id, name: row.name }, 'Connector marked OFFLINE');
    }
  }
  return { transitioned };
}

export default router;
