import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads');

export function getUploadsDir(connectionId: string): string {
  return path.join(UPLOADS_ROOT, connectionId);
}

/**
 * Remove the entire upload directory for a connection, if it exists.
 * No-ops silently if the directory doesn't exist.
 */
export function deleteLocalFileDir(connectionId: string): void {
  const dir = getUploadsDir(connectionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface FileAnalysis {
  rowCount: number;
  columns: string[];
}

/**
 * Analyze an uploaded local data file and return row count + column names.
 *
 * Supported:
 *   .csv, .tsv  — delimited text with a header row
 *   .json       — either an array-of-objects or { data: [...] } shape
 *   .jsonl / .ndjson — newline-delimited JSON objects
 *
 * Throws on unsupported extensions or parse errors so the caller can surface
 * the message to the user.
 */
export function analyzeLocalFile(absPath: string): FileAnalysis {
  const ext = path.extname(absPath).toLowerCase();
  const buf = fs.readFileSync(absPath);
  const text = buf.toString('utf-8');

  switch (ext) {
    case '.csv':
      return analyzeDelimited(text, ',');
    case '.tsv':
      return analyzeDelimited(text, '\t');
    case '.jsonl':
    case '.ndjson':
      return analyzeJsonLines(text);
    case '.json':
      return analyzeJson(text);
    default:
      throw new Error(`Unsupported file type: ${ext || '(no extension)'}. Expected .csv, .tsv, .json, .jsonl, or .ndjson.`);
  }
}

// ── Parsers ──

function analyzeDelimited(text: string, delimiter: string): FileAnalysis {
  // Strip BOM if present; split on any newline style.
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error('File is empty');
  }
  const columns = splitDelimitedRow(lines[0], delimiter).map((c) => c.trim());
  if (columns.length === 0 || columns.every((c) => c === '')) {
    throw new Error('No columns detected in header row');
  }
  return { rowCount: Math.max(lines.length - 1, 0), columns };
}

// Minimal CSV/TSV splitter that respects double-quoted fields. Good enough for
// header extraction; full RFC 4180 quoting nuances aren't necessary here.
function splitDelimitedRow(row: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { out.push(current); current = ''; }
      else current += ch;
    }
  }
  out.push(current);
  return out;
}

function analyzeJson(text: string): FileAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Accept either a bare array of objects or { data: [...] }.
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).data))
      ? (parsed as any).data
      : null;
  if (!rows) {
    throw new Error('Expected a JSON array or an object with a "data" array');
  }
  return buildJsonAnalysis(rows);
}

function analyzeJsonLines(text: string): FileAnalysis {
  const rows: any[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    try {
      rows.push(JSON.parse(lines[i]));
    } catch (err) {
      throw new Error(`Invalid JSON on line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return buildJsonAnalysis(rows);
}

function buildJsonAnalysis(rows: any[]): FileAnalysis {
  if (rows.length === 0) {
    return { rowCount: 0, columns: [] };
  }
  // Union the keys across the first handful of objects so we don't miss
  // columns that appear only on later rows.
  const sample = rows.slice(0, 50);
  const columnSet = new Set<string>();
  for (const row of sample) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const k of Object.keys(row)) columnSet.add(k);
    }
  }
  return { rowCount: rows.length, columns: Array.from(columnSet) };
}
