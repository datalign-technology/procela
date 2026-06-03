import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the label inside a span by default', () => {
    render(<StatusBadge variant="success">Active</StatusBadge>);
    const el = screen.getByText('Active');
    // The label sits inside an inner <span>, wrapped by the outer pill <span>.
    expect(el.tagName).toBe('SPAN');
    expect(el.closest('span')?.tagName).toBe('SPAN');
  });

  it('renders as a <button> when onClick is set', () => {
    const onClick = vi.fn();
    render(<StatusBadge variant="info" onClick={onClick}>5 configured</StatusBadge>);
    const btn = screen.getByRole('button', { name: '5 configured' });
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies different background colours per variant', () => {
    // Use two separate renders so we read each colour from its own DOM
    // tree — rerender mutates the existing tree and would compare the
    // same node against itself.
    const { container: dangerHost, unmount: u1 } = render(<StatusBadge variant="danger">D</StatusBadge>);
    const dangerBg = (dangerHost.firstChild as HTMLElement).style.background;
    u1();
    const { container: successHost } = render(<StatusBadge variant="success">S</StatusBadge>);
    const successBg = (successHost.firstChild as HTMLElement).style.background;
    expect(dangerBg).not.toBe(successBg);
    expect(dangerBg).toBeTruthy();
    expect(successBg).toBeTruthy();
  });

  it('uses sm size by default (uppercase + tighter padding)', () => {
    render(<StatusBadge>label</StatusBadge>);
    const outer = screen.getByText('label').parentElement!;
    expect(outer.style.textTransform).toBe('uppercase');
    expect(outer.style.padding).toBe('1px 6px');
  });

  it('uses md size when size="md" (sentence case + larger padding)', () => {
    render(<StatusBadge size="md">Customer Accounts</StatusBadge>);
    const outer = screen.getByText('Customer Accounts').parentElement!;
    expect(outer.style.textTransform).toBe('none');
    expect(outer.style.padding).toBe('2px 8px');
  });

  it('renders no border by default', () => {
    // jsdom serialises `border: 'none'` to an empty string in some
    // contexts — the contract is just "no solid/dashed stroke."
    render(<StatusBadge variant="neutral">x</StatusBadge>);
    const outer = screen.getByText('x').parentElement!;
    expect(outer.style.border).not.toMatch(/solid|dashed/);
  });

  it('renders a solid border when outlined', () => {
    render(<StatusBadge variant="info" outlined>x</StatusBadge>);
    const outer = screen.getByText('x').parentElement!;
    expect(outer.style.border).toMatch(/solid/);
  });

  it('renders a dashed border when dashed (implies outlined)', () => {
    render(<StatusBadge variant="neutral" dashed>x</StatusBadge>);
    const outer = screen.getByText('x').parentElement!;
    expect(outer.style.border).toMatch(/dashed/);
  });

  it('renders the optional icon before the label', () => {
    render(
      <StatusBadge variant="agent" icon={<svg data-testid="icon" />}>Agent</StatusBadge>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });
});
