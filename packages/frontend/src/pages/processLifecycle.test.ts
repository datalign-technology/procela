import { describe, it, expect } from 'vitest';
import {
  SIMPLE_LOCKED, REVIEW_LOCKED, ADVANCED_LOCKED,
  SIMPLE_TRANSITIONS, REVIEW_TRANSITIONS, ADVANCED_TRANSITIONS,
} from './ProcessCatalogPage';

// Lifecycle lock invariants behind the "relax Simple mode + Reopen for
// editing" behaviour. These are pure data, so a cheap unit test guards
// them without rendering the (heavy) catalog page.

describe('Simple mode edit lock', () => {
  it('does NOT lock Active — Active items are editable inline', () => {
    expect(SIMPLE_LOCKED.has('ACTIVE')).toBe(false);
  });
  it('still locks Deprecated (retired items reopen to Draft to revive)', () => {
    expect(SIMPLE_LOCKED.has('DEPRECATED')).toBe(true);
  });
});

describe('Governed modes still gate Active', () => {
  it('Review and Advanced keep Active locked so edits re-enter the review gate', () => {
    expect(REVIEW_LOCKED.has('ACTIVE')).toBe(true);
    expect(ADVANCED_LOCKED.has('ACTIVE')).toBe(true);
  });
});

describe('"Reopen for editing" always has a path', () => {
  // The Reopen affordance sets status back to DRAFT, so every locked
  // status in every mode must list DRAFT as a reachable transition —
  // otherwise the button would render with no valid move.
  const cases: Array<[string, Set<string>, Record<string, string[]>]> = [
    ['simple', SIMPLE_LOCKED, SIMPLE_TRANSITIONS],
    ['review', REVIEW_LOCKED, REVIEW_TRANSITIONS],
    ['advanced', ADVANCED_LOCKED, ADVANCED_TRANSITIONS],
  ];
  it.each(cases)('%s: each locked status can transition to DRAFT', (_mode, locked, transitions) => {
    for (const status of locked) {
      expect(transitions[status] || []).toContain('DRAFT');
    }
  });
});
