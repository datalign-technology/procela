import { Link } from 'react-router-dom';

// Tiny "?" circle that links to /help. Used in page-title rows so a
// stuck user always has a one-click escape hatch to the help guide.
// Centralised here (was hand-rolled in five places) so any change to
// the visual treatment lands everywhere at once.

export default function HelpIconLink() {
  return (
    <Link
      to="/help"
      aria-label="Help"
      title="Help"
      style={{
        width: 16, height: 16, borderRadius: '50%',
        border: '1px solid var(--color-text-muted)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: 'var(--color-text-muted)',
        textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
      }}
    >?</Link>
  );
}
