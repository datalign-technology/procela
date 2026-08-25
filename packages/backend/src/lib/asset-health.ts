// Health/liveness heuristic for connector-discovered data assets.
//
// A scan reports two signals per table: how recently it was written
// (`lastWriteAt`) and its row count. This turns those into a coarse 0–100
// health score. It is a Bronze, audit-only stand-in — a real health/DQ
// score comes from source-system metrics later — but it grades freshness
// instead of the old binary "90 if written in the last day, else 60", and
// it treats an empty table as a genuine liveness concern.
//
// Pure and deterministic (time is injected) so it is unit-testable.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DiscoveredAssetHealthInput {
  /** ISO timestamp of the table's most recent write, if the scan reported one. */
  lastWriteAt?: string | null;
  /** Row count from this scan, if reported. */
  rowCount?: number | null;
  /** Row count recorded by the previous scan, if any (activity signal). */
  previousRowCount?: number | null;
  /** Injected clock for testability; defaults to now. */
  nowMs?: number;
}

/**
 * Grade a discovered asset's freshness into a 0–100 health score.
 *
 * Freshness decays by age since the last write; an empty table is capped
 * low regardless of write time; and a row count that changed since the last
 * scan earns a small "actively maintained" bump.
 */
export function computeDiscoveredAssetHealth(input: DiscoveredAssetHealthInput): number {
  const now = input.nowMs ?? Date.now();

  // ── Freshness: graded decay by age since the last write ──
  let score: number;
  const writeMs = input.lastWriteAt ? new Date(input.lastWriteAt).getTime() : NaN;
  if (!Number.isFinite(writeMs)) {
    // No freshness signal reported (older agent, or a source without a
    // write-time column) — stay neutral rather than punishing or rewarding.
    score = 50;
  } else {
    const ageDays = Math.max(0, (now - writeMs) / DAY_MS);
    if (ageDays < 1) score = 95;
    else if (ageDays < 7) score = 85;
    else if (ageDays < 30) score = 70;
    else if (ageDays < 90) score = 55;
    else score = 40;
  }

  // ── Row-count signals ──
  const rowCount = typeof input.rowCount === 'number' ? input.rowCount : null;
  if (rowCount === 0) {
    // An empty table is a liveness concern no matter how recently it was
    // touched — cap the score low.
    score = Math.min(score, 35);
  } else if (
    rowCount !== null &&
    typeof input.previousRowCount === 'number' &&
    rowCount !== input.previousRowCount
  ) {
    // Row count moved since the last scan → the table is actively changing.
    score = Math.min(100, score + 5);
  }

  return Math.round(score);
}
