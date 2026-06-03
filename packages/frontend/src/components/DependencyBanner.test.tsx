import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DependencyBanner from './DependencyBanner';

function r(ui: React.ReactElement) {
  // DependencyBanner uses react-router <Link>, so needs router context.
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('DependencyBanner', () => {
  it('renders nothing when every check is met', () => {
    const { container } = r(
      <DependencyBanner
        phase="Define before connect"
        checks={[
          { label: 'Scope defined', met: true, link: '/scope' },
          { label: 'Principles set', met: true, link: '/principles' },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner and lists only the unmet checks', () => {
    r(
      <DependencyBanner
        phase="Define before connect"
        checks={[
          { label: 'Scope defined', met: true, link: '/scope' },
          { label: 'Principles set', met: false, link: '/principles' },
          { label: 'Domains created', met: false, link: '/domains' },
        ]}
      />,
    );
    expect(screen.getByText('Prerequisites needed')).toBeInTheDocument();
    expect(screen.queryByText('Scope defined')).not.toBeInTheDocument();
    expect(screen.getByText('Principles set')).toBeInTheDocument();
    expect(screen.getByText('Domains created')).toBeInTheDocument();
  });

  it('shows the phase context line at the bottom', () => {
    r(
      <DependencyBanner
        phase="Define before connect"
        checks={[{ label: 'X', met: false, link: '/x' }]}
      />,
    );
    expect(screen.getByText(/Sequence matters/)).toBeInTheDocument();
    expect(screen.getByText(/Define before connect/)).toBeInTheDocument();
  });
});
