// Scheduled report delivery.
//
// A saved report can carry a schedule ({ frequency, dayOfWeek?, dayOfMonth?,
// hour?, recipients }). The scheduler's hourly sweep calls
// deliverScheduledReports(), which delivers every report whose schedule is
// *due* — i.e. the clock has passed its most recent daily/weekly/monthly fire
// moment and it hasn't already been delivered for that period. Each due report
// is run against the live catalog and its rendered rows emailed (CSV
// attachment + summary) to the recipients, reusing the shared mail sender.
// Runs are recorded in the report's run log with kind 'scheduled', and
// scheduleLastDeliveredAt is stamped so the next period gates correctly.
//
// A no-op when SMTP is unconfigured; best-effort per report so one failure
// never blocks the rest of the sweep.

import { reports, appendRun, isScheduleDue, type ReportRun } from '../routes/reports';
import { getReportsRepository } from '../db/reports.repo';
import { executeReport } from './report-engine';
import { isConfigured as isMailConfigured, sendReportEmail } from './mail.service';
import { getCachedOrgList } from '../lib/org-scope';
import logger from '../lib/logger';

const reportsRepo = getReportsRepository(reports);

type Cell = string | number | boolean | null | undefined;
function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

export async function deliverScheduledReports(): Promise<{ delivered: number; considered: number }> {
  if (!isMailConfigured()) return { delivered: 0, considered: 0 };

  const all = await reportsRepo.list();
  const orgs = getCachedOrgList();
  const now = new Date();
  let delivered = 0;
  let considered = 0;

  for (const report of all) {
    const sched = report.schedule;
    if (!sched || !isScheduleDue(sched, now, report.scheduleLastDeliveredAt)) continue;
    considered += 1;
    try {
      const result = await executeReport(report.definition, report.orgId);
      const orgName = orgs.find((o) => o.id === report.orgId)?.name || report.orgId;
      const headers = result.columns.map((c) => c.label);
      const rows = result.rows.map((row) => result.columns.map((c) => toCell(row[c.field])));
      const ok = await sendReportEmail({
        to: sched.recipients,
        reportName: report.name,
        orgName,
        headers,
        rows,
        totalMatched: result.totalMatched,
      });
      if (ok) {
        delivered += 1;
        const ranAt = new Date().toISOString();
        const run: ReportRun = { ranAt, rowCount: result.totalMatched, byUserId: null, kind: 'scheduled' };
        // Stamp scheduleLastDeliveredAt alongside the run so the next sweep
        // gates this report until its following fire moment.
        try { await reportsRepo.update(report.id, { ...appendRun(report, run), scheduleLastDeliveredAt: ranAt }); }
        catch { /* run history is non-critical */ }
      }
    } catch (err) {
      logger.error({ err, reportId: report.id }, 'Scheduled report delivery failed');
    }
  }

  if (considered > 0) logger.info({ delivered, considered }, 'Scheduled report sweep complete');
  return { delivered, considered };
}
