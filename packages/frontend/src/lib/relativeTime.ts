// Shared relative-time formatting. This logic was defined privately in
// ActiveSessionsPanel and copy-pasted (as timeAgo / relativeTime /
// formatRelative) across ~8 files; this is the single home for it.
//
//   relativeTime('2026-09-20T…')  ->  "1 day ago"
//   relativeTime(undefined)       ->  "—"
//
// `now` is injectable so it's deterministic under test.

export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  return `${Math.floor(diffSec / 86400)} day${diffSec < 172800 ? '' : 's'} ago`;
}

// Absolute, human date-time for the tooltip on a relative-time cell
// (e.g. "Jan 5, 2026, 3:42 PM"). Empty string for a missing/invalid value so
// callers can drop it straight into a `title`.
export function absoluteTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
