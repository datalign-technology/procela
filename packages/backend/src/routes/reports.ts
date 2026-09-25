import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import { executeReport, validateDefinition, type ReportDefinition } from '../services/report-engine';
import { getReportsRepository } from '../db/reports.repo';
import { ensurePublicFolder, reportFoldersRepo, type StoredReportFolder } from './report-folders';

// ──────────────────────────────────────────────────────────────────────────
// Reports — user-defined report definitions backed by the LDM.
//
// Each report stores a ReportDefinition (the spec a user built in the
// Report Builder UI). The report-engine service runs the spec against
// the live entity stores and returns rendered rows.
//
// Lifecycle:
//   POST   /reports          → create
//   GET    /reports?orgId=…  → list (org-scoped)
//   GET    /reports/:id      → read one
//   PUT    /reports/:id      → update name / definition / visibility
//   DELETE /reports/:id      → delete
//   POST   /reports/:id/run  → execute and return rows
//   POST   /reports/preview  → execute a draft definition without saving
// ──────────────────────────────────────────────────────────────────────────

/** One recorded execution of a report. Kept in a bounded runLog on the
 *  report so the catalog can show "last run" without a separate table. */
export interface ReportRun {
  ranAt: string;
  rowCount: number;
  /** The user who ran it, or null for a scheduled (system) run. */
  byUserId: string | null;
  kind: 'manual' | 'scheduled';
}

/** How often a scheduled report is delivered. 'off' keeps the recipient list
 *  but pauses delivery. */
export type ScheduleFrequency = 'off' | 'daily' | 'weekly' | 'monthly';

/** Optional scheduled delivery for a saved report. Day/hour are stored in UTC.
 *  Legacy schedules (weekly with no dayOfWeek/hour) fall back to the historical
 *  Sunday-23:00 boundary via the defaults below. */
/** Delivery format for a scheduled report. csv/xlsx/pdf attach a file; html
 *  embeds the table in the email body. Kept in sync with the serializer's
 *  ReportFormat (report-serializers.ts). */
export type ReportDeliveryFormat = 'csv' | 'xlsx' | 'pdf' | 'html';

export interface ReportSchedule {
  frequency: ScheduleFrequency;
  /** Day of week for a weekly schedule: 0 = Sunday … 6 = Saturday. */
  dayOfWeek?: number;
  /** Day of month for a monthly schedule, 1–28 (clamped so it exists every
   *  month, February included). */
  dayOfMonth?: number;
  /** UTC hour of day to send at, 0–23. */
  hour?: number;
  /** Output format for the delivered report. Defaults to csv. */
  format?: ReportDeliveryFormat;
  /** Email addresses the rendered report is delivered to on each run. */
  recipients: string[];
}

/** Defaults applied when a schedule omits the day/hour fields — chosen to
 *  reproduce the historical "Sunday night" weekly delivery for schedules
 *  saved before day/time control existed. */
export const DEFAULT_SCHEDULE_HOUR = 23;   // 23:00 UTC
export const DEFAULT_SCHEDULE_DOW = 0;     // Sunday
export const DEFAULT_SCHEDULE_DOM = 1;     // 1st of the month

/** How many runs to retain per report — enough to show recent history in
 *  the catalog without unbounded growth on a frequently-run report. */
export const RUN_LOG_LIMIT = 10;

