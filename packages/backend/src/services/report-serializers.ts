// Report serializers — turn a rendered report (headers + rows + a little
// metadata) into a delivery artifact in one of several formats. Used by the
// scheduled-report email sweep so a report can be delivered as a CSV, Excel,
// or PDF attachment, or embedded straight into the email body as an HTML table.
//
// Every serializer takes the same plain (headers, rows) shape the report
// engine produces. Cells may be string | number | boolean | null | undefined;
// null/undefined render empty everywhere. Keeping these pure and transport-free
// means the mail service just picks a format and attaches/embeds the result,
// and the unit tests exercise the formatting without SMTP.

import PDFDocument from 'pdfkit';
import path from 'node:path';
import * as XLSX from 'xlsx';

export type ReportFormat = 'csv' | 'xlsx' | 'pdf' | 'html';
export type Cell = string | number | boolean | null | undefined;

/** The delivery formats that attach a file. 'html' is the odd one out — it
 *  embeds the table in the email body instead of attaching anything. */
export const ATTACHMENT_FORMATS: readonly ReportFormat[] = ['csv', 'xlsx', 'pdf'] as const;

export function isReportFormat(v: unknown): v is ReportFormat {
  return v === 'csv' || v === 'xlsx' || v === 'pdf' || v === 'html';
}

/** Human labels for the format, mirrored on the frontend picker. */
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  csv: 'CSV (.csv)',
  xlsx: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
  html: 'HTML table in the email body',
};

function cellToString(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'boolean') return c ? 'true' : 'false';
  return String(c);
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// RFC-4180-ish: every cell double-quoted, inner quotes doubled, CRLF rows
// (Excel-friendly). This is the format the scheduled sweep used inline before
// serializers existed; lifting it here keeps the byte-for-byte output.

