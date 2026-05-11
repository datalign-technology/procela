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

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'clipboard';

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
  clipboard: 'Copy to clipboard',
};

export async function exportData(format: ExportFormat, payload: ExportPayload): Promise<void> {
  switch (format) {
    case 'csv':       return exportCsvImpl(payload);
    case 'xlsx':      return exportXlsxImpl(payload);
    case 'json':      return exportJsonImpl(payload);
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

// ── Clipboard (TSV) ────────────────────────────────────────────────────────
// Tab-separated so Excel/Sheets/Numbers paste it as a real table. Cells
// containing tabs or newlines get spaces — pragmatic, since round-tripping
// those characters through a clipboard paste is unreliable anyway.

async function exportClipboardImpl({ headers, rows }: ExportPayload): Promise<void> {
  const safe = (c: Cell): string => cellToString(c).replace(/[\t\r\n]+/g, ' ');
  const tsv = [headers.map(safe).join('\t'), ...rows.map((r) => r.map(safe).join('\t'))].join('\n');
  await navigator.clipboard.writeText(tsv);
}
