import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from './DetailDrawer';

describe('DetailDrawer', () => {
  it('renders nothing when open is false', () => {
    render(
      <DetailDrawer open={false} onClose={() => {}} title="Hidden">body</DetailDrawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and Close button when open', () => {
    render(
      <DetailDrawer open onClose={() => {}} title="Asset Detail">body</DetailDrawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Asset Detail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows a scrim in modal mode and not in panel mode', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DetailDrawer open onClose={onClose} title="X" mode="modal">body</DetailDrawer>,
    );
    // The dialog should have aria-modal="true" in modal mode.
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');

    rerender(
      <DetailDrawer open onClose={onClose} title="X" mode="panel">body</DetailDrawer>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    render(
      <DetailDrawer open onClose={onClose} title="X">body</DetailDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed in either mode', () => {
    const modal = vi.fn();
    const { rerender } = render(
      <DetailDrawer open onClose={modal} title="X" mode="modal">body</DetailDrawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modal).toHaveBeenCalledOnce();

    const panel = vi.fn();
    rerender(
      <DetailDrawer open onClose={panel} title="X" mode="panel">body</DetailDrawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).toHaveBeenCalledOnce();
  });

  it('renders kicker, subtitle, actions and footer', () => {
    render(
      <DetailDrawer
        open
        onClose={() => {}}
        title="T"
        kicker="K"
        subtitle="S"
        actions={<button data-testid="hdr">edit</button>}
        footer={<button data-testid="ftr">save</button>}
      >
        body
      </DetailDrawer>,
    );
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByTestId('hdr')).toBeInTheDocument();
    expect(screen.getByTestId('ftr')).toBeInTheDocument();
  });
});
