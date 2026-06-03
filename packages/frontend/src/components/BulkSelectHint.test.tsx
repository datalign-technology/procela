import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BulkSelectHint from './BulkSelectHint';

const STORAGE_PREFIX = 'procela:bulk-hint-dismissed:';

describe('BulkSelectHint', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders when there are items and nothing is selected', () => {
    render(<BulkSelectHint storageKey="test-a" hasItems hasSelection={false} />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/tick the checkboxes/i)).toBeInTheDocument();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(
      <BulkSelectHint storageKey="test-b" hasItems={false} hasSelection={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user already has a selection (treated as discovered)', () => {
    const { container } = render(
      <BulkSelectHint storageKey="test-c" hasItems hasSelection />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('persists dismissal in localStorage when the X is clicked', () => {
    render(<BulkSelectHint storageKey="test-d" hasItems hasSelection={false} />);
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);
    expect(localStorage.getItem(`${STORAGE_PREFIX}test-d`)).toBe('true');
  });

  it('respects a pre-existing dismissal flag on mount', () => {
    localStorage.setItem(`${STORAGE_PREFIX}test-e`, 'true');
    const { container } = render(
      <BulkSelectHint storageKey="test-e" hasItems hasSelection={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
