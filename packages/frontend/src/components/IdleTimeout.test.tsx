/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// IdleTimeout imports apiClient via the @-alias. vitest's vi.mock
// can't always resolve @-aliased paths consistently, so we spy on
// the real apiClient.post instead of swapping out the whole module.
// The spy intercepts the network call without taking the module
// resolution risk.
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';
import IdleTimeout from './IdleTimeout';

const mockPost = vi.spyOn(apiClient, 'post');

// IdleTimeout reads VITE_IDLE_TIMEOUT_MINUTES at function-call time
// (not module init), so each test sets it just-in-time. The default
// is 30; tests shrink it via stub so the warning fires after seconds
// rather than minutes of fake-timer travel.

function signIn() {
  useAuthStore.setState({
    user: { sub: 'u1', email: 'a@x.io', name: 'Test', role: 'VIEWER', orgId: 'o1' } as unknown as User,
    accessToken: 'access', refreshToken: 'refresh',
    isAuthenticated: true, sessionExpiresAt: Date.now() + 1e6,
  });
}

function signOut() {
  useAuthStore.setState({
    user: null, accessToken: null, refreshToken: null,
    isAuthenticated: false, sessionExpiresAt: null,
  });
}

function renderTimeout() {
  return render(
    <MemoryRouter>
      <IdleTimeout />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Shrink the idle timeout to 2 minutes so the warning window opens
  // 60s after "no activity"; tests fast-forward fake timers past that.
  // The component reads via import.meta.env first and falls back to
  // process.env — vi.stubEnv writes to process.env, which the fallback
  // path picks up.
  vi.stubEnv('VITE_IDLE_TIMEOUT_MINUTES', '2');
  // Pin Date.now() to a fixed point so advancing fake timers also
  // advances the clock the component reads.
  vi.useFakeTimers({ now: new Date('2026-06-05T12:00:00Z') });
  signOut();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('IdleTimeout — not authenticated', () => {
  it('renders nothing when no user is signed in', () => {
    const { container } = renderTimeout();
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders nothing even after the idle window passes (no timer churn)', () => {
    const { container } = renderTimeout();
    act(() => { vi.advanceTimersByTime(120 * 1000); });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('IdleTimeout — warning banner', () => {
  // Idle = 2 min (120s), warning window opens at idle - 60s = 60s.
  // Logout fires at 120s. Tests advance to 65s to land safely inside
  // the warning window but well before logout.
  beforeEach(() => { signIn(); });

  it('does not show the warning immediately after sign-in', () => {
    renderTimeout();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the warning banner once the idle window enters the WARNING_SECONDS tail', () => {
    renderTimeout();
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/about to be signed out/i)).toBeInTheDocument();
  });

  it('the warning dismisses when the user interacts ("Keep me signed in")', () => {
    renderTimeout();
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep me signed in/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('the warning dismisses on any window activity event', () => {
    renderTimeout();
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('keydown')); });
    // Next tick — the visible state should drop the warning.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('IdleTimeout — logout', () => {
  beforeEach(() => { signIn(); });

  it('calls /auth/logout and clears local state once the full idle window elapses', async () => {
    mockPost.mockResolvedValue(undefined);
    renderTimeout();

    // Push past idleMs (120s for the 2-minute test setting).
    await act(async () => {
      vi.advanceTimersByTime(125_000);
      // Flush microtasks so the awaited apiClient.post resolves.
      await Promise.resolve();
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('still clears local state when /auth/logout rejects (network down)', async () => {
    mockPost.mockRejectedValue(new Error('network down'));
    renderTimeout();
    await act(async () => {
      vi.advanceTimersByTime(125_000);
      await Promise.resolve();
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('does not call /auth/logout when there is no refresh token (e.g. dev sessions)', async () => {
    useAuthStore.setState({ refreshToken: null });
    renderTimeout();
    await act(async () => {
      vi.advanceTimersByTime(125_000);
      await Promise.resolve();
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('IdleTimeout — env override', () => {
  it('falls back to the 30-minute default when VITE_IDLE_TIMEOUT_MINUTES is missing', () => {
    vi.unstubAllEnvs();
    signIn();
    renderTimeout();
    // At 5 minutes idle nothing should be showing (warning window
    // wouldn't open until minute 29).
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('rejects a malformed env value and uses the default', () => {
    vi.stubEnv('VITE_IDLE_TIMEOUT_MINUTES', 'not-a-number');
    signIn();
    renderTimeout();
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
