import fs from 'fs';
import path from 'path';
import logger from '../lib/logger';
import { reloadAllStores } from '../lib/persistence';
import { auditService } from './audit.service';

// ──────────────────────────────────────────────────────────────────────────
// gdpr.service — implements the cascade behind the "right to be
// forgotten" admin action. When a person is GDPR-erased we don't just
// delete their Person record; we also have to sever every reference
// to them across the rest of the data model. Ownership rights, group
// memberships, authored comments, governance assignments all carry
// the personId we're trying to scrub.
//
// Strategy: walk every JSON store under .procela-data/, apply a
// generic redaction pass that recognises the standard reference
// fields (ownerId, stewardId, stewardIds, authorId, assigneeId,
// personId, createdBy, updatedBy, mentions), and rewrite the file.
// Audit log entries get tombstoned via auditService.redactPerson()
// so the action history survives but the personal identifier doesn't.
//
// Generic on purpose. Route modules carry their own in-memory arrays
// that load from JSON on boot; if we import them here we (a) introduce
// circular deps and (b) miss any store added later. Sweeping the
// filesystem catches every store including future ones. The trade-off
// is that an active server keeps the in-memory copy of the scrubbed
// store, so this should be paired with a server restart in production
// — or the route modules need to re-load on demand.
// ──────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');

const SINGLE_REF_FIELDS = new Set([
  'ownerId', 'stewardId', 'authorId', 'assigneeId',
  'personId', 'createdBy', 'updatedBy', 'userId',
  'dataOwnerId', 'businessOwnerId', 'technicalOwnerId',
  'reporterId', 'modifiedBy',
]);

const MULTI_REF_FIELDS = new Set([
  'stewardIds', 'memberIds', 'ownerIds', 'assigneeIds',
  'mentions', 'mentionedPersonIds', 'watchers', 'watcherIds',
]);

function scrubValue(node: unknown, personId: string): { value: unknown; changed: boolean } {
  if (node === null || node === undefined) return { value: node, changed: false };
  if (Array.isArray(node)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of node) {
      if (typeof item === 'string' && item === personId) {
        changed = true;
        // Drop the bare personId — typical for memberIds / stewardIds.
        continue;
      }
      const r = scrubValue(item, personId);
      if (r.changed) changed = true;
      out.push(r.value);
    }
    return { value: out, changed };
  }
  if (typeof node === 'object') {
    let changed = false;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SINGLE_REF_FIELDS.has(k) && v === personId) {
        out[k] = null;
        changed = true;
        continue;
      }
      if (MULTI_REF_FIELDS.has(k) && Array.isArray(v)) {
        const filtered = (v as unknown[]).filter((x) => x !== personId);
        if (filtered.length !== v.length) changed = true;
        out[k] = filtered;
        continue;
      }
      // The id field itself is the person record — caller handles that.
      if (k === 'id' && v === personId) {
        out[k] = v; // leave alone; caller decides whether to filter the row
        continue;
      }
      const r = scrubValue(v, personId);
      if (r.changed) changed = true;
      out[k] = r.value;
    }
    return { value: out, changed };
  }
  return { value: node, changed: false };
}

interface CascadeReport {
  storesScanned: number;
  storesModified: number;
  rowsRemoved: number;
  rowsModified: number;
  auditEntriesRedacted: number;
  /** Names of in-memory stores that picked up the on-disk changes via
   *  the reload registry. A store that holds personId references but
   *  hasn't been registered will still be scrubbed on disk; it just
   *  won't see the new content until the next process restart. */
  storesReloaded: string[];
}

/** Run the full right-to-be-forgotten cascade for the given personId.
 *  Caller is responsible for deleting the Person record from the
 *  people store — this function handles every other store. */
export function erasePersonReferences(personId: string): CascadeReport {
  const report: CascadeReport = {
    storesScanned: 0, storesModified: 0, rowsRemoved: 0, rowsModified: 0,
    auditEntriesRedacted: 0, storesReloaded: [],
  };
  if (!fs.existsSync(DATA_DIR)) return report;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const storeName = file.replace(/\.json$/, '');
    // The audit log gets a different treatment (tombstone in place,
    // re-chain) so the integrity verifier still passes. Same for the
    // people store — the caller handles row removal there.
    if (storeName === 'auditLogs') continue;
    if (storeName === 'people') continue;

    report.storesScanned++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const rows = parsed as Array<Record<string, unknown>>;

    let storeChanged = false;
    const next: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      // Author-owned rows (comments authored by this person, etc) are
      // dropped wholesale when their identity field IS the person:
      // an authored comment IS personal data, not just a reference.
      if (row.authorId === personId) {
        report.rowsRemoved++;
        storeChanged = true;
        continue;
      }
      const r = scrubValue(row, personId);
      if (r.changed) {
        report.rowsModified++;
        storeChanged = true;
      }
      next.push(r.value as Record<string, unknown>);
    }
    if (storeChanged) {
      fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(next, null, 2));
      report.storesModified++;
    }
  }

  report.auditEntriesRedacted = auditService.redactPerson(personId);
  // After the disk writes settle, splice the in-memory arrays in
  // every registered store back in line with the file content. Stores
  // that didn't opt in to the registry still see the on-disk scrub,
  // they just need a restart to flush their cached copies — the
  // CascadeReport names the ones that did refresh so an admin can
  // tell at a glance.
  report.storesReloaded = reloadAllStores();
  logger.info({ personId, report }, 'GDPR cascade complete');
  return report;
}
