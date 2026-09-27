import type { ReactNode } from 'react';
import InfoTip from './InfoTip';

// ──────────────────────────────────────────────────────────────────────────
// HelpPopover — the inline "?" help chip next to a title, field label, or
// section. It now renders through <InfoTip> so every "?" across the app looks
// and behaves identically to the ones on the Council page: a small circle that
// reveals a compact dark tooltip on hover / focus / tap, with no "Got it" /
// "Don't show again" buttons and no persisted dismissal.
//
//   <HelpPopover id="asset-tier" title="Governance Tiers">
//     Uncertified = catalogued but not yet governed. …
//   </HelpPopover>
//
// The `id` and `showInitially` props are accepted for backward compatibility
// with existing call sites but no longer drive first-run auto-open or
// dismissal — a hover tooltip needs neither. `title` is the bold heading of
// the tooltip; `children` is its body.
// ──────────────────────────────────────────────────────────────────────────

interface HelpPopoverProps {
  /** Retained for API compatibility; no longer used (was the dismissal key). */
  id?: string;
  title?: string;
  children: ReactNode;
  /** Retained for API compatibility; no longer auto-opens. */
  showInitially?: boolean;
}

export default function HelpPopover({ title, children }: HelpPopoverProps) {
  return <InfoTip term={title || 'Help'}>{children}</InfoTip>;
}
