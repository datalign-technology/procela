import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProgramLifecycleBar, { type LifecycleProgram } from './ProgramLifecycleBar';

// The bar takes the Phase-1 gate as a prop and never calls the network to
// render, so these tests exercise the button/gating logic without mocking
// apiClient. A transition that opens a confirm dialog (Pause) also touches no
// network until the dialog is confirmed, so we can assert the dialog appears.

function bar(program: LifecycleProgram, opts: { isAdmin?: boolean; phase1Complete?: boolean } = {}) {
  return render(
    <ProgramLifecycleBar
      program={program}
      activeOrgId="org-1"
      isAdmin={opts.isAdmin ?? true}
      phase1Complete={opts.phase1Complete ?? true}
    />,
  );
}

describe('ProgramLifecycleBar', () => {
  it('renders the four lifecycle stages', () => {
    bar({ id: 'p1', status: 'PLANNING' });
    for (const label of ['Planning', 'Active', 'Paused', 'Completed']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('offers Launch from PLANNING, enabled once Foundation is complete', () => {
    bar({ id: 'p1', status: 'PLANNING' }, { phase1Complete: true });
    const launch = screen.getByRole('button', { name: 'Launch program' });
    expect(launch).toBeEnabled();
  });

  it('disables Launch when Foundation (Phase 1) is incomplete', () => {
    bar({ id: 'p1', status: 'PLANNING' }, { phase1Complete: false });
    const launch = screen.getByRole('button', { name: 'Launch program' });
    expect(launch).toBeDisabled();
    expect(launch).toHaveAttribute('title', expect.stringContaining('Foundation'));
  });

  it('disables transitions for non-admins with an explanatory title', () => {
    bar({ id: 'p1', status: 'ACTIVE' }, { isAdmin: false });
    const pause = screen.getByRole('button', { name: 'Pause program' });
    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute('title', expect.stringContaining('admin'));
  });

  it('shows Pause (not Launch) when ACTIVE, and opens a confirm dialog on click', () => {
    bar({ id: 'p1', status: 'ACTIVE' });
    expect(screen.queryByRole('button', { name: 'Launch program' })).not.toBeInTheDocument();
    const pause = screen.getByRole('button', { name: 'Pause program' });
    fireEvent.click(pause);
    // A confirm dialog opens before any network call.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Pause this program?')).toBeInTheDocument();
  });

  it('offers Resume from PAUSED and Reopen from COMPLETED', () => {
    const { unmount } = bar({ id: 'p1', status: 'PAUSED' });
    expect(screen.getByRole('button', { name: 'Resume program' })).toBeInTheDocument();
    unmount();
    bar({ id: 'p1', status: 'COMPLETED' });
    expect(screen.getByRole('button', { name: 'Reopen program' })).toBeInTheDocument();
  });
});
