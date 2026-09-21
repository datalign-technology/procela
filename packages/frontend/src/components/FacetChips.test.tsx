import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FacetChips, { type FacetChip } from './FacetChips';

const facets: FacetChip[] = [
  { key: '', label: 'All', count: 7 },
  { key: 'MASTER', label: 'Master', count: 4 },
  { key: 'METADATA', label: 'Metadata', count: 0 },
];

describe('FacetChips', () => {
  it('renders every facet including zero-count ones (the whole taxonomy)', () => {
    render(<FacetChips facets={facets} activeKey="" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /All \(7\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Master \(4\)/ })).toBeInTheDocument();
    // The empty type is NOT hidden — it shows with a (0) count.
    expect(screen.getByRole('button', { name: /Metadata \(0\)/ })).toBeInTheDocument();
  });

  it('marks the active chip with aria-pressed', () => {
    render(<FacetChips facets={facets} activeKey="MASTER" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /Master \(4\)/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /All \(7\)/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSelect with the chip key on click — including a zero-count chip', () => {
    const onSelect = vi.fn();
    render(<FacetChips facets={facets} activeKey="" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Metadata \(0\)/ }));
    expect(onSelect).toHaveBeenCalledWith('METADATA');
    fireEvent.click(screen.getByRole('button', { name: /Master \(4\)/ }));
    expect(onSelect).toHaveBeenCalledWith('MASTER');
  });

  it('renders an optional section label', () => {
    render(<FacetChips label="Classification" facets={facets} activeKey="" onSelect={() => {}} />);
    expect(screen.getByText('Classification')).toBeInTheDocument();
  });
});
