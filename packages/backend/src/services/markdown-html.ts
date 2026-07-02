import { Marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';

// The horizontal Procela.ai wordmark lives next to HELP.md so both
// the PDF renderer (services/markdown-pdf.ts) and this HTML
// renderer read from the same file. Base64-encode once at module
// load so every subsequent render is a string copy — the guide
// then stays fully self-contained (no outbound asset requests,
// which is a hard property of this render path — see the file
// docstring).
const WORDMARK_PATH = path.resolve(__dirname, '..', 'docs', 'procela-logo.png');
const WORDMARK_DATA_URL: string | null = (() => {
  try {
    const bytes = fs.readFileSync(WORDMARK_PATH);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    // Missing wordmark isn't fatal — the header degrades to
    // text-only. Better to render the guide than to 500.
    return null;
  }
})();

// Screenshot pipeline. Every PNG in docs/images/ is read once at
// module load and cached as a base64 data URL keyed on filename
// (no leading path). Markdown can then reference them as
// `![alt](images/foo.png)` and the emitted <img> gets substituted
// to the inline data URL — same "self-contained page, no outbound
// asset requests" property as the wordmark, and the same "drop
// a file in and it renders" DX we want for docs authors who
// aren't editing this file.
//
// Missing images render as a placeholder card that names the
// expected filename so an author can spot the gap by opening the
// guide. Beats silently rendering broken-image icons.
const IMAGES_DIR = path.resolve(__dirname, '..', 'docs', 'images');
const IMAGE_DATA_URLS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  try {
    for (const filename of fs.readdirSync(IMAGES_DIR)) {
      const ext = path.extname(filename).toLowerCase();
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg' && ext !== '.gif' && ext !== '.webp') continue;
      const mime = ext === '.png' ? 'image/png'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : 'image/jpeg';
      const bytes = fs.readFileSync(path.join(IMAGES_DIR, filename));
      map.set(filename, `data:${mime};base64,${bytes.toString('base64')}`);
    }
  } catch {
    // Missing images dir isn't fatal — every reference in the
    // doc just renders as a placeholder card.
  }
  return map;
})();

function screenshotPlaceholder(filename: string, alt: string): string {
  return `<div class="screenshot-placeholder" role="img" aria-label="${escapeHtml(alt || filename)}">
    <div class="ph-icon">📸</div>
    <div class="ph-title">Screenshot placeholder</div>
    <div class="ph-file"><code>${escapeHtml(filename)}</code></div>
    <div class="ph-hint">Drop the PNG at <code>packages/backend/src/docs/images/${escapeHtml(filename)}</code> and this placeholder will replace itself with the image on next render.</div>
  </div>`;
}

function substituteImages(html: string): string {
  // Rewrite any <img src="images/foo.png" ...> emitted by marked.
  // Match src that starts with `images/` — that's how the source
  // markdown references screenshots. Anything else (absolute URL,
  // data URL) passes through untouched.
  return html.replace(
    /<img([^>]*?)src="images\/([^"]+)"([^>]*)>/g,
    (_match, before: string, filename: string, after: string) => {
      const altMatch = /alt="([^"]*)"/.exec(before + after);
      const alt = altMatch ? altMatch[1] : filename;
      const dataUrl = IMAGE_DATA_URLS.get(filename);
      if (!dataUrl) return screenshotPlaceholder(filename, alt);
      return `<img${before}src="${dataUrl}"${after} loading="lazy">`;
    },
  );
}

/**
 * markdown-to-html — Renders the markdown subset used by our in-app
 * docs (HELP.md, TRAINING.md) into a self-contained, printable HTML
 * page.
 *
 * Everything (styles, TOC script) is inlined into a single response
 * so the popup window we open with `window.open` doesn't need any
 * additional asset requests, cookies, or auth roundtrips. This
 * matches the "open in its own window, browser's built-in viewer"
 * UX we had with the old PDF endpoint but produces a document that
 * is:
 *
 *   • Selectable / copyable (PDFs from PDFKit rendered text as
 *     glyph runs; copy-paste rarely worked).
 *   • Searchable via Ctrl-F.
 *   • Responsive — resizing the popup rewraps the text.
 *   • Print-friendly — the print stylesheet drops the sticky
 *     header + TOC and rewrites colours to something ink-safe so
 *     users who want a paper copy still get one.
 *   • Deep-linkable — every heading gets a slug id so a URL like
 *     /api/v1/docs/help.html#connectors lands directly on that
 *     section.
 */

export interface RenderHtmlOptions {
  title: string;
  subtitle?: string;
  /** Optional ISO date string for the "generated" line; defaults to today. */
  generatedAt?: string;
}

