import PDFDocument from 'pdfkit';

/**
 * markdown-to-pdf — Renders the subset of markdown used by our in-app
 * docs (TRAINING.md, HELP.md) into a paginated PDF document.
 *
 * Built on PDFKit so the backend has no Chromium dependency. The
 * dialect mirrors what `lib/markdown.tsx` already renders on the
 * frontend so the print and on-screen versions stay close:
 *
 *   - ATX headings (# .. ######)
 *   - Paragraphs (blank-line separated)
 *   - Bullet + ordered lists (one level of nesting)
 *   - GitHub-flavoured tables
 *   - Fenced code blocks (``` ... ```)
 *   - Blockquotes  (> ...)
 *   - Horizontal rules (---)
 *   - Inline: **bold**, *italic*, `code`, [text](url)
 *
 * Returns a Buffer ready to be streamed back to the client. Caller is
 * responsible for the HTTP headers.
 */

export interface RenderOptions {
  title: string;
  subtitle?: string;
  /** Footer text rendered on every page (e.g. document name + date). */
  footer?: string;
}

export async function renderMarkdownToPdf(markdown: string, opts: RenderOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: { Title: opts.title, Subject: opts.subtitle },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawDocument(doc, markdown, opts);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Layout constants ────────────────────────────────────────────────────

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';
const FONT_MONO = 'Courier';

const SIZE_BODY = 11;
const SIZE_CODE = 9.5;
const SIZE_H1 = 24;
const SIZE_H2 = 18;
const SIZE_H3 = 14;
const SIZE_H4 = 12;

const COLOR_TEXT = '#111';
const COLOR_MUTED = '#666';
const COLOR_LINK = '#1d4ed8';
const COLOR_BORDER = '#ddd';
const COLOR_CODE_BG = '#f3f4f6';
const COLOR_QUOTE_BORDER = '#999';

// ── Document driver ────────────────────────────────────────────────────

function drawDocument(doc: PDFKit.PDFDocument, markdown: string, opts: RenderOptions) {
  // Cover-style title block at the top of page 1.
  doc.font(FONT_BOLD).fontSize(SIZE_H1).fillColor(COLOR_TEXT).text(opts.title);
  if (opts.subtitle) {
    doc.moveDown(0.3);
    doc.font(FONT_REGULAR).fontSize(SIZE_BODY + 1).fillColor(COLOR_MUTED).text(opts.subtitle);
  }
  doc.moveDown(1.2);
  doc.fillColor(COLOR_TEXT);

  const blocks = parseBlocks(markdown.replace(/\r\n/g, '\n').split('\n'));
  for (const block of blocks) {
    drawBlock(doc, block);
  }

  // Per-page footer with page number, drawn last over every page.
  if (opts.footer) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font(FONT_REGULAR).fontSize(8).fillColor(COLOR_MUTED).text(
        `${opts.footer}  ·  Page ${i + 1} of ${range.count}`,
        72, doc.page.height - 48,
        { align: 'center', width: doc.page.width - 144 },
      );
    }
  }
}

// ── Block parsing (same dialect as the frontend renderer) ──────────────

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'hr' }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

interface ListItem {
  text: string;
  children?: ListItem[];
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++; continue;
    }

    if (/^\s*([-*])\s*\1\s*\1[\s-*]*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++; continue;
    }

    const fence = /^```/.exec(line);
    if (fence) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++;
      out.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', lines: buf });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-:|]*-[\s\-:|]*$/.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push({ kind: 'table', header, rows });
      continue;
    }

    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ListItem[] = [];
      let currentParent: ListItem | null = null;
      while (i < lines.length && (/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim() === '') { i++; continue; }
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])!;
        const indent = m[1].length;
        const text = m[3];
        if (indent >= 2 && currentParent) {
          currentParent.children = currentParent.children || [];
          currentParent.children.push({ text });
        } else {
          const item: ListItem = { text };
          items.push(item);
          currentParent = item;
        }
        i++;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }

    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push({ kind: 'paragraph', text: buf.join(' ') });
  }
  return out;
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line)
    || /^```/.test(line)
    || /^>\s?/.test(line)
    || /^(\s*)([-*]|\d+\.)\s+/.test(line)
    || /^\s*([-*])\s*\1\s*\1/.test(line)
  );
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// ── Block drawing ──────────────────────────────────────────────────────