export function toCsv(headers: string[], rows: Cell[][]): string {
  const escape = (c: Cell): string => `"${cellToString(c).replace(/"/g, '""')}"`;
  return [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ].join('\r\n');
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
// SheetJS array-of-arrays → a single-sheet workbook. Numbers and booleans keep
// their native cell type so Excel treats them as values, not text.

/** Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]. */
function sanitiseSheetName(raw: string | undefined): string {
  const name = (raw || 'Report').replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  return name.length > 0 ? name : 'Report';
}

export function toXlsx(headers: string[], rows: Cell[][], sheetName?: string): Buffer {
  const aoa: Cell[][] = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitiseSheetName(sheetName));
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

// ── HTML (email body) ────────────────────────────────────────────────────────
// A self-contained table with inline styles — email clients strip <style>
// blocks and external CSS, so every rule lives on the element. Returned as a
// fragment the mail template drops into the message body.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toHtmlTable(headers: string[], rows: Cell[][]): string {
  const th = headers
    .map((h) => `<th style="padding:6px 10px;border:1px solid #e2e8f0;background:#f1f5f9;text-align:left;font-weight:600;">${escapeHtml(h)}</th>`)
    .join('');
  const trs = rows
    .map((r, i) => {
      const bg = i % 2 === 1 ? 'background:#fafafa;' : '';
      const tds = r
        .map((c) => `<td style="padding:6px 10px;border:1px solid #e2e8f0;${bg}">${escapeHtml(cellToString(c))}</td>`)
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-size:13px;color:#0f172a;">`
    + `<thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ── PDF ──────────────────────────────────────────────────────────────────────
// A focused, single-purpose table PDF built on PDFKit (Chromium-free, same
// dependency the docs exporter already uses). Landscape Letter so wide reports
// fit; a brand band names the org + report, then a paginated table with a
// repeating header row, then a footer line. Reuses the embedded TTF fonts the
// docs PDF registers so cells with Unicode render correctly.

const BRAND_PRIMARY = '#0f4f46';
const BRAND_INK = '#0f172a';
const COLOR_MUTED = '#64748b';
const COLOR_BORDER = '#e2e8f0';
const ROW_STRIPE = '#f8fafc';

const FONT_REGULAR = 'ProcelaSans';
const FONT_BOLD = 'ProcelaSans-Bold';
const FONTS_DIR = path.resolve(__dirname, '..', 'docs', 'fonts');
const FONT_FILES: Record<string, string> = {
  [FONT_REGULAR]: path.join(FONTS_DIR, 'LiberationSans-Regular.ttf'),
  [FONT_BOLD]: path.join(FONTS_DIR, 'LiberationSans-Bold.ttf'),
};
const ICON_PATH = path.resolve(__dirname, '..', 'docs', 'procela-icon.png');

const PDF_MARGIN = 40;
const PDF_SIZE = 9;
const CELL_PAD = 6;

export interface ReportPdfMeta {
  reportName: string;
  orgName: string;
  totalMatched: number;
  generatedAt?: Date;
}

export async function toReportPdf(headers: string[], rows: Cell[][], meta: ReportPdfMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        layout: 'landscape',
        margins: { top: PDF_MARGIN, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN },
        info: { Title: meta.reportName, Author: 'Procela' },
        bufferPages: true,
      });
      for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, file);

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawReportPdf(doc, headers, rows, meta);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawReportPdf(doc: PDFKit.PDFDocument, headers: string[], rows: Cell[][], meta: ReportPdfMeta): void {
  const left = PDF_MARGIN;
  const pageRight = doc.page.width - PDF_MARGIN;
  const totalWidth = pageRight - left;
  const generated = (meta.generatedAt || new Date()).toLocaleString();
  const capped = meta.totalMatched > rows.length;

  // Brand band: icon + org + report name.
  try { doc.image(ICON_PATH, left, PDF_MARGIN, { width: 20 }); } catch { /* icon optional */ }
  doc.font(FONT_BOLD).fontSize(15).fillColor(BRAND_INK)
    .text(meta.reportName, left + 28, PDF_MARGIN, { width: totalWidth - 28, lineBreak: false });
  doc.font(FONT_REGULAR).fontSize(9).fillColor(COLOR_MUTED)
    .text(
      `${meta.orgName} · ${rows.length} row${rows.length === 1 ? '' : 's'}${capped ? ` (of ${meta.totalMatched} matched — capped)` : ''} · generated ${generated}`,
      left + 28, PDF_MARGIN + 20, { width: totalWidth - 28, lineBreak: false },
    );
  doc.moveTo(left, PDF_MARGIN + 36).lineTo(pageRight, PDF_MARGIN + 36).strokeColor(BRAND_PRIMARY).lineWidth(1.5).stroke();

  const colWidth = totalWidth / Math.max(headers.length, 1);
  const bodyTop = PDF_MARGIN + 48;
  const bottomLimit = doc.page.height - PDF_MARGIN;

  const drawHeaderRow = (y: number): number => {
    doc.font(FONT_BOLD).fontSize(PDF_SIZE).fillColor('#fff');
    let h = 0;
    headers.forEach((head) => {
      h = Math.max(h, doc.heightOfString(head, { width: colWidth - CELL_PAD * 2 }));
    });
    const rowH = h + CELL_PAD * 2;
    doc.rect(left, y, totalWidth, rowH).fill(BRAND_PRIMARY);
    headers.forEach((head, i) => {
      doc.fillColor('#fff').text(head, left + i * colWidth + CELL_PAD, y + CELL_PAD, { width: colWidth - CELL_PAD * 2 });
    });
    return y + rowH;
  };

  let y = drawHeaderRow(bodyTop);
  doc.font(FONT_REGULAR).fontSize(PDF_SIZE);
  rows.forEach((row, rowIdx) => {
    let rowH = 0;
    const cells = row.map(cellToString);
    cells.forEach((c) => { rowH = Math.max(rowH, doc.heightOfString(c, { width: colWidth - CELL_PAD * 2 })); });
    const cellH = rowH + CELL_PAD * 2;
    if (y + cellH > bottomLimit) {
      doc.addPage();
      y = drawHeaderRow(PDF_MARGIN);
      doc.font(FONT_REGULAR).fontSize(PDF_SIZE);
    }
    if (rowIdx % 2 === 1) doc.rect(left, y, totalWidth, cellH).fill(ROW_STRIPE);
    doc.strokeColor(COLOR_BORDER).lineWidth(0.4).rect(left, y, totalWidth, cellH).stroke();
    cells.forEach((c, i) => {
      doc.fillColor(BRAND_INK).text(c, left + i * colWidth + CELL_PAD, y + CELL_PAD, { width: colWidth - CELL_PAD * 2 });
    });
    y += cellH;
  });

  // Footer provenance on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(FONT_REGULAR).fontSize(8).fillColor(COLOR_MUTED)
      .text(
        `Procela · ${meta.reportName} · page ${i + 1} of ${range.count}`,
        left, doc.page.height - PDF_MARGIN + 6,
        { width: totalWidth, align: 'center', lineBreak: false },
      );
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export interface SerializedReport {
  /** File to attach, for the attachment formats (csv/xlsx/pdf). */
  attachment?: { filename: string; content: Buffer | string; contentType: string };
  /** HTML fragment to embed in the email body, for the 'html' format. */
  inlineHtml?: string;
}

/** Slugify a report name into a filename base. */
export function filenameBase(reportName: string): string {
  return (reportName || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

export async function serializeReport(
  format: ReportFormat,
  headers: string[],
  rows: Cell[][],
  meta: ReportPdfMeta,
): Promise<SerializedReport> {
  const base = filenameBase(meta.reportName);
  switch (format) {
    case 'xlsx':
      return { attachment: {
        filename: `${base}.xlsx`,
        content: toXlsx(headers, rows, meta.reportName),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } };
    case 'pdf':
      return { attachment: {
        filename: `${base}.pdf`,
        content: await toReportPdf(headers, rows, meta),
        contentType: 'application/pdf',
      } };
    case 'html':
      return { inlineHtml: toHtmlTable(headers, rows) };
    case 'csv':
    default:
      return { attachment: {
        filename: `${base}.csv`,
        content: toCsv(headers, rows),
        contentType: 'text/csv; charset=utf-8',
      } };
  }
}
