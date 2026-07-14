import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import logger from '../lib/logger';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: object | null;
  after: object | null;
  timestamp: string;
  /** SHA-256 hash of the previous entry's entryHash + this entry's
   *  content. First entry's prevHash is the empty string. Lets a
   *  verifier walk the chain and detect any tampering (a single
   *  byte changed inside an old entry invalidates every entryHash
   *  after it). Legacy entries written before this field was added
   *  carry undefined; the verifier treats those as a known break in
   *  the chain rather than a failure. */
  prevHash?: string;
  entryHash?: string;
}

// Persistent audit log (replace with Prisma when DB is connected)
export const auditLogs: AuditLogEntry[] = loadStore<AuditLogEntry>('auditLogs');
registerStore('auditLogs', auditLogs);

// One-time bootstrap: when the hash-chain code first lands, every
// previously-written entry lacks prevHash / entryHash. The verifier
// treats missing hashes as a chain break, so without this pass the
// log would report broken until enough new entries push the legacy
// ones out. Walk the existing log on startup, compute hashes
// deterministically from the content already there, and write them
// back.
//
// Two knobs make the trust boundary explicit rather than implicit:
//
//   1. In production, refuse to auto-bootstrap unless the operator
//      opts in with AUDIT_ALLOW_BOOTSTRAP=1. The default fails
//      fast — if entries lack hashes at prod boot, either the
//      chain was legitimately reset (operator sets the flag) or
//      something's wrong (operator investigates). Silently
//      re-hashing pre-chain entries lets a tampered row look
//      legitimate to the verifier.
//
//   2. When bootstrap does run and mutates the log, we also
//      append a AUDIT_CHAIN_BOOTSTRAPPED marker entry so a future
//      audit reviewer can point to a definitive "trusted chain
//      begins here" boundary rather than guessing.
//
// Cheap (single sequential pass), idempotent (entries that
// already have a hash are left alone — they get rehashed only if a
// later edit breaks the chain).
export interface BootstrapOptions {
  /** When true, mimic production semantics — throw if the log has
   *  un-hashed entries and `allowBootstrap` is false. Defaults to
   *  the process's NODE_ENV so the module-init call does the right
   *  thing without extra plumbing. */
  isProduction?: boolean;
  /** Explicit opt-in from the operator (env AUDIT_ALLOW_BOOTSTRAP=1
   *  by default). Required in production. */
  allowBootstrap?: boolean;
  /** Timestamp for the marker entry — accepts an override so tests
   *  can produce stable output. */
  now?: string;
}

export interface BootstrapResult {
  /** Whether any entries were re-hashed. false → the chain was
   *  already intact and no marker was appended. */
  mutated: boolean;
  /** Index of the first entry that needed a re-hash. -1 when no
   *  mutation happened. */
  firstBootstrappedIndex: number;
  /** The marker entry that was appended (or null when nothing
   *  mutated). Caller is responsible for persisting the mutated
   *  entries + marker via saveStore. */
  marker: AuditLogEntry | null;
}

/**
 * Pure bootstrap function — walks an entries array, re-computes
 * missing / broken hashes, and appends a chain-boundary marker.
 * Mutates the array in place (matches how the top-level IIFE
 * treated the auditLogs export) but does NOT touch disk — callers
 * decide when to persist. Extracted so tests can drive the
 * behaviour without racing the shared .procela-data/auditLogs.json
 * file that parallel test workers use.
 */
