import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CopyButton from './CopyButton';

describe('CopyButton', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('copies the value and confirms in place', async () => {
    render(<CopyButton value="abc-123" />);
    const btn = screen.getByRole('button', { name: 'Copy ID' });
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc-123');
    // Flips to a "Copied" confirmation after the write resolves.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('uses a custom label for the tooltip / accessible name', () => {
    render(<CopyButton value="g-1" label="Copy group ID" />);
    expect(screen.getByRole('button', { name: 'Copy group ID' })).toBeInTheDocument();
  });

  it('does not throw when the clipboard API is unavailable', () => {
    // @ts-expect-error deliberately remove clipboard
    navigator.clipboard = undefined;
    render(<CopyButton value="x" />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }))).not.toThrow();
  });
});