function drawBlock(doc: PDFKit.PDFDocument, block: Block) {
  switch (block.kind) {
    case 'heading': return drawHeading(doc, block.level, block.text);
    case 'paragraph': return drawParagraph(doc, block.text);
    case 'hr': return drawHr(doc);
    case 'code': return drawCode(doc, block.text);
    case 'quote': return drawQuote(doc, block.lines);
    case 'list': return drawList(doc, block.items, block.ordered);
    case 'table': return drawTable(doc, block.header, block.rows);
  }
}

function drawHeading(doc: PDFKit.PDFDocument, level: number, text: string) {
  const sizes: Record<number, number> = { 1: SIZE_H1, 2: SIZE_H2, 3: SIZE_H3, 4: SIZE_H4, 5: 11, 6: 10 };
  const space: Record<number, number> = { 1: 1.4, 2: 1.2, 3: 1.0, 4: 0.8, 5: 0.6, 6: 0.5 };
  doc.moveDown(space[level] || 0.8);
  doc.font(FONT_BOLD).fontSize(sizes[level] || 12).fillColor(COLOR_TEXT);
  doc.text(text);
  doc.moveDown(0.4);
}

function drawParagraph(doc: PDFKit.PDFDocument, text: string) {
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(COLOR_TEXT);
  drawInline(doc, text, { lineGap: 2 });
  doc.moveDown(0.5);
}

function drawHr(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.5);
  const y = doc.y;
  doc.strokeColor(COLOR_BORDER).lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.moveDown(0.7);
}

function drawCode(doc: PDFKit.PDFDocument, text: string) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const startY = doc.y;
  doc.font(FONT_MONO).fontSize(SIZE_CODE).fillColor(COLOR_TEXT);
  // Background swatch: measure first, then draw a rectangle behind.
  const height = doc.heightOfString(text, { width: width - 16, lineGap: 1 });
  doc.rect(left, startY, width, height + 12).fill(COLOR_CODE_BG);
  doc.fillColor(COLOR_TEXT)
    .text(text, left + 8, startY + 6, { width: width - 16, lineGap: 1 });
  doc.moveDown(0.6);
}

function drawQuote(doc: PDFKit.PDFDocument, lines: string[]) {
  const left = doc.page.margins.left;
  const startY = doc.y;
  doc.font(FONT_ITALIC).fontSize(SIZE_BODY).fillColor(COLOR_MUTED);
  // Draw text first to know height, then bar.
  const text = lines.join(' ');
  const indent = 14;
  const beforeY = doc.y;
  doc.text(text, left + indent, beforeY, {
    width: doc.page.width - left - doc.page.margins.right - indent, lineGap: 2,
  });
  const endY = doc.y;
  doc.strokeColor(COLOR_QUOTE_BORDER).lineWidth(2)
    .moveTo(left + 2, startY)
    .lineTo(left + 2, endY)
    .stroke();
  doc.fillColor(COLOR_TEXT);
  doc.moveDown(0.5);
}

function drawList(doc: PDFKit.PDFDocument, items: ListItem[], ordered: boolean) {
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(COLOR_TEXT);
  const left = doc.page.margins.left;
  const indent = 16;
  items.forEach((item, idx) => {
    const bullet = ordered ? `${idx + 1}.` : '•';
    const bulletWidth = 18;
    const startY = doc.y;
    doc.text(bullet, left, startY, { width: bulletWidth });
    doc.y = startY;
    const x = left + bulletWidth;
    doc.x = x;
    drawInline(doc, item.text, {
      lineGap: 2,
      width: doc.page.width - x - doc.page.margins.right,
    });
    doc.x = left;
    if (item.children && item.children.length > 0) {
      doc.moveDown(0.1);
      item.children.forEach((child) => {
        const cy = doc.y;
        doc.text('◦', left + indent, cy, { width: bulletWidth });
        doc.y = cy;
        const cx = left + indent + bulletWidth;
        doc.x = cx;
        drawInline(doc, child.text, {
          lineGap: 2,
          width: doc.page.width - cx - doc.page.margins.right,
        });
        doc.x = left;
      });
    }
  });
  doc.moveDown(0.5);
}

