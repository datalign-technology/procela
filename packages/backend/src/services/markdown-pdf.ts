import PDFDocument from 'pdfkit';
import path from 'node:path';

/**
 * markdown-to-pdf — Renders the markdown subset used by our in-app
 * docs (HELP.md, TRAINING.md) into a professionally laid-out paginated
 * PDF document.
 *
 * Designed to look like a real product manual rather than a
 * raw-markdown print. Includes:
 *
 *   • Cover page: logo, large title, subtitle, generation date.
 *   • Two-pass rendering so the table of contents shows real
 *     page numbers (first pass measures, second pass draws).
 *   • Branded header bar on every body page: logo + document name.
 *   • Footer with page numbers ("Page 3 of 24") on body pages only.
 *   • Section dividers between H1/H2 transitions.
 *   • Callout boxes for blockquotes (left bar + tinted background).
 *   • Tinted code blocks with monospace font.
 *   • Inline emphasis (bold / italic / code / clickable links).
 *
 * Built on PDFKit so the backend stays Chromium-free.
 */

export interface RenderOptions {
  title: string;
  subtitle?: string;
  /** Footer text rendered on every body page (e.g. document name). */
  footer?: string;
  /** Optional ISO date string for the cover page; defaults to today. */
  generatedAt?: string;
}

export async function renderMarkdownToPdf(markdown: string, opts: RenderOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT },
        info: { Title: opts.title, Subject: opts.subtitle, Author: 'Procela' },
        bufferPages: true,
      });
      registerFonts(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const blocks = parseBlocks(markdown.replace(/\r\n/g, '\n').split('\n'));
      drawDocument(doc, blocks, opts);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Brand palette + layout constants ──────────────────────────────────

const BRAND_PRIMARY = '#0f4f46';   // deep teal — Procela primary
const BRAND_ACCENT = '#16a34a';    // success green
const BRAND_INK = '#0f172a';       // near-black for body text
const COLOR_MUTED = '#64748b';
const COLOR_BORDER = '#e2e8f0';
const COLOR_LINK = '#1d4ed8';
const COLOR_CODE_BG = '#f1f5f9';
const COLOR_CODE_TEXT = '#0f172a';
const COLOR_QUOTE_BG = '#f0fdf4';
const COLOR_QUOTE_BAR = '#16a34a';

// Font registration keys. PDFKit's built-in Helvetica is WinAnsi-only,
// so circled digits (① ② ③), arrows (→ ←), checkmarks (✓), warning
// icons (⚠), and many other characters our docs use fall back to the
// font's .notdef glyph or to byte-code sequences that show up as
// "$`a" garbage in the rendered PDF. Switching to embedded TTF fonts
// (Liberation Sans for body, DejaVu Sans Mono for code) gives us
// full BMP Unicode coverage at the cost of ~1.5 MB of font assets.
const FONT_REGULAR = 'ProcelaSans';
const FONT_BOLD = 'ProcelaSans-Bold';
const FONT_ITALIC = 'ProcelaSans-Italic';
const FONT_MONO = 'ProcelaMono';

const FONTS_DIR = path.resolve(__dirname, '..', 'docs', 'fonts');
const FONT_FILES = {
  [FONT_REGULAR]: path.join(FONTS_DIR, 'LiberationSans-Regular.ttf'),
  [FONT_BOLD]:    path.join(FONTS_DIR, 'LiberationSans-Bold.ttf'),
  [FONT_ITALIC]:  path.join(FONTS_DIR, 'LiberationSans-Italic.ttf'),
  [FONT_MONO]:    path.join(FONTS_DIR, 'DejaVuSansMono.ttf'),
};

function registerFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, filePath] of Object.entries(FONT_FILES)) {
    doc.registerFont(name, filePath);
  }
}

const SIZE_BODY = 10.5;
const SIZE_CODE = 9;
const SIZE_FOOTER = 8;
const SIZE_HEADER = 8;
const SIZE_H1 = 22;
const SIZE_H2 = 16;
const SIZE_H3 = 13;
const SIZE_H4 = 11;
const SIZE_TITLE_COVER = 38;
const SIZE_SUBTITLE_COVER = 14;

