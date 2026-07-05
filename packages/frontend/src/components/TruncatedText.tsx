import React from 'react';

interface TruncatedTextProps {
  /** The full text to display. Falls back to `emptyPlaceholder` (default "—") when empty. */
  text?: string | null;
  /**
   * Optional maximum width in px. Cells inside `<td>` normally
   * derive their width from the column; leave this unset and let
   * the parent `<td>` constrain the width. Set it only when the
   * parent doesn't clip (e.g. flex containers with `min-width: 0`
   * gotchas).
   */
  maxWidth?: number;
  /** Placeholder shown when the text is empty/undefined. */
  emptyPlaceholder?: string;
  /**
   * When true, use the muted colour for an empty placeholder so it
   * reads as absence rather than content. Defaults to true.
   */
  mutedWhenEmpty?: boolean;
  style?: React.CSSProperties;
  /** Optional className passthrough for the outer div. */
  className?: string;
}

/**
 * TruncatedText — single-line ellipsis + native tooltip.
 *
 * Every list page in the app has a "description" column (systems,
 * data assets, glossary, agents, …) that used to wrap freely and
 * shove downstream columns onto a second row when a single
 * long-winded row landed in the table. This is the shared cell
 * body used inside `<td>` to clamp to one line, show an ellipsis
 * for overflow, and surface the full text on hover via the
 * browser's native tooltip.
 *
 * Usage:
 *   <td style={{ maxWidth: 400 }}>
 *     <TruncatedText text={sys.description} />
 *   </td>
 *
 * The parent `<td>` (or column) supplies the width; the child div
 * clips at that width. Using an inner div (rather than styling the
 * `<td>` directly) keeps table layout algorithms happy — `<td>`
 * with `overflow: hidden` requires `display: block` which breaks
 * the row model.
 */
export default function TruncatedText({
  text,
  maxWidth,
  emptyPlaceholder = '—',
  mutedWhenEmpty = true,
  style,
  className,
}: TruncatedTextProps) {
  const isEmpty = !text || !text.trim();
  const display = isEmpty ? emptyPlaceholder : text!;
  const color = isEmpty && mutedWhenEmpty ? 'var(--color-text-muted)' : undefined;
  return (
    <div
      className={className}
      title={isEmpty ? undefined : text!}
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color,
        ...(maxWidth ? { maxWidth } : null),
        ...style,
      }}
    >
      {display}
    </div>
  );
}
