import { Link } from 'react-router-dom';

// Small "Help" lozenge next to a page title that links to /help.
// Visually distinct from <InfoTip> (which is a "?" circle that
// hovers a glossary entry) — they used to look identical, so a user
// couldn't tell which one would navigate away and which one would
// just expand inline. Now this one shows a book glyph + tooltip-only
// "?" stays for the hover-glossary control.

export default function HelpIconLink() {
  return (
    <Link
      to="/help"
      aria-label="Open the Help guide"
      title="Open the Help guide"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text-secondary)',
        fontSize: 10, fontWeight: 600, lineHeight: 1,
        textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}
    >
      {/* Open-book glyph. SVG so it stays crisp and inherits currentColor. */}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
        <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
      </svg>
      Help
    </Link>
  );
}
