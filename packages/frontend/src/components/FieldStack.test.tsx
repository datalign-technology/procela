import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FieldStack from './FieldStack';

describe('FieldStack', () => {
  it('renders as a flex column so children stack vertically', () => {
    render(
      <FieldStack>
        <span data-testid="a">a</span>
        <span data-testid="b">b</span>
      </FieldStack>,
    );
    const stack = screen.getByTestId('a').parentElement!;
    expect(stack.style.display).toBe('flex');
    expect(stack.style.flexDirection).toBe('column');
  });

  it('defaults to the field spacing token', () => {
    render(<FieldStack><span data-testid="c">c</span></FieldStack>);
    const stack = screen.getByTestId('c').parentElement!;
    expect(stack.style.gap).toBe('var(--space-field)');
  });

  it('maps each gap tier to its --space-* token', () => {
    const { rerender } = render(
      <FieldStack gap="tight"><span data-testid="x">x</span></FieldStack>,
    );
    expect(screen.getByTestId('x').parentElement!.style.gap).toBe('var(--space-tight)');
    rerender(<FieldStack gap="section"><span data-testid="x">x</span></FieldStack>);
    expect(screen.getByTestId('x').parentElement!.style.gap).toBe('var(--space-section)');
  });

  it('merges caller style without overriding the gap', () => {
    render(
      <FieldStack style={{ marginTop: '10px' }}>
        <span data-testid="y">y</span>
      </FieldStack>,
    );
    const stack = screen.getByTestId('y').parentElement!;
    expect(stack.style.marginTop).toBe('10px');
    expect(stack.style.gap).toBe('var(--space-field)');
  });
});
