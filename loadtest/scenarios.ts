// Load-test scenarios for the Procela API.
//
// Each scenario names one representative GET endpoint and the
// performance budget it must hold under load. The harness in run.ts
// drives each with autocannon and fails the run if the measured p99
// latency exceeds `maxP99Ms`, throughput drops below `minReqPerSec`,
// or any non-2xx response comes back.
//
// The list deliberately mixes cheap reads (the most-clicked list
// pages) with the heavy aggregations (dashboard stats, control-tower,
// gap detection, enterprise view) — those fan out across the whole
// catalog in memory and are where a throughput regression would bite
// first. AI / chat endpoints are excluded by default: they are paid
// per call and their latency is the model's, not ours (see README).
//
// Budgets are intentionally generous defaults for a single-node dev
// box on the JSON persistence path. Tighten them per environment once
// you have a baseline from a representative deploy — the point of the
// harness is to catch a *regression* against a known-good number, not
// to assert an absolute SLA out of the box.

export interface Scenario {
  /** Short id, shown in the report and usable as a filter (LOADTEST_ONLY). */
  name: string;
  /** Path under the API base (e.g. '/organizations'). */
  path: string;
  /** HTTP method. Only GET scenarios ship by default — writes would
   *  mutate persistence and skew a repeated run. */
  method: 'GET';
  /** Does the endpoint sit behind authenticateToken? */
  auth: boolean;
  /** Rough category, for grouping in the printed table. */
  kind: 'baseline' | 'list' | 'aggregate';
  /** Fail the run if measured p99 latency exceeds this (ms). */
  maxP99Ms: number;
  /** Fail the run if sustained throughput drops below this (req/s). */
  minReqPerSec: number;
}

export const SCENARIOS: Scenario[] = [
  // Baseline — unauthenticated, no business logic. Establishes the
  // floor: how fast the process answers at all. A regression here is
  // the event loop or middleware, not a query.
  { name: 'health', path: '/health', method: 'GET', auth: false, kind: 'baseline', maxP99Ms: 50, minReqPerSec: 800 },

  // List endpoints — the most-clicked read pages. Each returns an
  // org-scoped collection.
  { name: 'organizations', path: '/organizations', method: 'GET', auth: true, kind: 'list', maxP99Ms: 150, minReqPerSec: 300 },
  { name: 'people', path: '/people', method: 'GET', auth: true, kind: 'list', maxP99Ms: 150, minReqPerSec: 300 },
  { name: 'systems', path: '/systems', method: 'GET', auth: true, kind: 'list', maxP99Ms: 150, minReqPerSec: 300 },
  { name: 'data-assets', path: '/data-assets', method: 'GET', auth: true, kind: 'list', maxP99Ms: 150, minReqPerSec: 300 },
  { name: 'process-catalog', path: '/process-catalog', method: 'GET', auth: true, kind: 'list', maxP99Ms: 200, minReqPerSec: 200 },

  // Aggregations — fan out across the catalog. Heavier per request, so
  // the budgets are looser. These are the endpoints most likely to
  // regress when the catalog grows.
  { name: 'dashboard-stats', path: '/dashboard/stats', method: 'GET', auth: true, kind: 'aggregate', maxP99Ms: 400, minReqPerSec: 100 },
  { name: 'control-tower', path: '/control-tower/summary', method: 'GET', auth: true, kind: 'aggregate', maxP99Ms: 400, minReqPerSec: 100 },
  { name: 'gap-detection', path: '/gap-detection', method: 'GET', auth: true, kind: 'aggregate', maxP99Ms: 400, minReqPerSec: 100 },
  { name: 'enterprise-view', path: '/enterprise-view', method: 'GET', auth: true, kind: 'aggregate', maxP99Ms: 400, minReqPerSec: 100 },
];