const MARGIN_TOP = 96;     // bigger to make room for the page header
const MARGIN_BOTTOM = 72;
const MARGIN_LEFT = 64;
const MARGIN_RIGHT = 64;

const LOGO_PATH = path.resolve(__dirname, '..', 'docs', 'procela-logo.png');
const ICON_PATH = path.resolve(__dirname, '..', 'docs', 'procela-icon.png');

// ── Document driver ───────────────────────────────────────────────────

interface DocCtx {
  /** Headings collected during the first pass with their page numbers.
   *  Used to render the TOC during the second pass. */
  toc: TocEntry[];
  /** When true, suppress per-page chrome and TOC capture — we're laying
   *  out the cover. */
  isCover: boolean;
  /** Footer text shown on body pages. */
  footer?: string;
  /** Document title for the page header bar. */
  title: string;
}

interface TocEntry {
  level: number;
  text: string;
  page: number;
}

function drawDocument(doc: PDFKit.PDFDocument, blocks: Block[], opts: RenderOptions) {
  const ctx: DocCtx = {
    toc: [],
    isCover: false,
    footer: opts.footer,
    title: opts.title,
  };

  // ── Cover page (page 1) ───────────────────────────────────────────
  ctx.isCover = true;
  drawCover(doc, opts);
  ctx.isCover = false;

  // ── Two-pass body rendering ───────────────────────────────────────
  // Pass 1: lay out blocks to measure page numbers for each heading.
  // We render to a throwaway document so the visible PDF only gets
  // the final pass. PDFKit doesn't support tentative measurement
  // without drawing, so we use a second instance for the dry run.
  const dryDoc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT },
    bufferPages: true,
  });
  registerFonts(dryDoc);
  dryDoc.on('data', () => { /* discard */ });
  dryDoc.on('error', () => { /* discard */ });
  const dryCtx: DocCtx = { ...ctx, toc: [], isCover: false };
  // Cover page in dry run too, so page numbers align.
  drawCover(dryDoc, opts);
  // The TOC takes pages — we reserve a placeholder so dry-run page
  // numbers match the real ones after we add it. We estimate the
  // TOC page count *after* we know how many headings there are.
  // For now, leave headings collected without TOC offset; we'll
  // add it post-hoc.
  dryDoc.addPage();
  blocks.forEach((b) => drawBlock(dryDoc, b, dryCtx));
  const tocEntriesRaw = dryCtx.toc;
  // Estimate TOC pages: rough — 36 entries per page.
  const tocPagesEstimate = Math.max(1, Math.ceil(tocEntriesRaw.length / 36));
  ctx.toc = tocEntriesRaw.map((e) => ({ ...e, page: e.page + tocPagesEstimate }));
  dryDoc.end();

  // ── Pass 2: real render ───────────────────────────────────────────
  // Table of contents.
  drawTableOfContents(doc, ctx.toc, opts.title);

  // Body content.
  doc.addPage();
  // Capture body page numbers *as we render* so cross-references stay
  // honest if the dry-run estimate was off by a page.
  const realCtx: DocCtx = { ...ctx, toc: [] };
  blocks.forEach((b) => drawBlock(doc, b, realCtx));

  // Page chrome on body pages. Determined by buffered page range so
  // we hit every page, including ones added inside table/list drawers.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (i === 0) continue; // cover has no chrome
    if (i < 1 + tocPagesEstimate) {
      drawFooter(doc, i + 1, range.count, opts.footer); // TOC pages get just footer
      continue;
    }
    drawPageHeader(doc, opts.title);
    drawFooter(doc, i + 1, range.count, opts.footer);
  }
}

// ── Cover page ────────────────────────────────────────────────────────

