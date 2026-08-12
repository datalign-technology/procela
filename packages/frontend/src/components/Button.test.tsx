import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button';

describe('Button', () => {
  it('renders children and defaults to type=button, variant=secondary', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn.style.background).toBe('var(--color-surface)'); // secondary default
  });

  it('colours by variant', () => {
    const { rerender } = render(<Button variant="primary">x</Button>);
    expect(screen.getByRole('button').style.background).toBe('var(--color-primary)');
    rerender(<Button variant="ghost">x</Button>);
    expect(screen.getByRole('button').style.background).toBe('transparent');
  });

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled: dims, blocks clicks', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.style.opacity).toBe('0.6');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading: shows the saving label, disables, marks aria-busy', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.textContent).toContain('Saving');
  });

  it('forwards aria-label and honours type=submit + style override', () => {
    render(<Button type="submit" aria-label="save it" style={{ marginTop: 8 }}>x</Button>);
    const btn = screen.getByRole('button', { name: 'save it' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.style.marginTop).toBe('8px');
  });

  it('forwards arbitrary native props (title, id) — the drop-in requirement', () => {
    render(<Button title="Seed standard skills" id="seed-btn">Seed</Button>);
    const btn = screen.getByRole('button', { name: 'Seed' });
    expect(btn).toHaveAttribute('title', 'Seed standard skills');
    expect(btn).toHaveAttribute('id', 'seed-btn');
  });

  it('merges a caller onMouseLeave with the internal press-reset handler', () => {
    const onMouseLeave = vi.fn();
    render(<Button onMouseLeave={onMouseLeave}>x</Button>);
    fireEvent.mouseLeave(screen.getByRole('button'));
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });
});
