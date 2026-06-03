import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from './Modal';

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders the title, body and Close button when open', () => {
    render(
      <Modal open onClose={() => {}} title="My Modal">
        <p>body content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'My Modal' })).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="X">
        <p>body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="X">
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders kicker, subtitle, footer and actions in their slots', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="T"
        kicker="K"
        subtitle="S"
        actions={<button data-testid="hdr-action">edit</button>}
        footer={<button data-testid="ftr-action">save</button>}
      >
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-action')).toBeInTheDocument();
    expect(screen.getByTestId('ftr-action')).toBeInTheDocument();
  });

  it('uses the size preset for width', () => {
    // Separate renders — rerender mutates the same DOM node so the
    // captured ref would reflect the latest state, not the original.
    const { unmount } = render(
      <Modal open onClose={() => {}} title="X" size="sm">body</Modal>,
    );
    const smWidth = screen.getByRole('dialog').style.width;
    unmount();
    render(<Modal open onClose={() => {}} title="X" size="lg">body</Modal>);
    const lgWidth = screen.getByRole('dialog').style.width;
    expect(smWidth).toContain('480px');
    expect(lgWidth).toContain('720px');
  });
});
