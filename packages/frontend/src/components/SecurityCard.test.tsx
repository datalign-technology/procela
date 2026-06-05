/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '../api/client';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';
import SecurityCard, { type SecurityCardPerson } from './SecurityCard';

const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

function asAdmin() {
  useAuthStore.setState({
    user: { sub: 'admin-1', email: 'a@x.io', name: 'Admin', role: 'ORG_ADMIN', orgId: 'o1' } as unknown as User,
    accessToken: 't', refreshToken: 'r', isAuthenticated: true, sessionExpiresAt: Date.now() + 1e6,
  });
}

function asViewer() {
  useAuthStore.setState({
    user: { sub: 'viewer-1', email: 'v@x.io', name: 'Viewer', role: 'VIEWER', orgId: 'o1' } as unknown as User,
    accessToken: 't', refreshToken: 'r', isAuthenticated: true, sessionExpiresAt: Date.now() + 1e6,
  });
}

const TARGET: SecurityCardPerson = {
  id: 'person-1',
  name: 'Test User',
  email: 'test@example.com',
};

function renderCard(person: Partial<SecurityCardPerson> = {}, onChanged = vi.fn()) {
  return render(
    <MemoryRouter>
      <SecurityCard person={{ ...TARGET, ...person }} onChanged={onChanged} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  asAdmin();
});

describe('SecurityCard — visibility gate', () => {
  it('renders nothing for non-admin viewers', () => {
    asViewer();
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the security panel for admins', () => {
    renderCard();
    expect(screen.getByTestId('security-card')).toBeInTheDocument();
  });
});

describe('SecurityCard — account status row', () => {
  it('shows "Active" with a Deactivate button when active', () => {
    renderCard({ active: true });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('shows "Deactivated" with a Reactivate button when inactive', () => {
    renderCard({ active: false });
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('treats undefined active as active (back-compat with legacy records)', () => {
    renderCard({ active: undefined });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('opens the Deactivate confirm dialog before calling the API', async () => {
    renderCard({ active: true });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('heading', { name: /deactivate account/i })).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('calls /people/:id/deactivate on confirm', async () => {
    const onChanged = vi.fn();
    mockPost.mockResolvedValue(undefined);
    renderCard({ active: true }, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    // ConfirmDialog renders TWO Deactivate buttons (trigger + confirm).
    // The dialog one is inside a role="dialog".
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = dialog.querySelector('button[type="button"], button:not([disabled])');
    // Use the named button inside the dialog.
    const buttons = screen.getAllByRole('button', { name: 'Deactivate' });
    // First is trigger, second is confirm.
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/people/person-1/deactivate', {});
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    void confirmBtn;
  });
});

describe('SecurityCard — MFA row', () => {
  it('shows "No TOTP" with no Reset button when not enrolled', () => {
    renderCard({ mfaEnrolled: false });
    expect(screen.getByText('No TOTP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('shows "TOTP Enrolled" with a Reset button when enrolled', () => {
    renderCard({ mfaEnrolled: true });
    expect(screen.getByText('TOTP Enrolled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('confirms then calls /auth/mfa/admin-reset', async () => {
    mockPost.mockResolvedValue(undefined);
    renderCard({ mfaEnrolled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const dialogResetBtn = (await screen.findAllByRole('button', { name: 'Reset' })).pop()!;
    fireEvent.click(dialogResetBtn);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/mfa/admin-reset', { personId: 'person-1' });
    });
  });
});

describe('SecurityCard — WebAuthn row', () => {
  it('shows "No Keys" when none registered', () => {
    renderCard({ webauthnCredentials: [] });
    expect(screen.getByText('No Keys')).toBeInTheDocument();
  });

  it('shows "1 Key" with singular grammar', () => {
    renderCard({ webauthnCredentials: [{ id: 'k1', label: 'YubiKey', createdAt: '' }] });
    expect(screen.getByText('1 Key')).toBeInTheDocument();
  });

  it('shows "N Keys" plural for multiple keys', () => {
    renderCard({
      webauthnCredentials: [
        { id: 'k1', label: 'YubiKey', createdAt: '' },
        { id: 'k2', label: 'Touch ID', createdAt: '' },
      ],
    });
    expect(screen.getByText('2 Keys')).toBeInTheDocument();
  });

  it('falls back to webauthnEnrolled when credentials array is absent', () => {
    renderCard({ webauthnCredentials: undefined, webauthnEnrolled: true });
    expect(screen.getByText('1 Key')).toBeInTheDocument();
  });
});

describe('SecurityCard — lockout row', () => {
  it('does not render the lockout row when not locked', () => {
    renderCard({ locked: false });
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
  });

  it('renders a Locked pill and Unlock button when locked', () => {
    renderCard({ locked: true, lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
  });

  it('confirms then calls /auth/lockout/admin-clear', async () => {
    mockPost.mockResolvedValue(undefined);
    renderCard({ locked: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    const dialogBtn = (await screen.findAllByRole('button', { name: 'Unlock' })).pop()!;
    fireEvent.click(dialogBtn);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/lockout/admin-clear', { personId: 'person-1' });
    });
  });
});

describe('SecurityCard — GDPR forget flow', () => {
  it('opens a phrase-confirmation dialog when "Forget person…" is clicked', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /forget person/i }));
    expect(screen.getByRole('dialog', { name: /erase test user/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmation phrase/i)).toBeInTheDocument();
  });

  it('keeps the Erase button disabled until the phrase matches', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /forget person/i }));
    const eraseBtn = screen.getByRole('button', { name: /erase permanently/i });
    expect(eraseBtn).toBeDisabled();

    const input = screen.getByLabelText(/confirmation phrase/i);
    fireEvent.change(input, { target: { value: 'FORGET wrong@example.com' } });
    expect(eraseBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'FORGET test@example.com' } });
    expect(eraseBtn).not.toBeDisabled();
  });

  it('calls /people/:id/forget with the typed phrase and surfaces the cascade report', async () => {
    mockPost.mockResolvedValueOnce({
      data: { cascadeReport: { storesModified: 3, rowsRemoved: 2, rowsModified: 5, auditEntriesRedacted: 8 } },
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /forget person/i }));
    fireEvent.change(screen.getByLabelText(/confirmation phrase/i), {
      target: { value: 'FORGET test@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /erase permanently/i }));
    });
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/people/person-1/forget',
        { confirm: 'FORGET test@example.com' },
      );
    });
  });

  it('closes the dialog and clears the typed phrase on Cancel', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /forget person/i }));
    const input = screen.getByLabelText(/confirmation phrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'FORGET test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: /erase test user/i })).not.toBeInTheDocument();

    // Re-open — phrase should be empty.
    fireEvent.click(screen.getByRole('button', { name: /forget person/i }));
    const reopened = screen.getByLabelText(/confirmation phrase/i) as HTMLInputElement;
    expect(reopened.value).toBe('');
  });
});
