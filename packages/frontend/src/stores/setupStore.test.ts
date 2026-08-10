import { describe, it, expect } from 'vitest';
import { shouldShowGetStarted } from './setupStore';

// The "Get Started" sidebar entry visibility rule. Pure function, so the
// user-facing behaviour (control over whether the guide shows) is locked
// without mounting the sidebar.
describe('shouldShowGetStarted', () => {
  it("'hidden' never shows, regardless of progress", () => {
    expect(shouldShowGetStarted('hidden', undefined)).toBe(false);
    expect(shouldShowGetStarted('hidden', 0)).toBe(false);
    expect(shouldShowGetStarted('hidden', 50)).toBe(false);
    expect(shouldShowGetStarted('hidden', 100)).toBe(false);
  });

  it("'shown' always shows, even at 100%", () => {
    expect(shouldShowGetStarted('shown', undefined)).toBe(true);
    expect(shouldShowGetStarted('shown', 0)).toBe(true);
    expect(shouldShowGetStarted('shown', 100)).toBe(true);
  });

  it("'auto' shows while incomplete (or never visited) and hides at 100%", () => {
    expect(shouldShowGetStarted('auto', undefined)).toBe(true);  // never opened → nudge
    expect(shouldShowGetStarted('auto', 0)).toBe(true);
    expect(shouldShowGetStarted('auto', 99)).toBe(true);
    expect(shouldShowGetStarted('auto', 100)).toBe(false);       // fully set up → step aside
  });
});