function drawTable(doc: PDFKit.PDFDocument, header: string[], rows: string[][]) {
  const left = doc.page.margins.left;
  const totalWidth = doc.page.width - left - doc.page.margins.right;
  const colWidth = totalWidth / Math.max(header.length, 1);
  const headerStartY = doc.y;
  const padding = 6;

  // Header.
  doc.font(FONT_BOLD).fontSize(SIZE_BODY - 1).fillColor(COLOR_TEXT);
  let headerHeight = 0;
  header.forEach((h, i) => {
    const cellHeight = doc.heightOfString(h, { width: colWidth - padding * 2 });
    headerHeight = Math.max(headerHeight, cellHeight);
  });
  doc.rect(left, headerStartY, totalWidth, headerHeight + padding * 2).fillAndStroke('#f5f5f5', COLOR_BORDER);
  doc.fillColor(COLOR_TEXT);
  header.forEach((h, i) => {
    doc.text(h, left + i * colWidth + padding, headerStartY + padding, {
      width: colWidth - padding * 2,
    });
  });
  let y = headerStartY + headerHeight + padding * 2;

  // Body.
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY - 1);
  rows.forEach((row) => {
    let rowHeight = 0;
    row.forEach((cell, i) => {
      const h = doc.heightOfString(cell, { width: colWidth - padding * 2 });
      rowHeight = Math.max(rowHeight, h);
    });
    // Page break if we'd overflow.
    if (y + rowHeight + padding * 2 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.strokeColor(COLOR_BORDER).lineWidth(0.5)
      .rect(left, y, totalWidth, rowHeight + padding * 2).stroke();
    row.forEach((cell, i) => {
      doc.text(cell, left + i * colWidth + padding, y + padding, {
        width: colWidth - padding * 2,
      });
    });
    y += rowHeight + padding * 2;
  });
  doc.y = y;
  doc.moveDown(0.6);
}

// ── Inline rendering ───────────────────────────────────────────────────

interface InlineOpts {
  lineGap?: number;
  width?: number;
}

/** Walk inline text and emit runs into the PDF, switching font / colour
 *  per emphasis style. Links render in blue with an underline and a
 *  PDFKit `link` annotation so clicking actually works. */
function drawInline(doc: PDFKit.PDFDocument, text: string, opts: InlineOpts = {}) {
  const runs = parseInline(text);
  const baseFont = FONT_REGULAR;
  const baseSize = SIZE_BODY;
  const width = opts.width;
  // PDFKit's text() with `continued: true` lets us emit multiple style
  // runs that flow into one wrapped paragraph.
  runs.forEach((run, i) => {
    const last = i === runs.length - 1;
    const continued = !last;
    if (run.kind === 'code') {
      doc.font(FONT_MONO).fontSize(SIZE_CODE).fillColor(COLOR_TEXT);
    } else if (run.kind === 'bold') {
      doc.font(FONT_BOLD).fontSize(baseSize).fillColor(COLOR_TEXT);
    } else if (run.kind === 'italic') {
      doc.font(FONT_ITALIC).fontSize(baseSize).fillColor(COLOR_TEXT);
    } else if (run.kind === 'link') {
      doc.font(baseFont).fontSize(baseSize).fillColor(COLOR_LINK);
    } else {
      doc.font(baseFont).fontSize(baseSize).fillColor(COLOR_TEXT);
    }
    const textOpts: any = { continued, lineGap: opts.lineGap, width };
    if (run.kind === 'link') {
      textOpts.link = run.href;
      textOpts.underline = true;
    } else {
      textOpts.link = null;
      textOpts.underline = false;
    }
    doc.text(run.text, textOpts);
  });
  // Reset to baseline style.
  doc.font(baseFont).fontSize(baseSize).fillColor(COLOR_TEXT);
}

type InlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Pattern order: inline code, link, bold, italic. Pull each one out
  // around the others rather than nesting; the dialect this serves
  // doesn't combine styles.
  const tokenPattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenPattern.exec(text))) {
    if (m.index > last) runs.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1]) runs.push({ kind: 'code', text: m[1].slice(1, -1) });
    else if (m[2]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[2])!;
      runs.push({ kind: 'link', text: lm[1], href: lm[2] });
    }
    else if (m[3]) runs.push({ kind: 'bold', text: m[3].slice(2, -2) });
    else if (m[4]) runs.push({ kind: 'italic', text: m[4].slice(1, -1) });
    else if (m[5]) runs.push({ kind: 'italic', text: m[5].slice(1, -1) });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) });
  if (runs.length === 0) runs.push({ kind: 'text', text });
  return runs;
}
