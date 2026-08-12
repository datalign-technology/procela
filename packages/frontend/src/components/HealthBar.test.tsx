import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HealthBar, { healthColorVar } from './HealthBar';

describe('healthColorVar', () => {
  it('maps score to the semantic token by the 80/50 thresholds', () => {
    expect(healthColorVar(80)).toBe('var(--color-success)');
    expect(healthColorVar(95)).toBe('var(--color-success)');
    expect(healthColorVar(50)).toBe('var(--color-warning)');
    expect(healthColorVar(79)).toBe('var(--color-warning)');
    expect(healthColorVar(49)).toBe('var(--color-error)');
    expect(healthColorVar(0)).toBe('var(--color-error)');
  });
});

describe('HealthBar', () => {
  it('renders the percentage and an accessible progressbar', () => {
    render(<HealthBar score={72} />);
    expect(screen.getByText('72%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '72');
  });

  it('clamps out-of-range scores', () => {
    render(<HealthBar score={140} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders an em-dash when the score is null', () => {
    render(<HealthBar score={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
