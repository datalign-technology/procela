#!/usr/bin/env node
/**
 * extract-help-markdown.js
 *
 * One-shot tool: reads the JSX-heavy HelpPage.tsx and emits HELP.md
 * with the structural content stripped down to plain markdown. This is
 * how we keep a single editable source for the in-app HTML view AND
 * the generated Help PDF without writing a full JSX→markdown parser.
 *
 * Run with:
 *   node packages/backend/scripts/extract-help-markdown.js
 *
 * The output is written to packages/backend/src/docs/HELP.md and is
 * intended to be checked into the repo. Re-run after meaningful edits
 * to HelpPage.tsx; for small tweaks it's faster to edit HELP.md by
 * hand and let the HTML view fall out of sync until next sync.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const inputPath = path.resolve(root, 'packages', 'frontend', 'src', 'pages', 'HelpPage.tsx');
const outputPath = path.resolve(root, 'packages', 'backend', 'src', 'docs', 'HELP.md');

const src = fs.readFileSync(inputPath, 'utf-8');

// ── Step 1: find the "return ( ... )" of HelpPage and grab the JSX body
const start = src.indexOf('return (');
if (start < 0) throw new Error('Could not locate the HelpPage return block.');

// Track parentheses depth to find the matching closing `);`.
let i = src.indexOf('(', start);
let depth = 0;
let body = '';
for (; i < src.length; i++) {
  const ch = src[i];
  if (ch === '(') depth++;
  else if (ch === ')') {
    depth--;
    if (depth === 0) { i++; break; }
  }
  body += ch;
}
body = body.slice(1); // drop the leading '('

// ── Step 2: tag-aware extraction
// We walk the JSX and emit markdown for the structural tags we care
// about, preserving inline emphasis. Everything else is stripped.

const lines = [];

function emit(s) { lines.push(s); }

// Strip <button>...</button> blocks entirely — they don't map to print.
body = body.replace(/<button[\s\S]*?<\/button>/g, '');
// Strip the {HELP_SECTIONS.map(...)} anchor-nav expression. Brace-counted
// removal so nested {...} inside the body of the map don't escape.
function stripBraceBlock(s, marker) {
  const start = s.indexOf(marker);
  if (start < 0) return s;
  let depth = 0;
  let i = start;
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return s.slice(0, start) + s.slice(i);
}
body = stripBraceBlock(body, '{HELP_SECTIONS');
// Also strip JSX comments (/* ... */) early.
body = body.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
// Strip <PageHeader ... /> and ToC <ul> (the on-this-page anchor list).
body = body.replace(/<PageHeader[\s\S]*?<\/PageHeader>/g, '');
body = body.replace(/<PageHeader[\s\S]*?\/>/g, '');
// Strip the "On this page" anchor list — find the first <ul style={listStyle}>
// inside the navigation block. The block has comment {/* On this page ... */}
body = body.replace(/\{\s*\/\*\s*On this page[\s\S]*?\*\/\s*\}\s*<ul[\s\S]*?<\/ul>/g, '');

// Now stream-parse what's left.
const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9]*)[^>]*>/g;
let cursor = 0;
const stack = [];
let bufText = '';

function flushPara() {
  const text = bufText.replace(/\s+/g, ' ').trim();
  if (text) emit(text + '\n');
  bufText = '';
}

// Decode the safe entities up front. We deliberately do NOT decode
// &lt; / &gt; here — HelpPage uses those as literal angle-bracket
// placeholders inside example dialog text ("<Target> is owned by
// <Other Division>...") and decoding them before the tag-strip would
// turn them into things the tag stripper eats as if they were HTML.
// We swap to a sentinel during the inline pass and put them back after
// the strip.
function decodeEntities(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…').replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←').replace(/&harr;/g, '↔')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function unwrapJSXExpression(s) {
  // Replace simple JSX expressions {' word '} with their content.
  return s.replace(/\{\s*['"]([^'"]*)['"]\s*\}/g, '$1');
}

// Inline pass: rewrite <strong>, <em>, <code> inline tags into markdown
// before we walk top-level structure.
function inlineToMd(s) {
  s = decodeEntities(s);
  // Swap &lt;X&gt; placeholders to a sentinel so the catch-all tag
  // strip below doesn't eat them. We restore real angle brackets at
  // the very end.
  s = s.replace(/&lt;/g, 'LT').replace(/&gt;/g, 'GT');
  s = unwrapJSXExpression(s);
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/g, (_, t) => `**${t.trim()}**`);
  s = s.replace(/<em>([\s\S]*?)<\/em>/g, (_, t) => `*${t.trim()}*`);
  s = s.replace(/<code>([\s\S]*?)<\/code>/g, (_, t) => `\`${t.trim()}\``);
  // Drop any remaining inline tags.
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g, (_, href, t) => `[${t.trim()}](${href})`);
  s = s.replace(/<[^>]+>/g, '');
  // Restore the angle-bracket placeholders we swapped out before the
  // tag strip. By now the only `<` and `>` that come back belong to
  // example dialog text the author wrote intentionally.
  s = s.replace(/LT/g, '<').replace(/GT/g, '>');
  return s;
}

