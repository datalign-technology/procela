import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleSection from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('renders the title', () => {
    render(
      <CollapsibleSection title="Discussion" open={false} onToggle={() => {}}>
        body
      </CollapsibleSection>,
    );
    expect(screen.getByText('Discussion')).toBeInTheDocument();
  });

  it('appends the count in the header when provided', () => {
    render(
      <CollapsibleSection title="Discussion" count={3} open={false} onToggle={() => {}}>
        body
      </CollapsibleSection>,
    );
    expect(screen.getByText('Discussion (3)')).toBeInTheDocument();
  });

  it('shows children when open and hides them when closed', () => {
    const { rerender } = render(
      <CollapsibleSection title="X" open onToggle={() => {}}>
        <span data-testid="body">visible</span>
      </CollapsibleSection>,
    );
    const body = screen.getByTestId('body');
    // The wrapper sets `hidden` when closed; children stay mounted either way.
    expect(body.closest('[hidden]')).toBeNull();

    rerender(
      <CollapsibleSection title="X" open={false} onToggle={() => {}}>
        <span data-testid="body">visible</span>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId('body').closest('[hidden]')).not.toBeNull();
  });

  it('toggles via click and via Enter / Space keys (a11y)', () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="X" open={false} onToggle={onToggle}>
        body
      </CollapsibleSection>,
    );
    const header = screen.getByRole('button');
    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(header, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(3);
  });
});
