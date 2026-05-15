// ──────────────────────────────────────────────────────────────────────────
// Unified export dispatcher.
//
// Every export surface in Procela funnels through `exportData` so we can
// add formats without touching call sites. Today: CSV, XLSX, JSON, and
// clipboard (TSV). PDF is intentionally deferred — it has real layout
// decisions (branding, page header, orientation) that deserve their
// own pass.
//
// Heavy formatters (xlsx) are dynamic-imported so the ~400 KB SheetJS
// bundle only loads when the user actually opens the export menu.
// Without that, every page-load pays for a format that 95% of sessions
// won't touch.
//
// All formatters accept the same shape:
//   { filenameBase, headers, rows, sheetName? }
// Cells may be string | number | boolean | null | undefined. `null` and
// `undefined` render as empty in every format so call sites don't have
// to defensively coerce.
// ──────────────────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'pdf' | 'clipboard';

export type Cell = string | number | boolean | null | undefined;

export interface ExportPayload {
  /** Filename without extension. The format adds its own. */
  filenameBase: string;
  headers: string[];
  rows: Cell[][];
  /** Sheet name for XLSX. Defaults to "Data". Truncated/sanitised
   *  inside the formatter — Excel caps at 31 chars and forbids `:\/?*[]`. */
  sheetName?: string;
}

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV (.csv)',
  xlsx: 'Excel (.xlsx)',
  json: 'JSON (.json)',
  pdf: 'PDF (print)',
  clipboard: 'Copy to clipboard',
};

export async function exportData(format: ExportFormat, payload: ExportPayload): Promise<void> {
  switch (format) {
    case 'csv':       return exportCsvImpl(payload);
    case 'xlsx':      return exportXlsxImpl(payload);
    case 'json':      return exportJsonImpl(payload);
    case 'pdf':       return exportPdfImpl(payload);
    case 'clipboard': return exportClipboardImpl(payload);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function cellToString(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'boolean') return c ? 'true' : 'false';
  return String(c);
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV ────────────────────────────────────────────────────────────────────
// RFC-4180-ish: wrap every cell in double quotes, escape inner quotes by
// doubling, separate rows with CRLF (Excel-friendly).

function exportCsvImpl({ filenameBase, headers, rows }: ExportPayload): void {
  const escape = (c: Cell): string => `"${cellToString(c).replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  const csv = lines.join('\r\n');
  download(`${filenameBase}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

// ── XLSX ───────────────────────────────────────────────────────────────────
// Dynamic-imported so the heavy SheetJS bundle is only paid for on demand.

function sanitiseSheetName(raw: string | undefined): string {
  const name = (raw || 'Data').replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  return name.length > 0 ? name : 'Data';
}

async function exportXlsxImpl({ filenameBase, headers, rows, sheetName }: ExportPayload): Promise<void> {
  const XLSX = await import('xlsx');
  const aoa: Cell[][] = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitiseSheetName(sheetName));
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  download(
    `${filenameBase}.xlsx`,
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
}

// ── JSON ───────────────────────────────────────────────────────────────────
// Array of objects keyed by header name — friendlier for re-import and
// for piping into the AI assistant than an array-of-arrays would be.

function exportJsonImpl({ filenameBase, headers, rows }: ExportPayload): void {
  const objects = rows.map((row) => {
    const obj: Record<string, Cell> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? null; });
    return obj;
  });
  const json = JSON.stringify(objects, null, 2);
  download(`${filenameBase}.json`, new Blob([json], { type: 'application/json' }));
}

// ── PDF (browser print) ───────────────────────────────────────────────────
// No PDF library bundled — we open a print-styled window with the table
// rendered as HTML and let the user pick "Save as PDF" from the system
// print dialog. Works in every modern browser and keeps the JS bundle
// lean. Trade-off: requires a user click (browsers block print from
// async handlers if there's no user gesture, which the menu click
// satisfies).

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[ch]);
}

function exportPdfImpl({ filenameBase, headers, rows, sheetName }: ExportPayload): void {
  const title = sheetName || filenameBase;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    throw new Error('Popup blocked — allow popups for this site to export PDF.');
  }
  const styles = `
    @page { size: A4 landscape; margin: 14mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { font-size: 11px; color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 6px 10px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    thead th { background: #f1f5f9; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print { body { padding: 0; } }
  `;
  const body = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${escapeHtml(filenameBase)} &middot; ${rows.length} row${rows.length === 1 ? '' : 's'} &middot; generated ${new Date().toLocaleString()}</div>
    <table>
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(cellToString(c))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${body}</body></html>`);
  win.document.close();
  // Give the new window a tick to lay out before invoking print.
  win.addEventListener('load', () => {
    win.focus();
    win.print();
  });
  // Some browsers fire 'load' synchronously for document.write windows;
  // belt-and-suspenders: also try print after a short timeout.
  setTimeout(() => { try { win.print(); } catch { /* */ } }, 250);
}

// ── Clipboard (TSV) ────────────────────────────────────────────────────────
// Tab-separated so Excel/Sheets/Numbers paste it as a real table. Cells
// containing tabs or newlines get spaces — pragmatic, since round-tripping
// those characters through a clipboard paste is unreliable anyway.

async function exportClipboardImpl({ headers, rows }: ExportPayload): Promise<void> {
  const safe = (c: Cell): string => cellToString(c).replace(/[\t\r\n]+/g, ' ');
  const tsv = [headers.map(safe).join('\t'), ...rows.map((r) => r.map(safe).join('\t'))].join('\n');
  await navigator.clipboard.writeText(tsv);
}