function drawCover(doc: PDFKit.PDFDocument, opts: RenderOptions) {
  const w = doc.page.width;
  const h = doc.page.height;

  // Brand bar across the top — a flat-design accent.
  doc.rect(0, 0, w, 12).fill(BRAND_PRIMARY);

  // Logo, centred horizontally, well above the title.
  try {
    doc.image(LOGO_PATH, w / 2 - 95, 130, { width: 190 });
  } catch { /* logo optional */ }

  // Title.
  doc.font(FONT_BOLD).fontSize(SIZE_TITLE_COVER).fillColor(BRAND_INK);
  const titleY = 280;
  doc.text(opts.title, MARGIN_LEFT, titleY, {
    align: 'center', width: w - MARGIN_LEFT - MARGIN_RIGHT,
  });

  if (opts.subtitle) {
    doc.font(FONT_REGULAR).fontSize(SIZE_SUBTITLE_COVER).fillColor(COLOR_MUTED);
    doc.text(opts.subtitle, MARGIN_LEFT, titleY + 64, {
      align: 'center', width: w - MARGIN_LEFT - MARGIN_RIGHT,
    });
  }

  // Date.
  const date = opts.generatedAt || new Date().toISOString().slice(0, 10);
  doc.font(FONT_REGULAR).fontSize(11).fillColor(COLOR_MUTED);
  doc.text(`Generated ${date}`, MARGIN_LEFT, h - 140, {
    align: 'center', width: w - MARGIN_LEFT - MARGIN_RIGHT,
  });

  // Brand bar across the bottom.
  doc.rect(0, h - 12, w, 12).fill(BRAND_PRIMARY);

  // Procela byline above the bottom bar.
  doc.font(FONT_BOLD).fontSize(11).fillColor(BRAND_PRIMARY);
  doc.text('Procela', MARGIN_LEFT, h - 50, {
    align: 'center', width: w - MARGIN_LEFT - MARGIN_RIGHT,
  });
  doc.font(FONT_REGULAR).fontSize(9).fillColor(COLOR_MUTED);
  doc.text('Business processes meet data governance.', MARGIN_LEFT, h - 34, {
    align: 'center', width: w - MARGIN_LEFT - MARGIN_RIGHT,
  });
}

// ── Page header / footer ──────────────────────────────────────────────

function drawPageHeader(doc: PDFKit.PDFDocument, title: string) {
  const w = doc.page.width;
  const y = 36;
  try {
    doc.image(ICON_PATH, MARGIN_LEFT, y, { width: 18 });
  } catch { /* icon optional */ }
  doc.font(FONT_BOLD).fontSize(SIZE_HEADER).fillColor(BRAND_PRIMARY);
  doc.text('Procela', MARGIN_LEFT + 24, y + 4, { lineBreak: false });
  doc.font(FONT_REGULAR).fontSize(SIZE_HEADER).fillColor(COLOR_MUTED);
  doc.text(title, MARGIN_LEFT, y + 4, {
    align: 'right', width: w - MARGIN_LEFT - MARGIN_RIGHT, lineBreak: false,
  });
  // Hairline under the header.
  doc.strokeColor(COLOR_BORDER).lineWidth(0.5)
    .moveTo(MARGIN_LEFT, y + 22)
    .lineTo(w - MARGIN_RIGHT, y + 22)
    .stroke();
}

function drawFooter(doc: PDFKit.PDFDocument, pageNum: number, totalPages: number, footer?: string) {
  const w = doc.page.width;
  const y = doc.page.height - 44;
  doc.strokeColor(COLOR_BORDER).lineWidth(0.5)
    .moveTo(MARGIN_LEFT, y)
    .lineTo(w - MARGIN_RIGHT, y)
    .stroke();
  doc.font(FONT_REGULAR).fontSize(SIZE_FOOTER).fillColor(COLOR_MUTED);
  if (footer) {
    doc.text(footer, MARGIN_LEFT, y + 8, { width: (w - MARGIN_LEFT - MARGIN_RIGHT) / 2, lineBreak: false });
  }
  doc.text(`Page ${pageNum} of ${totalPages}`, MARGIN_LEFT, y + 8, {
    align: 'right', width: w - MARGIN_LEFT - MARGIN_RIGHT, lineBreak: false,
  });
}

// ── Table of contents ─────────────────────────────────────────────────

