import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Avatar — the initials-in-a-circle marker for a person. The background is
// derived deterministically from the name, so the same person is always the
// same colour across the app. Decorative (not semantic), so the fills are a
// fixed hex palette like the badge palettes, not `--color-*` tokens.
//
//   <Avatar name="Ada Lovelace" />            // sm (24px) — list rows
//   <Avatar name={p.name} size="md" />        // md (32px)
// ──────────────────────────────────────────────────────────────────────────

const SIZES = { sm: 24, md: 32, lg: 40 } as const;
export type AvatarSize = keyof typeof SIZES;

const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#e0e7ff', fg: '#3730a3' },
  { bg: '#fce7f3', fg: '#9d174d' },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#fef3c7', fg: '#92400e' },
  { bg: '#ccfbf1', fg: '#115e59' },
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#ffe4e6', fg: '#9f1239' },
  { bg: '#ede9fe', fg: '#5b21b6' },
];

/** First + last initial (or first two letters of a single name). */
export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paletteFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  /** Defaults to the name. */
  title?: string;
  style?: CSSProperties;
}

export default function Avatar({ name, size = 'sm', title, style }: AvatarProps) {
  const px = SIZES[size];
  const { bg, fg } = paletteFor(name || '');
  return (
    <span
      title={title ?? name}
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: px, height: px, borderRadius: '50%', flexShrink: 0,
        background: bg, color: fg,
        fontSize: Math.round(px * 0.4), fontWeight: 600, lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {initialsOf(name || '')}
    </span>
  );
}
