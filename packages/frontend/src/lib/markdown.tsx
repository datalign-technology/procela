import React from 'react';

/**
 * markdown.tsx — Minimal markdown → React renderer.
 *
 * Built for our in-app docs (TRAINING.md, future help pages). Avoids
 * adding a third-party library because the dialect we use is small and
 * predictable:
 *
 *   - ATX headings  (# .. ####)
 *   - Paragraphs (blank-line separated)
 *   - Bullet lists (-, *) and ordered lists, with one level of nesting
 *     via 2- or 4-space indent
 *   - GitHub-flavoured tables (| col | col | with --- header sep)
 *   - Block quotes  (> ...)
 *   - Horizontal rules (---)
 *   - Fenced code blocks (``` … ```)
 *   - Inline: **bold**, *italic*, `code`, [text](url)
 *
 * Anything outside this dialect renders as plain text so unknown
 * syntax never causes a crash. Output is React — no dangerouslySet —
 * so escaping is automatic.
 */

export function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = parseBlocks(lines);
  return blocks.map((block, i) => renderBlock(block, i));
}

// ── Block parsing ─────────────────────────────────────────────────────────

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'hr' }
  | { kind: 'code'; lang: string; text: string }
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

    // Blank line: skip.
    if (line.trim() === '') { i++; continue; }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1].length as Block extends { level: infer L } ? L : never, text: heading[2].trim() });
      i++; continue;
    }

    // HR (--- or *** with optional surrounding whitespace, alone on line).
    if (/^\s*([-*])\s*\1\s*\1[\s-*]*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++; continue;
    }

    // Fenced code block.
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      out.push({ kind: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', lines: buf });
      continue;
    }

    // Table — requires header line + separator on next.
    // Separator looks like `|---|---|` or `| :--- | ---: |` with any number
    // of columns. Escape the `-` inside the character class so it's not
    // accidentally interpreted as a range delimiter.
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-:|]*-[\s\-:|]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push({ kind: 'table', header, rows });
      continue;
    }

    // List (unordered or ordered).
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ListItem[] = [];
      let currentParent: ListItem | null = null;
      while (i < lines.length && (/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim() === '') { i++; continue; }
        const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])!;
        const indent = match[1].length;
        const text = match[3];
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

    // Paragraph: collect until blank line / other block start.
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
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
  // Trim the optional leading/trailing pipe, split on |, trim each cell.
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// ── Inline parsing ────────────────────────────────────────────────────────

/** Render inline markdown to a flat ReactNode list. Order matters: code
 *  spans are extracted first so their contents are protected from other
 *  inline rules. */
function renderInline(text: string): React.ReactNode[] {
  // Split on inline code first, then on the other inlines per segment.
  const parts: React.ReactNode[] = [];
  const codePattern = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = codePattern.exec(text))) {
    if (m.index > last) {
      parts.push(...renderInlineNoCode(text.slice(last, m.index), () => key++));
    }
    parts.push(<code key={`c-${key++}`} style={inlineCodeStyle}>{m[1]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(...renderInlineNoCode(text.slice(last), () => key++));
  }
  return parts;
}

function renderInlineNoCode(text: string, nextKey: () => number): React.ReactNode[] {
  // Link → strong → em (greedy ish; the markdown subset we render
  // doesn't nest these awkwardly).
  const out: React.ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(text))) {
    if (m.index > last) out.push(...emphasize(text.slice(last, m.index), nextKey));
    out.push(
      <a key={`l-${nextKey()}`} href={m[2]} target="_blank" rel="noreferrer" style={linkStyle}>{m[1]}</a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...emphasize(text.slice(last), nextKey));
  return out;
}

function emphasize(text: string, nextKey: () => number): React.ReactNode[] {
  // **bold** then _italic_ / *italic*.
  const out: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`b-${nextKey()}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={`i-${nextKey()}`}>{m[2]}</em>);
    else if (m[3] !== undefined) out.push(<em key={`i-${nextKey()}`}>{m[3]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── Block render ──────────────────────────────────────────────────────────

function renderBlock(block: Block, idx: number): React.ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = (`h${block.level}`) as keyof JSX.IntrinsicElements;
      return <Tag key={idx} id={slugify(block.text)} style={headingStyle(block.level)}>{renderInline(block.text)}</Tag>;
    }
    case 'paragraph':
      return <p key={idx} style={paragraphStyle}>{renderInline(block.text)}</p>;
    case 'hr':
      return <hr key={idx} style={hrStyle} />;
    case 'code':
      return (
        <pre key={idx} style={codeBlockStyle}>
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={idx} style={quoteStyle}>
          {block.lines.map((l, i) => <div key={i}>{renderInline(l)}</div>)}
        </blockquote>
      );
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={idx} style={listStyle}>
          {block.items.map((item, i) => (
            <li key={i} style={listItemStyle}>
              {renderInline(item.text)}
              {item.children && item.children.length > 0 && (
                <ul style={{ ...listStyle, marginTop: 4 }}>
                  {item.children.map((child, j) => (
                    <li key={j} style={listItemStyle}>{renderInline(child.text)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ListTag>
      );
    }
    case 'table':
      return (
        <div key={idx} style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} style={thStyle}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <td key={j} style={tdStyle}>{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ── Styles ────────────────────────────────────────────────────────────────

function headingStyle(level: number): React.CSSProperties {
  const sizes: Record<number, number> = { 1: 26, 2: 20, 3: 16, 4: 14, 5: 13, 6: 12 };
  const margins: Record<number, string> = {
    1: '0 0 16px', 2: '32px 0 12px', 3: '24px 0 10px', 4: '20px 0 8px', 5: '16px 0 6px', 6: '12px 0 4px',
  };
  return {
    fontSize: sizes[level] || 14,
    fontWeight: level <= 2 ? 700 : 600,
    margin: margins[level] || '16px 0 8px',
    lineHeight: 1.3,
    color: 'var(--color-text)',
    scrollMarginTop: 80,
  };
}

const paragraphStyle: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.6, margin: '0 0 12px', color: 'var(--color-text-secondary)',
};

const hrStyle: React.CSSProperties = {
  border: 'none', borderTop: '1px solid var(--color-border)', margin: '24px 0',
};

const codeBlockStyle: React.CSSProperties = {
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '10px 14px', marginBottom: 12,
  fontSize: 12, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
  overflowX: 'auto', whiteSpace: 'pre',
};

const inlineCodeStyle: React.CSSProperties = {
  background: 'var(--color-bg)', padding: '1px 5px', borderRadius: 3,
  fontSize: 12, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
};

const quoteStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--color-border)', margin: '0 0 12px',
  padding: '4px 0 4px 14px',
  fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic',
};

const listStyle: React.CSSProperties = {
  margin: '0 0 12px', paddingLeft: 22,
};

const listItemStyle: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)', marginBottom: 4,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse', width: '100%', fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--color-border)',
  background: 'var(--color-bg)', fontWeight: 600, fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
  verticalAlign: 'top',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--color-primary)', textDecoration: 'underline',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