export interface StoredReport {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;
  /** Organizing folder. null = uncategorized ("My Reports"), private to the
   *  owner. A report in a shared folder (the Public folder, or a user folder
   *  toggled shared) is org-visible — its `visibility` is kept in sync. */
  folderId?: string | null;
  /** 'private' = only the owner sees it; 'org' = visible to anyone with
   *  access to the org. Derived from the report's folder (shared ⇒ 'org'). */
  visibility: 'private' | 'org';
  definition: ReportDefinition;
  /** Denormalised timestamp of the most recent run, for cheap list sorting. */
  lastRunAt?: string | null;
  /** Recent executions, newest first, capped at RUN_LOG_LIMIT. */
  runLog?: ReportRun[];
  /** Scheduled delivery config, absent when the report isn't scheduled. */
  schedule?: ReportSchedule | null;
  /** Timestamp of the most recent *scheduled* delivery, used to gate the next
   *  one so a report is delivered once per period. Set only by the delivery
   *  sweep; the user-editable schedule config never touches it. */
  scheduleLastDeliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Append a run to a report's bounded log and return the patch to persist
 *  (newest-first, capped, with the denormalised lastRunAt refreshed). */
export function appendRun(report: StoredReport, run: ReportRun): Partial<StoredReport> {
  const runLog = [run, ...(report.runLog || [])].slice(0, RUN_LOG_LIMIT);
  return { runLog, lastRunAt: run.ranAt };
}

/** Clamp an arbitrary value to an integer in [min, max], falling back to a
 *  default when it isn't a finite number. */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce an arbitrary schedule payload to the stored shape (drops junk,
 *  clamps frequency + day/hour, keeps only string recipients). The active
 *  frequency's day/hour fields are always populated so the stored schedule is
 *  self-describing and round-trips through the builder. Returns null to clear. */
export function normalizeSchedule(input: unknown): ReportSchedule | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as { frequency?: unknown; dayOfWeek?: unknown; dayOfMonth?: unknown; hour?: unknown; format?: unknown; recipients?: unknown };
  const frequency: ScheduleFrequency =
    s.frequency === 'daily' || s.frequency === 'weekly' || s.frequency === 'monthly' ? s.frequency : 'off';
  const recipients = Array.isArray(s.recipients)
    ? s.recipients.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim())
    : [];
  if (frequency === 'off' && recipients.length === 0) return null;
  const format: ReportDeliveryFormat =
    s.format === 'xlsx' || s.format === 'pdf' || s.format === 'html' ? s.format : 'csv';
  const out: ReportSchedule = { frequency, recipients };
  if (frequency === 'weekly')  out.dayOfWeek  = clampInt(s.dayOfWeek,  0, 6,  DEFAULT_SCHEDULE_DOW);
  if (frequency === 'monthly') out.dayOfMonth = clampInt(s.dayOfMonth, 1, 28, DEFAULT_SCHEDULE_DOM);
  if (frequency !== 'off')    { out.hour = clampInt(s.hour, 0, 23, DEFAULT_SCHEDULE_HOUR); out.format = format; }
  return out;
}

/** The most recent UTC instant at which a schedule should have fired, at or
 *  before `now`. Pure over the schedule + clock so it's unit-testable. */
export function mostRecentFireMoment(schedule: ReportSchedule, now: Date): Date {
  const hour = schedule.hour ?? DEFAULT_SCHEDULE_HOUR;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (schedule.frequency === 'monthly') {
    const dom = schedule.dayOfMonth ?? DEFAULT_SCHEDULE_DOM;
    const fire = new Date(Date.UTC(y, m, dom, hour, 0, 0, 0));
    if (fire.getTime() > now.getTime()) fire.setUTCMonth(fire.getUTCMonth() - 1);
    return fire;
  }
  if (schedule.frequency === 'weekly') {
    const dow = schedule.dayOfWeek ?? DEFAULT_SCHEDULE_DOW;
    const fire = new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
    const back = (fire.getUTCDay() - dow + 7) % 7;
    fire.setUTCDate(fire.getUTCDate() - back);
    if (fire.getTime() > now.getTime()) fire.setUTCDate(fire.getUTCDate() - 7);
    return fire;
  }
  // daily (and any other non-off value defensively)
  const fire = new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
  if (fire.getTime() > now.getTime()) fire.setUTCDate(fire.getUTCDate() - 1);
  return fire;
}

/** Whether a scheduled report is due to be delivered at `now`, given when it
 *  was last delivered. Due when the clock has passed the schedule's most recent
 *  fire moment and no delivery has happened since that moment — so delivery
 *  fires exactly once per period regardless of how often the sweep ticks. */
export function isScheduleDue(
  schedule: ReportSchedule | null | undefined,
  now: Date,
  lastDeliveredAt: string | null | undefined,
): boolean {
  if (!schedule || schedule.frequency === 'off' || schedule.recipients.length === 0) return false;
  const fire = mostRecentFireMoment(schedule, now);
  if (now.getTime() < fire.getTime()) return false;
  if (!lastDeliveredAt) return true;
  return new Date(lastDeliveredAt).getTime() < fire.getTime();
}

export const reports: StoredReport[] = loadStore<StoredReport>('reports');
registerStore('reports', reports);

const reportsRepo = getReportsRepository(reports);

// ── Folder-derived sharing ──────────────────────────────────────────────────
// A report's audience comes from its folder: a report in a shared folder (the
// Public folder, or a user folder toggled shared) is org-visible; anything else
// — including a report whose folderId points at a deleted folder — is private
// to its owner. `visibility` is derived from this at read time, so it stays
// correct even when a folder's shared flag or existence changes.

const callerId = (req: Request): string | null => (req as { user?: { sub?: string } }).user?.sub || null;
const callerIsAdmin = (req: Request): boolean => {
  const role = (req as { user?: { role?: string } }).user?.role;
  return role === 'SUPER_ADMIN' || role === 'ORG_ADMIN';
};