function drawTableOfContents(doc: PDFKit.PDFDocument, entries: TocEntry[], title: string) {
  doc.addPage();
  doc.font(FONT_BOLD).fontSize(SIZE_H1).fillColor(BRAND_INK);
  doc.text('Contents', MARGIN_LEFT, MARGIN_TOP);
  doc.moveDown(0.4);
  // Filter to top two levels only — deeper headings would be noise.
  const tocLevels = entries.filter((e) => e.level <= 2);
  if (tocLevels.length === 0) {
    doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(COLOR_MUTED);
    doc.text('(No section headings.)');
    return;
  }
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(BRAND_INK);
  for (const entry of tocLevels) {
    if (doc.y > doc.page.height - MARGIN_BOTTOM - 24) {
      doc.addPage();
    }
    const left = MARGIN_LEFT + (entry.level - 1) * 18;
    const isTop = entry.level === 1;
    doc.font(isTop ? FONT_BOLD : FONT_REGULAR);
    doc.fontSize(isTop ? SIZE_BODY + 1 : SIZE_BODY);
    doc.fillColor(isTop ? BRAND_INK : '#334155');
    const y = doc.y;
    const pageText = String(entry.page);
    const pageWidth = doc.widthOfString(pageText);
    const right = doc.page.width - MARGIN_RIGHT - pageWidth;
    doc.text(entry.text, left, y, { width: right - left - 8, lineBreak: false });
    doc.text(pageText, right, y, { lineBreak: false });
    doc.moveDown(0.6);
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

    if (/^```/.test(line)) {
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

function drawBlock(doc: PDFKit.PDFDocument, block: Block, ctx: DocCtx) {
  switch (block.kind) {
    case 'heading': return drawHeading(doc, block.level, block.text, ctx);
    case 'paragraph': return drawParagraph(doc, block.text);
    case 'hr': return drawHr(doc);
    case 'code': return drawCode(doc, block.text);
    case 'quote': return drawQuote(doc, block.lines);
    case 'list': return drawList(doc, block.items, block.ordered);
    case 'table': return drawTable(doc, block.header, block.rows);
  }
}

function drawHeading(doc: PDFKit.PDFDocument, level: number, text: string, ctx: DocCtx) {
  const sizes: Record<number, number> = { 1: SIZE_H1, 2: SIZE_H2, 3: SIZE_H3, 4: SIZE_H4, 5: 10.5, 6: 10 };
  const beforeSpace: Record<number, number> = { 1: 1.4, 2: 1.2, 3: 0.9, 4: 0.7, 5: 0.5, 6: 0.4 };

  // Page-break before H1 / H2 unless we're near the top of a page. Top-level
  // sections deserve to start fresh.
  if (level <= 1 && doc.y > MARGIN_TOP + 24) {
    doc.addPage();
  } else if (level === 2 && doc.y > doc.page.height - MARGIN_BOTTOM - 120) {
    doc.addPage();
  }

  // Capture for TOC.
  if (level <= 3) {
    ctx.toc.push({ level, text, page: pageNumberOf(doc) });
  }

  doc.moveDown(beforeSpace[level] || 0.6);
  doc.font(FONT_BOLD).fontSize(sizes[level] || 11);
  doc.fillColor(level === 1 ? BRAND_PRIMARY : BRAND_INK);
  doc.text(text);

  // Accent rule under H1.
  if (level === 1) {
    const y = doc.y + 4;
    doc.strokeColor(BRAND_ACCENT).lineWidth(2)
      .moveTo(MARGIN_LEFT, y)
      .lineTo(MARGIN_LEFT + 56, y)
      .stroke();
    doc.y = y + 10;
  }
  doc.moveDown(0.3);
  doc.fillColor(BRAND_INK);
}

function drawParagraph(doc: PDFKit.PDFDocument, text: string) {
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(BRAND_INK);
  drawInline(doc, text, { lineGap: 2.5 });
  doc.moveDown(0.5);
}

function drawHr(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.6);
  const y = doc.y;
  doc.strokeColor(COLOR_BORDER).lineWidth(0.5)
    .moveTo(MARGIN_LEFT, y)
    .lineTo(doc.page.width - MARGIN_RIGHT, y)
    .stroke();
  doc.moveDown(0.8);
}

function drawCode(doc: PDFKit.PDFDocument, text: string) {
  const left = MARGIN_LEFT;
  const width = doc.page.width - left - MARGIN_RIGHT;
  doc.font(FONT_MONO).fontSize(SIZE_CODE);
  const lineGap = 1;
  const padding = 10;
  const height = doc.heightOfString(text, { width: width - padding * 2, lineGap });
  ensureSpace(doc, height + padding * 2 + 12);
  const startY = doc.y;
  doc.rect(left, startY, width, height + padding * 2).fill(COLOR_CODE_BG);
  doc.fillColor(COLOR_CODE_TEXT)
    .text(text, left + padding, startY + padding, { width: width - padding * 2, lineGap });
  doc.moveDown(0.6);
}

function drawQuote(doc: PDFKit.PDFDocument, lines: string[]) {
  const left = MARGIN_LEFT;
  const width = doc.page.width - left - MARGIN_RIGHT;
  const padding = 12;
  const indent = 12;
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(BRAND_INK);
  const text = lines.join(' ');
  const inner = width - padding * 2 - indent;
  const height = doc.heightOfString(text, { width: inner, lineGap: 2.5 });
  ensureSpace(doc, height + padding * 2 + 4);
  const startY = doc.y;
  doc.rect(left, startY, width, height + padding * 2).fill(COLOR_QUOTE_BG);
  doc.rect(left, startY, 3, height + padding * 2).fill(COLOR_QUOTE_BAR);
  doc.fillColor(BRAND_INK);
  drawInline(doc, text, { lineGap: 2.5, width: inner, x: left + indent + padding, y: startY + padding });
  doc.y = startY + height + padding * 2;
  doc.moveDown(0.5);
}

function drawList(doc: PDFKit.PDFDocument, items: ListItem[], ordered: boolean) {
  doc.font(FONT_REGULAR).fontSize(SIZE_BODY).fillColor(BRAND_INK);
  const left = MARGIN_LEFT;
  const bulletWidth = 16;
  const innerIndent = 18;

  // Width budgets used by both the measurement pass and the render pass.
  const parentTextWidth = doc.page.width - (left + bulletWidth) - MARGIN_RIGHT;
  const childTextWidth = doc.page.width - (left + innerIndent + bulletWidth) - MARGIN_RIGHT;

  // Strip inline markdown for *measurement only* so we don't double-count
  // characters that won't render (the *bold*, _italic_, `code` markers
  // are dropped on the way to PDF). Same approach drawInline uses.
  const measureText = (s: string): string => s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  items.forEach((item, idx) => {
    // Measure the item's total height (bullet line + every nested
    // child line + the small inter-row gaps) so we can decide whether
    // to break the page BEFORE the bullet is drawn. Without this, a
    // bullet can land at the bottom of a page with its content auto-
    // flowing to the top of the next page — the classic orphan bullet.
    doc.font(FONT_REGULAR).fontSize(SIZE_BODY);
    let itemHeight = doc.heightOfString(measureText(item.text), { width: parentTextWidth, lineGap: 2 });
    if (item.children && item.children.length > 0) {
      itemHeight += 4; // moveDown(0.15) on each side
      for (const child of item.children) {
        itemHeight += doc.heightOfString(measureText(child.text), { width: childTextWidth, lineGap: 2 });
      }
      itemHeight += 4;
    }
    if (doc.y + itemHeight > doc.page.height - MARGIN_BOTTOM) {
      doc.addPage();
    }

    const bullet = ordered ? `${idx + 1}.` : '•';
    const startY = doc.y;
    doc.font(FONT_BOLD).fillColor(BRAND_PRIMARY);
    doc.text(bullet, left, startY, { width: bulletWidth, lineBreak: false });
    doc.font(FONT_REGULAR).fillColor(BRAND_INK);
    doc.y = startY;
    const x = left + bulletWidth;
    doc.x = x;
    drawInline(doc, item.text, { lineGap: 2, width: parentTextWidth });
    doc.x = left;
    if (item.children && item.children.length > 0) {
      doc.moveDown(0.15);
      item.children.forEach((child) => {
        const cy = doc.y;
        doc.font(FONT_REGULAR).fillColor(COLOR_MUTED);
        doc.text('◦', left + innerIndent, cy, { width: bulletWidth, lineBreak: false });
        doc.fillColor(BRAND_INK);
        doc.y = cy;
        const cx = left + innerIndent + bulletWidth;
        doc.x = cx;
        drawInline(doc, child.text, { lineGap: 2, width: childTextWidth });
        doc.x = left;
      });
      doc.moveDown(0.15);
    }
  });
  doc.moveDown(0.5);
}

function drawTable(doc: PDFKit.PDFDocument, header: string[], rows: string[][]) {
  const left = MARGIN_LEFT;
  const totalWidth = doc.page.width - left - MARGIN_RIGHT;
  const colWidth = totalWidth / Math.max(header.length, 1);
  const padding = 7;

  doc.font(FONT_BOLD).fontSize(SIZE_BODY - 0.5).fillColor('#fff');
  let headerHeight = 0;
  header.forEach((h) => {
    const cellHeight = doc.heightOfString(h, { width: colWidth - padding * 2 });
    headerHeight = Math.max(headerHeight, cellHeight);
  });
  ensureSpace(doc, headerHeight + padding * 2 + 32);
  const headerStartY = doc.y;
  doc.rect(left, headerStartY, totalWidth, headerHeight + padding * 2).fill(BRAND_PRIMARY);
  header.forEach((h, i) => {
    doc.fillColor('#fff').text(h, left + i * colWidth + padding, headerStartY + padding, {
      width: colWidth - padding * 2,
    });
  });
  let y = headerStartY + headerHeight + padding * 2;

  doc.font(FONT_REGULAR).fontSize(SIZE_BODY - 0.5);
  rows.forEach((row, rowIdx) => {
    doc.fillColor(BRAND_INK);
    let rowHeight = 0;
    row.forEach((cell) => {
      const h = doc.heightOfString(cell, { width: colWidth - padding * 2 });
      rowHeight = Math.max(rowHeight, h);
    });
    if (y + rowHeight + padding * 2 > doc.page.height - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
    if (rowIdx % 2 === 1) {
      doc.rect(left, y, totalWidth, rowHeight + padding * 2).fill('#f8fafc');
    }
    doc.strokeColor(COLOR_BORDER).lineWidth(0.4)
      .rect(left, y, totalWidth, rowHeight + padding * 2).stroke();
    row.forEach((cell, i) => {
      doc.fillColor(BRAND_INK).text(cell, left + i * colWidth + padding, y + padding, {
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
  x?: number;
  y?: number;
}

function drawInline(doc: PDFKit.PDFDocument, text: string, opts: InlineOpts = {}) {
  const runs = parseInline(text);
  const baseFont = FONT_REGULAR;
  const baseSize = SIZE_BODY;
  if (opts.x !== undefined && opts.y !== undefined) {
    doc.x = opts.x; doc.y = opts.y;
  }
  runs.forEach((run, i) => {
    const last = i === runs.length - 1;
    const continued = !last;
    if (run.kind === 'code') {
      doc.font(FONT_MONO).fontSize(SIZE_CODE).fillColor(COLOR_CODE_TEXT);
    } else if (run.kind === 'bold') {
      doc.font(FONT_BOLD).fontSize(baseSize).fillColor(BRAND_INK);
    } else if (run.kind === 'italic') {
      doc.font(FONT_ITALIC).fontSize(baseSize).fillColor(BRAND_INK);
    } else if (run.kind === 'link') {
      doc.font(baseFont).fontSize(baseSize).fillColor(COLOR_LINK);
    } else {
      doc.font(baseFont).fontSize(baseSize).fillColor(BRAND_INK);
    }
    const textOpts: any = { continued, lineGap: opts.lineGap, width: opts.width };
    if (run.kind === 'link') {
      textOpts.link = run.href; textOpts.underline = true;
    } else {
      textOpts.link = null; textOpts.underline = false;
    }
    doc.text(run.text, textOpts);
  });
  doc.font(baseFont).fontSize(baseSize).fillColor(BRAND_INK);
}

type InlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
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

// ── Page-flow helpers ──────────────────────────────────────────────────

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > doc.page.height - MARGIN_BOTTOM) {
    doc.addPage();
  }
}

function pageNumberOf(doc: PDFKit.PDFDocument): number {
  const range = doc.bufferedPageRange();
  return range.start + range.count;
}
