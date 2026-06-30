/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// Mock the api client before importing the component so the
// component's `import { apiClient }` picks up the mock. Module-level
// hoisting in vitest matches jest's vi.mock semantics.
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

import { apiClient } from '../api/client';
import ActiveSessionsPanel, { deviceLabel, relativeTime, type SessionRow } from './ActiveSessionsPanel';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as unknown as ReturnType<typeof vi.fn>;

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    jti: 'jti-default',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    lastUsedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ip: '203.0.113.5',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0',
    provider: 'local',
    current: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deviceLabel', () => {
  it('returns "Unknown device" for undefined UA', () => {
    expect(deviceLabel(undefined)).toBe('Unknown device');
  });

  it('parses Mac + Chrome', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0')).toBe('Chrome on Mac');
  });

  it('parses Windows + Edge', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Edg/120')).toBe('Edge on Windows');
  });

  it('parses iPhone + Safari', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone) Safari/605')).toBe('Safari on iPhone');
  });

  it('falls back to OS-only when browser is unrecognised', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux) curl/8.0')).toBe('Linux');
  });

  it('uses "Device" when OS is unrecognised too', () => {
    expect(deviceLabel('AcmeBot/1.0')).toBe('Device');
  });
});

describe('relativeTime', () => {
  const NOW = new Date('2026-06-05T12:00:00Z').getTime();

  it('returns "—" for undefined', () => {
    expect(relativeTime(undefined)).toBe('—');
  });

  it('returns "—" for malformed ISO', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('—');
  });

  it('returns "just now" for < 60s', () => {
    const t = new Date(NOW - 30_000).toISOString();
    expect(relativeTime(t, NOW)).toBe('just now');
  });

  it('returns "N min ago" for sub-hour', () => {
    const t = new Date(NOW - 15 * 60 * 1000).toISOString();
    expect(relativeTime(t, NOW)).toBe('15 min ago');
  });

  it('returns "N hr ago" for sub-day', () => {
    const t = new Date(NOW - 4 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t, NOW)).toBe('4 hr ago');
  });

  it('returns "1 day ago" for 24-48h', () => {
    const t = new Date(NOW - 36 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t, NOW)).toBe('1 day ago');
  });

  it('pluralises days correctly past 48h', () => {
    const t = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t, NOW)).toBe('5 days ago');
  });
});

describe('ActiveSessionsPanel', () => {
  it('shows a loading state before the first fetch resolves', () => {
    // never-resolving promise so we sit in the loading branch.
    mockGet.mockReturnValue(new Promise(() => { /* */ }));
    render(<ActiveSessionsPanel />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders an empty state when the API returns no sessions', async () => {
    mockGet.mockResolvedValue({ data: [] });
    render(<ActiveSessionsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/no active sessions on record/i)).toBeInTheDocument();
    });
  });

  it('renders a row per session with device label + IP + provider + last-used', async () => {
    mockGet.mockResolvedValue({
      data: [
        session({ jti: 'a', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120', ip: '203.0.113.5' }),
        session({ jti: 'b', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edg/120', ip: '198.51.100.10', provider: 'oidc' }),
      ],
    });
    render(<ActiveSessionsPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('session-row-a')).toBeInTheDocument();
      expect(screen.getByTestId('session-row-b')).toBeInTheDocument();
    });
    expect(screen.getByText(/Chrome on Mac/)).toBeInTheDocument();
    expect(screen.getByText(/Edge on Windows/)).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.5/)).toBeInTheDocument();
    expect(screen.getByText(/oidc/i)).toBeInTheDocument();
  });

  it('tags the caller\'s own session with the "This device" badge', async () => {
    mockGet.mockResolvedValue({
      data: [
        session({ jti: 'a', current: false }),
        session({ jti: 'b', current: true }),
      ],
    });
    render(<ActiveSessionsPanel />);
    await waitFor(() => screen.getByTestId('session-row-b'));
    expect(screen.getByText('This device')).toBeInTheDocument();
    // Only one row gets the badge.
    expect(screen.getAllByText('This device').length).toBe(1);
  });

  it('revokes a single session and refetches the list', async () => {
    mockGet.mockResolvedValueOnce({ data: [session({ jti: 'a' }), session({ jti: 'b' })] });
    mockDelete.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce({ data: [session({ jti: 'b' })] });

    render(<ActiveSessionsPanel />);
    await waitFor(() => screen.getByTestId('session-row-a'));

    // Pick the first Revoke button — there are two rows, two buttons.
    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke session on/ });
    fireEvent.click(revokeButtons[0]);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/auth/sessions/a');
    });
    // Second fetch returned only row b.
    await waitFor(() => {
      expect(screen.queryByTestId('session-row-a')).not.toBeInTheDocument();
      expect(screen.getByTestId('session-row-b')).toBeInTheDocument();
    });
  });

  it('surfaces an error message when the initial fetch fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('network borked'));
    render(<ActiveSessionsPanel />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network borked/);
    });
  });

  it('disables "Sign out everywhere" when there are no sessions', async () => {
    mockGet.mockResolvedValue({ data: [] });
    render(<ActiveSessionsPanel />);
    await waitFor(() => screen.getByText(/no active sessions/i));
    expect(screen.getByRole('button', { name: /sign out everywhere/i })).toBeDisabled();
  });

  it('opens the confirm dialog before signing out everywhere', async () => {
    mockGet.mockResolvedValue({ data: [session({ jti: 'a' })] });
    render(<ActiveSessionsPanel />);
    await waitFor(() => screen.getByTestId('session-row-a'));

    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    // The shared ConfirmDialog renders a heading with the title.
    expect(await screen.findByRole('heading', { name: /sign out of every device\?/i })).toBeInTheDocument();
    // DELETE is NOT called until the user confirms.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('surfaces a per-row error when a single revoke fails (does not crash)', async () => {
    mockGet.mockResolvedValueOnce({ data: [session({ jti: 'a' })] });
    mockDelete.mockRejectedValueOnce(new Error('forbidden'));

    render(<ActiveSessionsPanel />);
    await waitFor(() => screen.getByTestId('session-row-a'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Revoke session on/ }));
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/forbidden/);
    });
  });
});