async function folderMap(orgId: string): Promise<Map<string, StoredReportFolder>> {
  const folders = await reportFoldersRepo.list({ orgId });
  return new Map(folders.map((f) => [f.id, f]));
}
function reportIsShared(report: StoredReport, folders: Map<string, StoredReportFolder>): boolean {
  if (!report.folderId) return false;
  const f = folders.get(report.folderId);
  return !!(f && f.shared);
}
/** Whether `uid` (admin?) may see a report given the current folder map. */
function canSee(report: StoredReport, uid: string | null, admin: boolean, folders: Map<string, StoredReportFolder>): boolean {
  return reportIsShared(report, folders) || admin || (!!uid && report.ownerId === uid);
}

const router = Router();

/** GET /api/v1/reports?orgId=… — reports in the org the caller may see: those
 *  in a shared folder, plus their own private ones (admins see all). */
router.get('/', async (req: Request, res: Response) => {
  const orgId = String(req.query.orgId || '');
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const pub = await ensurePublicFolder(orgId);
  const all = await reportsRepo.list({ orgId });
  // One-time backfill: a legacy org-visible report predating folders (no
  // folderId) lands in Public so it stays shared under the new model. Private
  // legacy reports keep folderId null (uncategorized ⇒ still owner-only).
  for (const r of all) {
    if (!r.folderId && r.visibility === 'org') {
      await reportsRepo.update(r.id, { folderId: pub.id });
      r.folderId = pub.id;
    }
  }
  const folders = await folderMap(orgId);
  const uid = callerId(req);
  const admin = callerIsAdmin(req);
  const data = all
    .filter((r) => canSee(r, uid, admin, folders))
    .map((r) => stripDefinitionForList({ ...r, visibility: reportIsShared(r, folders) ? 'org' : 'private' }));
  res.json({ success: true, data });
});

/** GET /api/v1/reports/:id — one report, full definition included. A private
 *  report the caller can't see returns 404 (no existence disclosure). */
router.get('/:id', async (req: Request, res: Response) => {
  const report = await reportsRepo.get(String(req.params.id));
  if (!report) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  const folders = await folderMap(report.orgId);
  if (!canSee(report, callerId(req), callerIsAdmin(req), folders)) {
    res.status(404).json({ success: false, error: 'Report not found' }); return;
  }
  res.json({ success: true, data: { ...report, visibility: reportIsShared(report, folders) ? 'org' : 'private' } });
});

/** Resolve the target folder for a report from an explicit folderId, or (for
 *  the legacy visibility-only create/update) the Public folder when
 *  visibility==='org'. Returns { folderId, visibility } or an error string. */
async function resolveFolder(
  orgId: string,
  folderId: unknown,
  legacyVisibility: unknown,
): Promise<{ folderId: string | null; visibility: 'private' | 'org' } | { error: string }> {
  // Explicit null ⇒ move to uncategorized ("My Reports"), owner-only.
  if (folderId === null) return { folderId: null, visibility: 'private' };
  // A folder id ⇒ audience is that folder's shared flag.
  if (folderId !== undefined) {
    const folder = await reportFoldersRepo.get(String(folderId));
    if (!folder || folder.orgId !== orgId) return { error: 'Folder not found in this org' };
    return { folderId: folder.id, visibility: folder.shared ? 'org' : 'private' };
  }
  // No folderId at all ⇒ fall back to the legacy visibility flag. Explicit
  // 'private' ⇒ uncategorized; anything else (including the historical default)
  // ⇒ the shared Public folder, so behaviour matches the pre-folders path.
  if (legacyVisibility === 'private') return { folderId: null, visibility: 'private' };
  const pub = await ensurePublicFolder(orgId);
  return { folderId: pub.id, visibility: 'org' };
}

/** POST /api/v1/reports — create. Body: { orgId, name, description?,
 *  ownerId?, folderId?, visibility?, definition }. */
router.post('/', async (req: Request, res: Response) => {
  const { orgId, name, description, ownerId, folderId, visibility, definition } = req.body || {};
  if (!orgId)     { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!name)      { res.status(400).json({ success: false, error: 'name is required' }); return; }
  if (!definition){ res.status(400).json({ success: false, error: 'definition is required' }); return; }

  const validation = validateDefinition(definition);
  if (validation.length > 0) {
    res.status(400).json({ success: false, error: 'Invalid report definition', details: validation });
    return;
  }

  const resolved = await resolveFolder(orgId, folderId, visibility);
  if ('error' in resolved) { res.status(400).json({ success: false, error: resolved.error }); return; }

  const now = new Date().toISOString();
  const report: StoredReport = {
    id: uuid(),
    orgId,
    name,
    description: description || '',
    ownerId: ownerId || null,
    folderId: resolved.folderId,
    visibility: resolved.visibility,
    definition,
    schedule: normalizeSchedule(req.body?.schedule),
    createdAt: now,
    updatedAt: now,
  };
  await reportsRepo.create(report);
  res.status(201).json({ success: true, data: report });
});

