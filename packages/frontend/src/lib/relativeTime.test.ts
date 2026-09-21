import { describe, it, expect } from 'vitest';
import { relativeTime, absoluteTime } from './relativeTime';

const NOW = new Date('2026-09-21T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('renders an em dash for missing or invalid input', () => {
    expect(relativeTime(undefined, NOW)).toBe('—');
    expect(relativeTime(null, NOW)).toBe('—');
    expect(relativeTime('not-a-date', NOW)).toBe('—');
  });

  it('buckets recent times', () => {
    expect(relativeTime(ago(30 * 1000), NOW)).toBe('just now');
    expect(relativeTime(ago(5 * 60 * 1000), NOW)).toBe('5 min ago');
    expect(relativeTime(ago(2 * 3600 * 1000), NOW)).toBe('2 hr ago');
  });

  it('pluralises days', () => {
    expect(relativeTime(ago(24 * 3600 * 1000), NOW)).toBe('1 day ago');
    expect(relativeTime(ago(3 * 24 * 3600 * 1000), NOW)).toBe('3 days ago');
  });

  it('never goes negative for a future timestamp', () => {
    expect(relativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });
});

describe('absoluteTime', () => {
  it('returns empty string for missing/invalid input', () => {
    expect(absoluteTime(undefined)).toBe('');
    expect(absoluteTime('not-a-date')).toBe('');
  });

  it('returns a non-empty formatted string for a valid date', () => {
    expect(absoluteTime('2026-09-21T12:00:00Z').length).toBeGreaterThan(0);
  });
});
