import { describe, it, expect } from 'vitest';
import { formatPersonLabel } from './personLabel';

describe('formatPersonLabel', () => {
  it('returns just the name when no title or org', () => {
    expect(formatPersonLabel({ name: 'Alice Smith' })).toBe('Alice Smith');
  });

  it('appends the title with an em-dash', () => {
    expect(formatPersonLabel({ name: 'Alice Smith', title: 'Senior Engineer' }))
      .toBe('Alice Smith — Senior Engineer');
  });

  it('prefers orgPaths over orgNames for the org segment', () => {
    const label = formatPersonLabel({
      name: 'Alice Smith',
      orgPaths: ['Acme / Engineering'],
      orgNames: ['Engineering'],
    });
    expect(label).toContain('Acme / Engineering');
  });

  it('falls back to jobRole when title is absent', () => {
    expect(formatPersonLabel({ name: 'Bob Jones', jobRole: 'Data Steward' }))
      .toBe('Bob Jones — Data Steward');
  });
});