// One shared marked instance. gfm covers tables + task lists +
// autolinks — everything HELP.md uses. breaks: false so an
// accidental line break in the source doesn't create a hard <br>.
const md = new Marked({
  gfm: true,
  breaks: false,
});

// Emit `<h2 id="slug">` etc. so the TOC anchors link cleanly.
// We keep the slug function local rather than pulling in
// github-slugger — the source doc's headings are ASCII, so a
// tight regex is enough.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

md.use({
  renderer: {
    heading(this: any, { tokens, depth }: { tokens: any[]; depth: number }) {
      const text = this.parser.parseInline(tokens);
      const raw = tokens.map((t: any) => t.raw || t.text || '').join('');
      const id = slugify(raw);
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>`;
    },
  },
});

interface TocEntry { depth: number; text: string; id: string }

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = markdown.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const depth = m[1].length;
      // We only want section-level entries (h1 + h2) in the TOC —
      // h3+ is too noisy for a sidebar.
      if (depth <= 2) {
        const text = m[2].replace(/^\d+\.\s+/, '').trim();
        entries.push({ depth, text, id: slugify(m[2]) });
      }
    }
  }
  return entries;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdownToHtml(markdown: string, opts: RenderHtmlOptions): string {
  const body = substituteImages(md.parse(markdown, { async: false }) as string);
  const toc = extractToc(markdown);
  const generated = opts.generatedAt || new Date().toISOString().slice(0, 10);

  const tocHtml = toc.length === 0 ? '' : `
    <nav class="toc" aria-label="Contents">
      <div class="toc-title">Contents</div>
      <ul>
        ${toc.map((t) => `<li class="depth-${t.depth}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join('')}
      </ul>
    </nav>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  <style>
    :root {
      --bg: #f7f9fb;
      --surface: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #1a7a6d;
      --primary-hover: #15655a;
      --primary-light: #d1f0eb;
      --border: #e2e8f0;
      --border-soft: #f1f5f9;
      --code-bg: #f1f5f9;
      --callout-bg: #f0fdfa;
      --callout-border: #14b8a6;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.65;
    }
    .shell {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 40px;
      padding: 32px 24px 80px;
    }
    header.doc-header {
      position: sticky; top: 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      grid-column: 1 / -1;
      margin: -32px -24px 24px;
      z-index: 10;
      display: flex; align-items: center; gap: 16px;
    }
    header.doc-header .brand {
      height: 36px; width: auto; max-width: 180px;
      object-fit: contain;
      flex-shrink: 0;
    }
    header.doc-header .info { min-width: 0; }
    header.doc-header .title { font-size: 15px; font-weight: 600; color: var(--text); }
    header.doc-header .meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    @media print {
      header.doc-header .brand { height: 44px; max-width: 220px; }
    }
    nav.toc {
      position: sticky; top: 76px;
      align-self: start;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      font-size: 13px;
      padding-right: 8px;
    }
    nav.toc .toc-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    nav.toc ul { list-style: none; padding: 0; margin: 0; }
    nav.toc li { padding: 3px 0; }
    nav.toc li.depth-2 { padding-left: 12px; font-size: 12px; }
    nav.toc a { color: var(--text-muted); text-decoration: none; }
    nav.toc a:hover { color: var(--primary); }
    nav.toc a.active { color: var(--primary); font-weight: 600; }
    main.doc-body {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 40px 56px;
      min-width: 0;
    }
    main.doc-body h1, main.doc-body h2, main.doc-body h3, main.doc-body h4 {
      color: var(--text);
      scroll-margin-top: 84px;
    }
    main.doc-body h1 { font-size: 28px; font-weight: 700; margin: 0 0 4px; }
    main.doc-body h2 { font-size: 21px; font-weight: 700; margin: 40px 0 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
    main.doc-body h3 { font-size: 17px; font-weight: 600; margin: 28px 0 8px; }
    main.doc-body h4 { font-size: 14px; font-weight: 600; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
    main.doc-body h1 .anchor, main.doc-body h2 .anchor, main.doc-body h3 .anchor, main.doc-body h4 .anchor {
      color: var(--border);
      text-decoration: none;
      margin-right: 6px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    main.doc-body h1:hover .anchor, main.doc-body h2:hover .anchor, main.doc-body h3:hover .anchor, main.doc-body h4:hover .anchor {
      opacity: 1;
    }
    main.doc-body p { margin: 12px 0; }
    main.doc-body ul, main.doc-body ol { padding-left: 24px; margin: 12px 0; }
    main.doc-body li { margin: 4px 0; }
    main.doc-body a { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; }
    main.doc-body a:hover { color: var(--primary-hover); }
    main.doc-body strong { font-weight: 700; }
    main.doc-body code {
      background: var(--code-bg);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
    }
    main.doc-body pre {
      background: var(--code-bg);
      padding: 14px 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 13px;
    }
    main.doc-body pre code {
      background: none;
      padding: 0;
    }
    main.doc-body blockquote {
      margin: 16px 0;
      padding: 12px 18px;
      background: var(--callout-bg);
      border-left: 4px solid var(--callout-border);
      border-radius: 4px;
      color: var(--text);
    }
    main.doc-body blockquote p:first-child { margin-top: 0; }
    main.doc-body blockquote p:last-child { margin-bottom: 0; }
    main.doc-body table {
      border-collapse: collapse;
      margin: 16px 0;
      width: 100%;
      font-size: 13px;
    }
    main.doc-body th, main.doc-body td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: top;
    }
    main.doc-body th {
      font-weight: 700;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border);
    }
    main.doc-body hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 32px 0;
    }
    /* Screenshots. Full-width, subtle border + shadow so they read
       as UI captures rather than diagrams. Caption below (from alt
       text) shows only when the author supplied one. */
    main.doc-body img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 20px auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
    }
    /* Placeholder card shown when a referenced screenshot file is
       missing from docs/images/. Not scary — informative, so the
       author sees what's expected and where to drop it. */
    .screenshot-placeholder {
      margin: 20px 0;
      padding: 24px 20px;
      background: repeating-linear-gradient(
        135deg,
        var(--code-bg),
        var(--code-bg) 10px,
        var(--surface) 10px,
        var(--surface) 20px
      );
      border: 2px dashed var(--border);
      border-radius: 8px;
      text-align: center;
      color: var(--text-muted);
    }
    .screenshot-placeholder .ph-icon { font-size: 28px; margin-bottom: 6px; }
    .screenshot-placeholder .ph-title {
      font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--text-muted);
      margin-bottom: 6px;
    }
    .screenshot-placeholder .ph-file { font-size: 14px; color: var(--text); margin-bottom: 6px; }
    .screenshot-placeholder .ph-file code { background: none; padding: 0; }
    .screenshot-placeholder .ph-hint { font-size: 12px; }
    .screenshot-placeholder .ph-hint code {
      font-size: 11px; padding: 2px 6px;
    }
    @media (max-width: 860px) {
      .shell { grid-template-columns: 1fr; padding: 20px 16px 60px; }
      nav.toc { position: static; max-height: none; margin-bottom: 12px; }
      main.doc-body { padding: 24px; }
    }
    @media print {
      html, body { background: white; }
      header.doc-header, nav.toc { display: none; }
      .shell { display: block; padding: 0; max-width: none; }
      main.doc-body { border: none; padding: 0; border-radius: 0; }
      main.doc-body h1, main.doc-body h2, main.doc-body h3 { break-after: avoid; }
      main.doc-body pre, main.doc-body blockquote { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="doc-header">
      ${WORDMARK_DATA_URL ? `<img class="brand" src="${WORDMARK_DATA_URL}" alt="Procela" />` : ''}
      <div class="info">
        <div class="title">${escapeHtml(opts.title)}</div>
        <div class="meta">${opts.subtitle ? escapeHtml(opts.subtitle) + '  ·  ' : ''}Generated ${escapeHtml(generated)}</div>
      </div>
    </header>
    ${tocHtml}
    <main class="doc-body">
      ${body}
    </main>
  </div>
  <script>
    // Highlight the TOC entry the user has scrolled to. Cheap
    // IntersectionObserver — one entry active at a time, no debounce.
    (function () {
      const tocLinks = document.querySelectorAll('nav.toc a');
      if (tocLinks.length === 0) return;
      const map = new Map();
      tocLinks.forEach((a) => {
        const id = a.getAttribute('href').slice(1);
        map.set(id, a);
      });
      const targets = Array.from(map.keys())
        .map((id) => document.getElementById(id))
        .filter(Boolean);
      let activeId = null;
      const observer = new IntersectionObserver((entries) => {
        // Pick the topmost heading currently intersecting the top
        // third of the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const id = visible[0].target.id;
        if (id === activeId) return;
        activeId = id;
        tocLinks.forEach((a) => a.classList.remove('active'));
        const link = map.get(id);
        if (link) link.classList.add('active');
      }, { rootMargin: '-80px 0px -66% 0px' });
      targets.forEach((t) => observer.observe(t));
    }());
  </script>
</body>
</html>`;
}
