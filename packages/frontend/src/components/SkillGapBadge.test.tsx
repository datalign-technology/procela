/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkillGapBadge from './SkillGapBadge';

describe('SkillGapBadge', () => {
  it('renders an em-dash placeholder when there is no gap data', () => {
    render(<SkillGapBadge gap={null} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders the em-dash placeholder when the person is fully qualified', () => {
    render(<SkillGapBadge gap={{ unqualifiedCount: 0, sample: [] }} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('uses singular "activity" when exactly one activity is unqualified', () => {
    render(<SkillGapBadge gap={{ unqualifiedCount: 1, sample: ['Approve Bill Run'] }} />);
    expect(screen.getByText(/^1 activity$/)).toBeTruthy();
  });

  it('uses plural "activities" for more than one', () => {
    render(<SkillGapBadge gap={{ unqualifiedCount: 3, sample: ['A', 'B', 'C'] }} />);
    expect(screen.getByText(/^3 activities$/)).toBeTruthy();
  });

  it('appends "+N more" to the tooltip when the count exceeds the sample size', () => {
    render(<SkillGapBadge gap={{ unqualifiedCount: 5, sample: ['A', 'B', 'C'] }} />);
    const chip = screen.getByText(/^5 activities$/).closest('span');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('title')).toContain('(+2 more)');
  });

  it('does not append "+N more" when the sample covers everything', () => {
    render(<SkillGapBadge gap={{ unqualifiedCount: 2, sample: ['A', 'B'] }} />);
    const chip = screen.getByText(/^2 activities$/).closest('span');
    expect(chip!.getAttribute('title')).not.toContain('more)');
  });
});
