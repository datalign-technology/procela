import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OwnerCell from './OwnerCell';

describe('OwnerCell', () => {
  it('renders the owner name with an initials avatar', () => {
    render(<OwnerCell name="Ada Lovelace" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    // Avatar renders the person's initials.
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('renders the default em-dash placeholder when there is no owner', () => {
    render(<OwnerCell name={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('honours a custom empty label', () => {
    render(<OwnerCell name="" emptyLabel="Unassigned" />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('renders an optional sub-label under the name', () => {
    render(<OwnerCell name="Grace Hopper" subLabel="Deputy: Ada Lovelace" />);
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Deputy: Ada Lovelace')).toBeInTheDocument();
  });
});
