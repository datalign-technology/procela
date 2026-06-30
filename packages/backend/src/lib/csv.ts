// Small RFC-4180-ish CSV parser. Replaces the naive
// `csv.trim().split('\n').map(l => l.split(','))` pattern that
// every import route was using, which silently broke any CSV the
// app's own ExportMenu emitted (the exporter wraps every cell in
// double quotes for Excel compatibility, and the naive parser
// then carried those quotes into the header lookup so a column
// like "Name" never matched the case-folded literal `name`).
//
// What this handles:
//   * Cells wrapped in double quotes — quotes are stripped.
//   * The "" escape inside a quoted cell -> a single literal ".
//   * Commas inside quoted cells (no longer split on).
//   * CRLF, LF, or CR line endings.
//   * Newlines inside quoted cells (multi-line values).
//   * Trailing blank line (common with Excel saves).
//
// Returns an array of rows, each row an array of cells. Cells
// are NOT trimmed of internal whitespace — only the surrounding
// quotes, if any, are removed. Callers that want case-folded
// header keys should still .toLowerCase() the header row
// themselves.

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  // Strip a UTF-8 BOM if present — some Excel exports lead with one
  // and it would otherwise show up as the first character of the
  // first header.
  if (input.charCodeAt(0) === 0xFEFF) i = 1;

  while (i < len) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote inside a quoted cell -> literal ".
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        // Single quote ends the quoted section. Anything after,
        // up to the next delimiter, will be treated as plain text
        // (defensive — RFC-4180 says nothing should follow, but
        // some sloppy exporters emit `"foo"bar`).
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    // Not in quotes.
    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      // Skip the \n in a CRLF pair so we don't emit an empty row.
      if (ch === '\r' && input[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // Flush the trailing cell + row if the input didn't end on a
  // newline.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop trailing all-empty rows (Excel often leaves one behind).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
    rows.pop();
  }

  return rows;
}

/** Emit an RFC-4180-ish CSV string. Every cell is double-quoted so
 *  embedded commas / newlines / quotes don't escape the layout, and
 *  every literal `"` inside a cell is doubled per the spec. Lines are
 *  CRLF-terminated because Excel still defaults to CRLF parsing on
 *  Windows — both LF and CRLF parsers handle CRLF fine.
 *
 *  Headers go on the first row, then each input row in order. Cells
 *  are coerced via String(); null/undefined become ''. Numbers and
 *  booleans render naturally. Dates should be ISO strings on the
 *  caller side — we don't .toISOString() here because the caller
 *  often wants a specific TZ or trimmed precision. */
export function emitCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const escape = (val: unknown): string => {
    const s = val === null || val === undefined ? '' : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines: string[] = [];
  lines.push(headers.map(escape).join(','));
  for (const row of rows) lines.push(row.map(escape).join(','));
  return lines.join('\r\n') + '\r\n';
}
