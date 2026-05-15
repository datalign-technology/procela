import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Badge palette — single source of truth for the small coloured chips
// scattered across the UI: tier badges, criticality, health, agent type.
// Lifecycle status keeps living in statusBadge.ts; this file is for the
// "kind of thing" badges that aren't status.
//
// Pages used to bake these mappings inline ("GOLD ? #fef3c7 : SILVER ?
// #f1f5f9 : #fed7aa"), which drifted over time and broke when the
// terminology rename added new values. Centralising lets every page
// stay in lockstep when palette decisions change.
// ──────────────────────────────────────────────────────────────────────────

export interface BadgePalette {
  bg: string;
  color: string;
}

const NEUTRAL: BadgePalette = { bg: '#f1f5f9', color: '#64748b' };

// Governance tier — stored values are BRONZE/SILVER/GOLD regardless of
// the user-facing terminology toggle.
const TIER: Record<string, BadgePalette> = {
  GOLD:   { bg: '#fef3c7', color: '#92400e' },
  SILVER: { bg: '#f1f5f9', color: '#475569' },
  BRONZE: { bg: '#fed7aa', color: '#9a3412' },
};

// Business criticality on systems and assets.
const CRITICALITY: Record<string, BadgePalette> = {
  HIGH:   { bg: '#fee2e2', color: '#991b1b' },
  MEDIUM: { bg: '#fef3c7', color: '#92400e' },
  LOW:    { bg: '#d1f0eb', color: '#0f4f46' },
};

// Health score band — used by Asset / System cards.
function healthBand(score: number | null | undefined): BadgePalette {
  if (score == null) return NEUTRAL;
  if (score >= 80) return { bg: '#d1fae5', color: '#065f46' };
  if (score >= 50) return { bg: '#fef3c7', color: '#92400e' };
  return { bg: '#fee2e2', color: '#991b1b' };
}

// Agent type — covers the full enum AgentsPage exposes plus the
// HUMAN tag used on PeoplePage when the row is a real user. Kept here
// so neither surface bakes its own greens / purples.
const AGENT_TYPE: Record<string, BadgePalette> = {
  AI:              { bg: '#ede9fe', color: '#5b21b6' },
  SERVICE_ACCOUNT: { bg: '#dbeafe', color: '#1e40af' },
  PIPELINE:        { bg: '#d1f0eb', color: '#0f4f46' },
  BOT:             { bg: '#fef3c7', color: '#92400e' },
  OTHER:           { bg: '#f1f5f9', color: '#64748b' },
  HUMAN:           { bg: '#d1f0eb', color: '#0f4f46' },
};

// ──────────────────────────────────────────────────────────────────────────

export type BadgeKind = 'tier' | 'criticality' | 'health' | 'agentType';

export function badgeColor(kind: BadgeKind, value: string | number | null | undefined): BadgePalette {
  switch (kind) {
    case 'tier':        return TIER[String(value || '').toUpperCase()] || NEUTRAL;
    case 'criticality': return CRITICALITY[String(value || '').toUpperCase()] || NEUTRAL;
    case 'health':      return healthBand(typeof value === 'number' ? value : value == null ? null : Number(value));
    case 'agentType':   return AGENT_TYPE[String(value || '').toUpperCase()] || NEUTRAL;
    default:            return NEUTRAL;
  }
}

export function badgeStyle(kind: BadgeKind, value: string | number | null | undefined): CSSProperties {
  const c = badgeColor(kind, value);
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

export { TIER, CRITICALITY, AGENT_TYPE };