export function bootstrapHashChain(entries: AuditLogEntry[], opts: BootstrapOptions = {}): BootstrapResult {
  let prev = '';
  let mutated = false;
  let firstBootstrappedIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.entryHash && e.prevHash !== undefined && e.prevHash === prev) {
      prev = e.entryHash;
      continue;
    }
    if (firstBootstrappedIndex === -1) firstBootstrappedIndex = i;
    e.prevHash = prev;
    e.entryHash = computeEntryHashStandalone(prev, e);
    prev = e.entryHash;
    mutated = true;
  }
  if (!mutated) return { mutated: false, firstBootstrappedIndex: -1, marker: null };
  const isProduction = opts.isProduction ?? (process.env.NODE_ENV === 'production');
  const allowBootstrap = opts.allowBootstrap ?? (process.env.AUDIT_ALLOW_BOOTSTRAP === '1');
  if (isProduction && !allowBootstrap) {
    const msg = `Audit chain has ${entries.length - firstBootstrappedIndex} un-hashed / broken entries starting at index ${firstBootstrappedIndex}. Refusing to auto-bootstrap in production. Set AUDIT_ALLOW_BOOTSTRAP=1 after investigating to acknowledge the boundary.`;
    throw new Error(msg);
  }
  const markerTs = opts.now ?? new Date().toISOString();
  const marker: AuditLogEntry = {
    id: `bootstrap-${markerTs}`,
    orgId: 'system',
    userId: null,
    entityType: 'Audit',
    entityId: 'chain',
    action: 'AUDIT_CHAIN_BOOTSTRAPPED',
    before: null,
    after: {
      firstBootstrappedIndex,
      bootstrappedCount: entries.length - firstBootstrappedIndex,
      totalEntriesAtBootstrap: entries.length,
      note: 'Entries before this marker were re-hashed at boot; treat as trusted from this point forward.',
    },
    timestamp: markerTs,
    prevHash: prev,
    entryHash: '',
  };
  marker.entryHash = computeEntryHashStandalone(prev, marker);
  entries.push(marker);
  return { mutated: true, firstBootstrappedIndex, marker };
}

(function runBootstrapAtBoot() {
  try {
    const result = bootstrapHashChain(auditLogs);
    if (!result.mutated) return;
    saveStore('auditLogs', auditLogs);
    logger.warn({
      firstBootstrappedIndex: result.firstBootstrappedIndex,
      bootstrappedCount: auditLogs.length - 1 - result.firstBootstrappedIndex,
      markerId: result.marker!.id,
    }, 'Audit log hash chain bootstrapped — chain marker appended');
  } catch (err) {
    logger.error({ err }, 'Audit log hash chain bootstrap refused; aborting startup.');
    throw err;
  }
})();

