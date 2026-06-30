/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../lib/errorToast', () => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

import { apiClient } from '../api/client';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';
import ResetAllDataPanel from './ResetAllDataPanel';
import { successToast, errorToast } from '../lib/errorToast';

const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const mockSuccessToast = successToast as unknown as ReturnType<typeof vi.fn>;
const mockErrorToast = errorToast as unknown as ReturnType<typeof vi.fn>;

function asSuperAdmin() {
  useAuthStore.setState({
    user: { sub: 'sa-1', email: 'sa@x.io', name: 'Super', role: 'SUPER_ADMIN', orgId: 'o1' } as unknown as User,
    accessToken: 't', refreshToken: 'r', isAuthenticated: true, sessionExpiresAt: Date.now() + 1e6,
  });
}
function asOrgAdmin() {
  useAuthStore.setState({
    user: { sub: 'oa-1', email: 'oa@x.io', name: 'Org', role: 'ORG_ADMIN', orgId: 'o1' } as unknown as User,
    accessToken: 't', refreshToken: 'r', isAuthenticated: true, sessionExpiresAt: Date.now() + 1e6,
  });
}

const originalHref = window.location.href;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  asSuperAdmin();
});

afterEach(() => {
  vi.useRealTimers();
  // Restore window.location.href so tests are isolated.
  window.history.replaceState({}, '', originalHref);
});

describe('ResetAllDataPanel — visibility', () => {
  it('renders nothing for non-super-admins', () => {
    asOrgAdmin();
    const { container } = render(<ResetAllDataPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the panel for super-admins', () => {
    render(<ResetAllDataPanel />);
    expect(screen.getByTestId('reset-all-data-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset all data/i })).toBeInTheDocument();
  });
});

describe('ResetAllDataPanel — Export-first nudge', () => {
  it('does NOT render the "Export now" button when onExportFirst is omitted', () => {
    render(<ResetAllDataPanel />);
    expect(screen.queryByRole('button', { name: /export now/i })).not.toBeInTheDocument();
  });

  it('renders the "Export now" button when onExportFirst is provided and wires it', () => {
    const onExportFirst = vi.fn();
    render(<ResetAllDataPanel onExportFirst={onExportFirst} />);
    const btn = screen.getByRole('button', { name: /export now/i });
    fireEvent.click(btn);
    expect(onExportFirst).toHaveBeenCalledOnce();
  });
});

describe('ResetAllDataPanel — typed-confirmation gate', () => {
  it('opens the confirmation prompt on the trigger click', () => {
    render(<ResetAllDataPanel />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmation phrase/i)).toBeInTheDocument();
  });

  it('keeps the Reset everything button disabled until the phrase matches', () => {
    render(<ResetAllDataPanel />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    const resetBtn = screen.getByRole('button', { name: /reset everything/i });
    expect(resetBtn).toBeDisabled();

    const input = screen.getByLabelText(/confirmation phrase/i);
    fireEvent.change(input, { target: { value: 'reset' } });  // wrong case
    expect(resetBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'RESET' } });
    expect(resetBtn).not.toBeDisabled();
  });

  it('closes the dialog and clears the phrase on Cancel', () => {
    render(<ResetAllDataPanel />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    // Re-open — phrase should be empty.
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    const reopened = screen.getByLabelText(/confirmation phrase/i) as HTMLInputElement;
    expect(reopened.value).toBe('');
  });
});

describe('ResetAllDataPanel — submit', () => {
  // These tests don't use fake timers — vi.waitFor polls real time
  // and fake-timer microtask interplay is fiddly. We just verify the
  // POST goes out + the success/error toast fires; the deferred
  // logout setTimeout(…, 1500) is incidental.
  beforeEach(() => { vi.useRealTimers(); });

  it('POSTs /backup/reset-all with confirm: "RESET" and surfaces the success toast', async () => {
    mockPost.mockResolvedValueOnce({ data: { filesCleared: 12, storesReloaded: 8, message: 'done' } });

    render(<ResetAllDataPanel />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByRole('button', { name: /reset everything/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/backup/reset-all', { confirm: 'RESET' });
    });
    await waitFor(() => {
      expect(mockSuccessToast).toHaveBeenCalled();
    });
    const message = String(mockSuccessToast.mock.calls[0][0]);
    expect(message).toMatch(/12.*files/i);
  });

  it('surfaces an error toast and re-enables the button when the API fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('server exploded'));

    render(<ResetAllDataPanel />);
    fireEvent.click(screen.getByRole('button', { name: /reset all data/i }));
    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), { target: { value: 'RESET' } });
    fireEvent.click(screen.getByRole('button', { name: /reset everything/i }));

    await waitFor(() => {
      expect(mockErrorToast).toHaveBeenCalledWith('server exploded');
    });
    // User stays signed in.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    // Button is re-enabled so the user can retry / cancel.
    expect(screen.getByRole('button', { name: /reset everything/i })).not.toBeDisabled();
  });
});
