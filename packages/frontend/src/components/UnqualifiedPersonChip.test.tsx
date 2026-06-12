/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UnqualifiedPersonChip from './UnqualifiedPersonChip';

describe('UnqualifiedPersonChip', () => {
  it('renders nothing when no skills are missing', () => {
    const { container } = render(<UnqualifiedPersonChip missingSkillNames={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows singular "skill" when exactly one is missing', () => {
    render(<UnqualifiedPersonChip missingSkillNames={['Data Profiling']} />);
    expect(screen.getByText(/Responsible person lacks 1 required skill$/)).toBeTruthy();
  });

  it('shows plural "skills" when more than one is missing', () => {
    render(<UnqualifiedPersonChip missingSkillNames={['Data Profiling', 'Anomaly Detection']} />);
    expect(screen.getByText(/Responsible person lacks 2 required skills$/)).toBeTruthy();
  });

  it('lists the missing skill names in the title tooltip', () => {
    render(<UnqualifiedPersonChip missingSkillNames={['Data Profiling', 'Anomaly Detection', 'Compliance Monitoring']} />);
    const chip = screen.getByRole('status');
    expect(chip.getAttribute('title')).toBe(
      'Responsible person is missing: Data Profiling, Anomaly Detection, Compliance Monitoring',
    );
  });
});