// We walk the JSX one tag at a time. For each block element we open / close
// we adjust the stack and flush text appropriately.
function walk() {
  let m;
  tagRe.lastIndex = 0;
  let last = 0;
  while ((m = tagRe.exec(body))) {
    const between = body.slice(last, m.index);
    bufText += between;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    last = m.index + m[0].length;

    if (closing) {
      switch (tag) {
        case 'h1': emit('# '   + inlineToMd(bufText).trim() + '\n'); bufText = ''; break;
        case 'h2': emit('## '  + inlineToMd(bufText).trim() + '\n'); bufText = ''; break;
        case 'h3': emit('### ' + inlineToMd(bufText).trim() + '\n'); bufText = ''; break;
        case 'h4': emit('####' + inlineToMd(bufText).trim() + '\n'); bufText = ''; break;
        case 'p':  emit(inlineToMd(bufText).trim() + '\n'); bufText = ''; break;
        case 'li': emit('- '   + inlineToMd(bufText).trim()); bufText = ''; break;
        case 'ul': emit(''); bufText = ''; break;
        case 'ol': emit(''); bufText = ''; break;
        case 'div': flushPara(); bufText = ''; break;
        default: /* ignore */ break;
      }
    } else {
      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4':
        case 'p': case 'li': case 'ul': case 'ol': case 'div':
          if (bufText.trim()) { flushPara(); }
          break;
      }
    }
  }
  // Trailing.
  if (bufText.trim()) flushPara();
}

walk();

// ── Post-processing: drop the JSX noise the JSX → markdown pass leaves
// behind. The walk above is permissive (anything between block tags
// becomes text); the cleanup here removes the obvious junk so the
// output is a publishable HELP.md.

let out = lines.join('\n')
  // Empty headings the walk emits when a heading wraps a button / expr.
  .replace(/^#+\s*$/gm, '')
  // JSX comment blocks that survived the regex sweep.
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  // JSX expression statements like {HELP_SECTIONS.map(...)} on their own.
  .replace(/^\{[^}]*\}\s*$/gm, '')
  // Bare expressions inside list items.
  .replace(/\{HELP_SECTIONS[^}]+\}/g, '')
  // Dangling brace remnants.
  .replace(/^\s*\}\s*$/gm, '')
  .replace(/^\s*\{\s*$/gm, '')
  // "On this page" navigation crumb (the in-app ToC).
  .replace(/^On this page\s*$/gm, '')
  // Collapse the empty-string ghosts left behind when a JSX expression
  // like {orgName} was stripped from inside backticks or quotes. We
  // see remnants such as `` is owned by `` or "" sits in "" — turn
  // them into a placeholder so the sentence stays readable.
  .replace(/``/g, '`<value>`')
  .replace(/""(?=\s|[,.;!?])/g, '"<value>"')
  // Collapse runs of 2+ spaces inside a line down to a single space.
  // Generated naturally from stripping inline JSX expressions in the
  // middle of a sentence ("... in  the ..." after `{orgName}` is gone).
  .replace(/[ \t]{2,}/g, ' ')
  // Strip trailing whitespace from every line so the PDF renderer
  // doesn't measure invisible characters and so the markdown reads
  // cleanly in a diff.
  .replace(/[ \t]+$/gm, '')
  // Drop orphan bullets: a "- " line followed only by whitespace or
  // a heading is meaningless and gets rendered as a lone bullet.
  .replace(/^[-*]\s*$/gm, '')
  // Squash 3+ blank lines to 2.
  .replace(/\n{3,}/g, '\n\n')
  .trim() + '\n';

// Drop the first duplicate intro paragraph that appears right after our
// preamble (HelpPage opens with the same sentence).
out = out.replace(
  /^Procela is a DAMA-aligned governance operating platform[^\n]+\n+/,
  '',
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// Wrap with a tiny preamble so the PDF has a title page.
const preamble = `# Help Guide

Procela is a DAMA-aligned governance operating platform that helps organizations design, execute, and mature data governance using workflows, accountability models, and structured procedures. This guide is the feature-by-feature reference for the platform.

---

`;
fs.writeFileSync(outputPath, preamble + out, 'utf-8');
console.log(`Wrote ${outputPath} (${(preamble + out).length} chars)`);
