import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TierBadge from './TierBadge';
import { TIER_COLORS } from '../lib/governanceTier';

describe('TierBadge', () => {
  it('renders a label for a known tier', () => {
    render(<TierBadge tier="GOLD" />);
    // default terminology is "plain" → GOLD = "Trusted"
    expect(screen.getByText('Trusted')).toBeInTheDocument();
  });

  it('colours by tier from the TIER_COLORS ramp', () => {
    render(<TierBadge tier="SILVER" />);
    const el = screen.getByText('Managed');
    expect(el.style.background).toBe(hexToRgb(TIER_COLORS.SILVER.bg));
  });

  it('falls back to BRONZE for an unknown/blank value', () => {
    render(<TierBadge tier={null} />);
    // BRONZE plain label = "Untrusted"
    expect(screen.getByText('Untrusted')).toBeInTheDocument();
  });
});

// jsdom serialises inline background hex to rgb(...)
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
