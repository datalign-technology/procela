import { useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// CopyButton — a quiet, icon-only affordance for copying a value (typically an
// entity id) to the clipboard. It sits beside a title without competing with
// it: muted by default, text-coloured on hover, and it flips to a success
// check for a beat after a copy so the action is confirmed in place (no toast).
//
//   <CopyButton value={asset.id} label="Copy ID" />
// ──────────────────────────────────────────────────────────────────────────

interface CopyButtonProps {
  value: string;
  /** Tooltip + accessible name. Defaults to "Copy ID". */
  label?: string;
  /** Icon size in px. Defaults to 14 (title-row scale). */
  size?: number;
}

function CopyGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function CopyButton({ value, label = 'Copy ID', size = 14 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (insecure context / permissions) — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size + 10, height: size + 10, padding: 0,
        border: 'none', background: 'transparent', borderRadius: 4,
        color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
        cursor: 'pointer', flexShrink: 0,
        transition: 'color 0.12s',
      }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--color-text)'; }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
    >
      {copied ? <CheckGlyph size={size} /> : <CopyGlyph size={size} />}
    </button>
  );
}
