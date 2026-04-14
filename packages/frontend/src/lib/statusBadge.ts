import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Shared status palette + badge factory. Pages used to define their own
// `statusColors: Record<string, {bg, color}>`, which drifted over time —
// DRAFT was three slightly-different greys, ACTIVE was three slightly-
// different greens. This file is the single source of truth.
//
// Status keys are unioned across all entity lifecycles (process node,
// data domain, data quality rule, lineage flow, …). Unknown keys fall
// back to the neutral palette.
// ──────────────────────────────────────────────────────────────────────────

interface BadgeColor {
  bg: string;
  color: string;
}

const NEUTRAL: BadgeColor = { bg: '#f1f5f9', color: '#64748b' };

// Lifecycle palette — informational by default, semantic when meaningful.
const STATUS_PALETTE: Record<string, BadgeColor> = {
  // generic lifecycle
  DRAFT:        { bg: '#f1f5f9', color: '#64748b' },
  PROPOSED:     { bg: '#dbeafe', color: '#1e40af' },
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e' },
  APPROVED:     { bg: '#ede9fe', color: '#5b21b6' },
  ACTIVE:       { bg: '#d1f0eb', color: '#0f4f46' },
  INACTIVE:     { bg: '#f1f5f9', color: '#64748b' },
  PAUSED:       { bg: '#fef3c7', color: '#92400e' },
  RETIRED:      { bg: '#f1f5f9', color: '#64748b' },
  DEPRECATED:   { bg: '#fce7f3', color: '#9d174d' },

  // connection / health
  CONNECTED:    { bg: '#d1f0eb', color: '#0f4f46' },
  DISCONNECTED: { bg: '#f1f5f9', color: '#64748b' },
  ERROR:        { bg: '#fee2e2', color: '#991b1b' },
  UNTESTED:     { bg: '#fef3c7', color: '#92400e' },

  // measurement
  PASSING:      { bg: '#d1f0eb', color: '#0f4f46' },
  FAILING:      { bg: '#fee2e2', color: '#991b1b' },
  WARNING:      { bg: '#fef3c7', color: '#92400e' },
  NOT_MEASURED: { bg: '#f1f5f9', color: '#64748b' },

  // audit actions
  CREATE:       { bg: '#d1f0eb', color: '#15803d' },
  UPDATE:       { bg: '#dbeafe', color: '#1e40af' },
  DELETE:       { bg: '#fee2e2', color: '#991b1b' },
};

export function getStatusColor(status: string | undefined | null): BadgeColor {
  if (!status) return NEUTRAL;
  return STATUS_PALETTE[status] || NEUTRAL;
}

export function statusBadgeStyle(status: string | undefined | null): CSSProperties {
  const c = getStatusColor(status);
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}

// Re-export the raw palette for callers that want to derive colors directly
// (e.g. SVG strokes on visualization nodes).
export { STATUS_PALETTE };
