import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Avatar, { initialsOf } from './Avatar';

describe('initialsOf', () => {
  it('first + last initial for multi-word names', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Grace Brewster Hopper')).toBe('GH');
  });
  it('first two letters for a single name', () => {
    expect(initialsOf('Cher')).toBe('CH');
  });
  it('handles empty / whitespace', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('Avatar', () => {
  it('renders the initials', () => {
    const { getByText } = render(<Avatar name="Ada Lovelace" />);
    expect(getByText('AL')).toBeInTheDocument();
  });

  it('is deterministic — same name → same background', () => {
    const a = render(<Avatar name="Ada Lovelace" />).container.querySelector('span')!;
    const b = render(<Avatar name="Ada Lovelace" />).container.querySelector('span')!;
    expect(a.style.background).toBe(b.style.background);
    expect(a.style.background).not.toBe('');
  });

  it('sizes via the size prop', () => {
    const el = render(<Avatar name="X" size="lg" />).getByText('X');
    expect(el.style.width).toBe('40px');
  });
});
