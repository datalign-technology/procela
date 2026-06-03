import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="No data assets yet" description="Add your first one." />);
    expect(screen.getByText('No data assets yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first one.')).toBeInTheDocument();
  });

  it('renders the optional icon container', () => {
    render(
      <EmptyState
        icon={<svg data-testid="state-icon" />}
        title="X"
      />,
    );
    expect(screen.getByTestId('state-icon')).toBeInTheDocument();
  });

  it('renders a primary action button and fires the click', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="X"
        action={{ label: 'Add Asset', onClick }}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Add Asset' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports a secondary action', () => {
    render(
      <EmptyState
        title="X"
        action={{ label: 'Primary', onClick: () => {} }}
        secondaryAction={{ label: 'Import CSV', onClick: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
  });

  it('renders children as a footer slot', () => {
    render(
      <EmptyState title="X">
        <a href="/help" data-testid="learn-more">Learn more</a>
      </EmptyState>,
    );
    expect(screen.getByTestId('learn-more')).toBeInTheDocument();
  });
});
