/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Page from './Page';

describe('Page', () => {
  it('renders children inside the outer container', () => {
    const { getByTestId } = render(
      <Page>
        <div data-testid="child">hi</div>
      </Page>,
    );
    expect(getByTestId('child').textContent).toBe('hi');
  });

  it('applies no width constraint at the default width', () => {
    const { container } = render(<Page><span>x</span></Page>);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.maxWidth).toBe('');
    expect(outer.style.margin).toBe('');
  });

  it('centres horizontally at width="narrow"', () => {
    const { container } = render(<Page width="narrow"><span>x</span></Page>);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.maxWidth).toBe('820px');
    expect(outer.style.margin).toBe('0px auto');
  });

  it('centres horizontally at width="wizard"', () => {
    // The `wizard` variant used to left-anchor (max width but no
    // auto margin); that was a bug — on wide viewports the form
    // jammed to the left with empty space to the right. Fixed in
    // #19: `wizard` now centres like `narrow`.
    const { container } = render(<Page width="wizard"><span>x</span></Page>);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.maxWidth).toBe('820px');
    expect(outer.style.margin).toBe('0px auto');
  });

  it('honours an optional padding override', () => {
    const { container } = render(<Page padding="8px 0 64px"><span>x</span></Page>);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.padding).toBe('8px 0px 64px');
  });

  it('passes through id and className', () => {
    const { container } = render(
      <Page id="hello" className="world"><span>x</span></Page>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.id).toBe('hello');
    expect(outer.className).toBe('world');
  });
});