/** PUT /api/v1/reports/:id — update. */
router.put('/:id', async (req: Request, res: Response) => {
  const report = await reportsRepo.get(String(req.params.id));
  if (!report) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  // Owner-scoped: a report (including a shared 'org'-visibility one) may only
  // be edited by the person who owns it — or by an org/super admin, who
  // curates the shared catalog (e.g. filing another user's shared report into
  // a folder). Any-authenticated at the router level, so this per-record check
  // is what stops one non-admin user editing another's report.
  const editorId = (req as { user?: { sub?: string } }).user?.sub || null;
  if (report.ownerId && editorId && report.ownerId !== editorId && !callerIsAdmin(req)) {
    res.status(403).json({ success: false, error: 'Only the owner or an admin can modify this report' });
    return;
  }
  const { name, description, ownerId, folderId, visibility, definition } = req.body || {};
  const patch: Partial<StoredReport> = {};
  if (definition !== undefined) {
    const validation = validateDefinition(definition);
    if (validation.length > 0) {
      res.status(400).json({ success: false, error: 'Invalid report definition', details: validation });
      return;
    }
    patch.definition = definition;
  }
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (ownerId !== undefined) patch.ownerId = ownerId;
  // Moving folders (or the legacy visibility flag) re-derives the audience.
  // folderId absent + visibility present ⇒ the legacy path handles it.
  if (folderId !== undefined || visibility !== undefined) {
    const resolved = await resolveFolder(report.orgId, folderId, visibility);
    if ('error' in resolved) { res.status(400).json({ success: false, error: resolved.error }); return; }
    patch.folderId = resolved.folderId;
    patch.visibility = resolved.visibility;
  }
  if (req.body?.schedule !== undefined) patch.schedule = normalizeSchedule(req.body.schedule);
  patch.updatedAt = new Date().toISOString();
  const updated = await reportsRepo.update(report.id, patch);
  res.json({ success: true, data: updated });
});

/** DELETE /api/v1/reports/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const report = await reportsRepo.get(String(req.params.id));
  if (!report) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  const editorId = (req as { user?: { sub?: string } }).user?.sub || null;
  if (report.ownerId && editorId && report.ownerId !== editorId && !callerIsAdmin(req)) {
    res.status(403).json({ success: false, error: 'Only the owner or an admin can delete this report' });
    return;
  }
  await reportsRepo.delete(report.id);
  res.status(204).send();
});

/** POST /api/v1/reports/:id/run — execute, record the run, and return rows. */
router.post('/:id/run', async (req: Request, res: Response) => {
  const report = await reportsRepo.get(String(req.params.id));
  if (!report) { res.status(404).json({ success: false, error: 'Report not found' }); return; }
  try {
    const result = await executeReport(report.definition, report.orgId);
    const byUserId = (req as { user?: { sub?: string } }).user?.sub || null;
    const run: ReportRun = { ranAt: new Date().toISOString(), rowCount: result.totalMatched, byUserId, kind: 'manual' };
    // Best-effort run-history write — a persistence hiccup shouldn't fail the
    // run the user asked for; they still get their rows back.
    try { await reportsRepo.update(report.id, appendRun(report, run)); }
    catch { /* run history is non-critical */ }
    res.json({ success: true, data: { ...result, run } });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Execution failed' });
  }
});

/** POST /api/v1/reports/preview — execute a draft definition without
 *  saving it. Body: { orgId, definition }. Powers the Builder UI's
 *  live preview pane. */
router.post('/preview', async (req: Request, res: Response) => {
  const { orgId, definition } = req.body || {};
  if (!orgId)      { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  if (!definition) { res.status(400).json({ success: false, error: 'definition is required' }); return; }
  try {
    const result = await executeReport(definition, orgId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Execution failed' });
  }
});

/** List view doesn't need the full definition — only the metadata for
 *  the catalog page. Keeps the response small for big report
 *  collections. */
function stripDefinitionForList(r: StoredReport) {
  const runLog = r.runLog || [];
  return {
    id: r.id, orgId: r.orgId, name: r.name, description: r.description,
    ownerId: r.ownerId, folderId: r.folderId ?? null, visibility: r.visibility,
    primaryEntity: r.definition.entity,
    columnCount: r.definition.columns.length,
    // Run-history + schedule summary for the catalog list (full runLog stays
    // on the detail read).
    lastRunAt: r.lastRunAt ?? null,
    lastRunRowCount: runLog[0]?.rowCount ?? null,
    runCount: runLog.length,
    scheduleFrequency: r.schedule?.frequency ?? 'off',
    scheduleFormat: r.schedule?.format ?? 'csv',
    scheduleRecipientCount: r.schedule?.recipients?.length ?? 0,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export default router;
