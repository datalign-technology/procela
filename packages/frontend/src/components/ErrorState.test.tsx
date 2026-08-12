import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it('renders the default title and the message', () => {
    render(<ErrorState message="Network error" />);
    expect(screen.getByText("Couldn't load this")).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders a Retry button only when onRetry is given, and calls it', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="x" />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();

    rerender(<ErrorState message="x" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('supports a custom title and retry label', () => {
    render(<ErrorState title="Failed to load systems" onRetry={() => {}} retryLabel="Try again" />);
    expect(screen.getByText('Failed to load systems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