// Standalone variant of computeEntryHash that takes the entry
// directly. Used by the bootstrap pass since `computeEntryHash` is
// hoisted below as a function declaration but the standalone variant
// avoids reaching across module-scope state.
function computeEntryHashStandalone(prev: string, e: AuditLogEntry): string {
  const ordered = {
    id: e.id,
    orgId: e.orgId,
    userId: e.userId,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    before: e.before,
    after: e.after,
    timestamp: e.timestamp,
  };
  return createHash('sha256').update(prev + JSON.stringify(ordered)).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────
// Hash chain — each entry's entryHash binds the previous entry's
// entryHash to the current entry's content. Compute it deterministically
// so verification can re-run the same fingerprint and detect any
// tampering between log time and verify time. SHA-256 because every
// platform ships it and we don't need anything fancier — this is
// integrity, not confidentiality.
// ──────────────────────────────────────────────────────────────────────────

function fingerprintContent(e: Omit<AuditLogEntry, 'prevHash' | 'entryHash'>): string {
  // Stable, key-ordered JSON so verification produces the same hash
  // regardless of how the entry was serialised on disk.
  const ordered = {
    id: e.id,
    orgId: e.orgId,
    userId: e.userId,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    before: e.before,
    after: e.after,
    timestamp: e.timestamp,
  };
  return JSON.stringify(ordered);
}

function computeEntryHash(prevHash: string, e: Omit<AuditLogEntry, 'prevHash' | 'entryHash'>): string {
  return createHash('sha256').update(prevHash + fingerprintContent(e)).digest('hex');
}

/** Tail hash — the entryHash of the most recent entry. New entries
 *  link to this; callers can also use it as a "log was at state X"
 *  receipt. */
function getTailHash(): string {
  for (let i = auditLogs.length - 1; i >= 0; i--) {
    const h = auditLogs[i].entryHash;
    if (h) return h;
  }
  return '';
}

export const auditService = {
  log(
    orgId: string,
    userId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    before: object | null = null,
    after: object | null = null
  ): void {
    const base = {
      id: uuid(),
      orgId,
      userId,
      entityType,
      entityId,
      action,
      before,
      after,
      timestamp: new Date().toISOString(),
    };
    const prevHash = getTailHash();
    const entry: AuditLogEntry = {
      ...base,
      prevHash,
      entryHash: computeEntryHash(prevHash, base),
    };
    auditLogs.push(entry);
    saveStore('auditLogs', auditLogs);
    logger.info({ entityType, entityId, action }, `[Audit] ${action} ${entityType}`);
  },

  getAll(orgId?: string): AuditLogEntry[] {
    return orgId ? auditLogs.filter((l) => l.orgId === orgId) : auditLogs;
  },

  getByEntity(entityType: string, entityId: string): AuditLogEntry[] {
    return auditLogs.filter((l) => l.entityType === entityType && l.entityId === entityId);
  },

  /** Walk the chain and report any breaks. A break is either
   *    - an entry whose recomputed entryHash doesn't match the stored
   *      one (content tampered)
   *    - an entry whose prevHash doesn't match the previous entry's
   *      entryHash (an entry was inserted, deleted, or reordered)
   *  Returns { valid, brokenAt, total } where brokenAt is the index
   *  of the first bad entry (or -1 when clean). Legacy entries
   *  without entryHash break the chain at their position by design
   *  — once you see one, every count after is suspect. */
  verifyChain(): { valid: boolean; brokenAt: number; total: number; reason?: string } {
    let expectedPrev = '';
    for (let i = 0; i < auditLogs.length; i++) {
      const e = auditLogs[i];
      if (!e.entryHash) {
        return { valid: false, brokenAt: i, total: auditLogs.length, reason: 'entry missing hash (legacy or stripped)' };
      }
      if ((e.prevHash || '') !== expectedPrev) {
        return { valid: false, brokenAt: i, total: auditLogs.length, reason: 'prevHash does not match previous entry' };
      }
      const recomputed = computeEntryHash(expectedPrev, {
        id: e.id, orgId: e.orgId, userId: e.userId,
        entityType: e.entityType, entityId: e.entityId, action: e.action,
        before: e.before, after: e.after, timestamp: e.timestamp,
      });
      if (recomputed !== e.entryHash) {
        return { valid: false, brokenAt: i, total: auditLogs.length, reason: 'recomputed entryHash mismatch — content tampered' };
      }
      expectedPrev = e.entryHash;
    }
    return { valid: true, brokenAt: -1, total: auditLogs.length };
  },

  /** Tombstone audit entries authored by a specific person. Replaces
   *  the userId field with the literal '[deleted]' string and removes
   *  any PII (email, name) from before / after payloads. Used by the
   *  GDPR cascade — we don't delete audit entries (that would erase
   *  the action history other regulators care about) but we strip
   *  the personal identifier. Re-chains the hashes from the first
   *  modified entry onward so the chain stays verifiable. */
  redactPerson(personId: string): number {
    let firstModifiedIdx = -1;
    for (let i = 0; i < auditLogs.length; i++) {
      const e = auditLogs[i];
      let changed = false;
      if (e.userId === personId) { e.userId = '[deleted]'; changed = true; }
      const scrub = (obj: object | null): object | null => {
        if (!obj || typeof obj !== 'object') return obj;
        const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
        for (const k of ['email', 'name', 'targetEmail', 'targetPersonId', 'idpSub']) {
          if (clone[k] !== undefined) { clone[k] = '[redacted]'; changed = true; }
        }
        return clone;
      };
      e.before = scrub(e.before);
      e.after = scrub(e.after);
      if (changed && firstModifiedIdx === -1) firstModifiedIdx = i;
    }
    if (firstModifiedIdx === -1) return 0;
    // Rebuild the hash chain from firstModifiedIdx onwards so the
    // verifier still passes against the redacted log. Entries before
    // that point are untouched.
    let prev = firstModifiedIdx > 0 ? (auditLogs[firstModifiedIdx - 1].entryHash || '') : '';
    let rehashed = 0;
    for (let i = firstModifiedIdx; i < auditLogs.length; i++) {
      const e = auditLogs[i];
      e.prevHash = prev;
      e.entryHash = computeEntryHash(prev, {
        id: e.id, orgId: e.orgId, userId: e.userId,
        entityType: e.entityType, entityId: e.entityId, action: e.action,
        before: e.before, after: e.after, timestamp: e.timestamp,
      });
      prev = e.entryHash;
      rehashed++;
    }
    saveStore('auditLogs', auditLogs);
    return rehashed;
  },
};
