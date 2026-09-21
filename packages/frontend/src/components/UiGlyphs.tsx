import React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// UiGlyphs — inline SVG glyphs for app-chrome affordances that aren't nav
// entities (Ask Procela, Report a problem, the command-palette search field,
// menu toggles, notification type markers).
//
// These share the same 24×24 / stroke-1.8 line-art language as `navIcons.tsx`
// and `IconButton.tsx`, so the whole app reads as one monochrome icon set.
// They exist to replace hand-picked Segoe UI Symbol / emoji codepoints
// (💬 ⚑ 🔍 ☰ ⚠ ▶ ℹ) that Windows silently substitutes with off-brand
// coloured emoji and that render at inconsistent weight beside the SVG rail.
//
// Every glyph draws with `currentColor`, so the caller controls colour by
// setting `color` on the wrapping element (e.g. the notification type tint).
// ──────────────────────────────────────────────────────────────────────────

interface GlyphProps {
  size?: number;
  strokeWidth?: number;
}

function Glyph({
  size = 16,
  strokeWidth = 1.8,
  children,
}: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

// Chat bubble — the "Ask Procela" assistant trigger.
export function MessageGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

// Flag — "Report a problem".
export function FlagGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5z" />
    </Glyph>
  );
}

// Magnifier — the command-palette / search input adornment.
export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </Glyph>
  );
}

// Hamburger — a menu / saved-views toggle.
export function MenuGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Glyph>
  );
}

// Triangle + bang — a WARNING-type notification.
export function WarningGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

// Circle + arrow — an ACTION-required notification (something to go do).
export function ActionGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
      <path d="M12 8.5 15.5 12 12 15.5" />
    </Glyph>
  );
}

// Circle + i — an informational notification.
export function InfoGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Glyph>
  );
}
