import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Breadcrumbs from './Breadcrumbs';
import { BreadcrumbProvider, useBreadcrumbLeaf } from './BreadcrumbContext';

// A stand-in detail page that registers a leaf, so we can exercise the
// full provider → hook → Breadcrumbs wiring the way a real route does.
function LeafRegistrar({ label }: { label: string | null | undefined }) {
  useBreadcrumbLeaf(label);
  return null;
}

function renderAt(path: string, leaf?: string | null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BreadcrumbProvider>
        <Breadcrumbs />
        {leaf !== undefined && <LeafRegistrar label={leaf} />}
      </BreadcrumbProvider>
    </MemoryRouter>,
  );
}

describe('Breadcrumbs', () => {
  it('renders nothing on the dashboard', () => {
    const { container } = renderAt('/');
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders nothing for a top-level page (ancestors would be just Dashboard)', () => {
    const { container } = renderAt('/people');
    expect(container.querySelector('nav')).toBeNull();
  });

  it('shows only the ancestor trail (dropping the raw id) when no leaf is registered', () => {
    renderAt('/people/abc-123');
    // Dashboard and People are links; the raw id is dropped, not shown.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByText('abc-123')).toBeNull();
    expect(screen.queryByText(/you are here/i)).toBeNull();
  });

  it('ends the trail on the registered leaf name as the current page', () => {
    renderAt('/people/abc-123', 'Ada Lovelace');
    // Ancestors stay links…
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People' })).toBeInTheDocument();
    // …and the leaf is the current page, as text rather than a link.
    const leaf = screen.getByText('Ada Lovelace');
    expect(leaf).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Ada Lovelace' })).toBeNull();
    // The raw id never appears.
    expect(screen.queryByText('abc-123')).toBeNull();
  });

  it('falls back to the ancestor-only trail while the leaf is still loading (null)', () => {
    renderAt('/governance-groups/g-1', null);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.queryByText('g-1')).toBeNull();
  });
});
