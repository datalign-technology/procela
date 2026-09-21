import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// processTypeIcons — monochrome line icons for the process-node taxonomy
// (Value Stream → Domain → Capability → Process → Sub-Process → Activity →
// Task → Execution), replacing the earlier hand-picked Unicode glyphs
// (➡ ◎ ⭐ ⚙ ↳ ▶ • ⌘) that read as mixed emoji/symbols.
//
// Each icon is stroked in the type's own colour (passed in), so the existing
// taxonomy colour-coding is preserved — it's the same set of colours, just a
// consistent stroke-1.9 / 24×24 line-art set instead of assorted glyphs.
// ──────────────────────────────────────────────────────────────────────────

const PATHS: Record<string, ReactNode> = {
  // End-to-end flow → a flow arrow.
  VALUE_STREAM: <><path d="M3 12h13" /><path d="M13 7l5 5-5 5" /></>,
  // A business domain grouping → a target / boundary.
  DOMAIN: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /></>,
  // A capability → building blocks.
  CAPABILITY: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  // A process (a defined sequence) → steps.
  PROCESS: <><path d="M4 18h4v-4h4v-4h4V6" /></>,
  // A grouping within a process → a branch-into.
  SUBPROCESS: <><path d="M7 4v9a2 2 0 0 0 2 2h7" /><path d="M14 11l4 4-4 4" /></>,
  // A unit of work → play.
  ACTIVITY: <><path d="M8 5l11 7-11 7z" /></>,
  // A detailed task → a checkbox.
  TASK: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  // A system / automation that executes → a terminal.
  EXECUTION: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10l3 2.5-3 2.5" /><path d="M13 15h4" /></>,
};

/** Icon for a process node level, stroked in `color`. Defaults to 14px. */
export function processTypeIcon(level: string, color: string, size = 14): ReactNode {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {PATHS[level] ?? PATHS.PROCESS}
    </svg>
  );
}
