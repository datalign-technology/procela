import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { errorMessage } from '@/lib/errorToast';

// API base — matches the one apiClient builds. Kept here as a single
// reference so a future env change doesn't require touching this file.
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// ──────────────────────────────────────────────────────────────────────────
// OidcCompletePage — the landing route after a successful OIDC
// authorization-code flow. The backend's /api/v1/auth/callback
// redirects here with tokens in the URL FRAGMENT:
//
//   /oidc-complete#accessToken=…&refreshToken=…&expiresIn=…&returnTo=/
//
// Fragments aren't sent in subsequent HTTP requests and don't appear
// in proxy / CDN logs, so they're a safer carrier for short-lived
// tokens than query strings. We read the fragment once, hydrate the
// auth store, and replace the URL so the tokens don't sit in the
// address bar.
//
// The user record itself isn't in the redirect — we fetch /auth/me
// with the new access token so authStore.login() gets a fully
// populated User. Pulls the org / name / role from the People record
// rather than re-deriving from id_token claims, keeping the OIDC
// path consistent with every other login.
// ──────────────────────────────────────────────────────────────────────────

export default function OidcCompletePage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const expiresIn = parseInt(params.get('expiresIn') || '0', 10);
    const returnTo = params.get('returnTo') || '/';

    // Strip the fragment from the address bar immediately so the
    // tokens stop being visible to the user / bookmarks / dev tools.
    window.history.replaceState({}, '', window.location.pathname);

    if (!accessToken || !refreshToken || !expiresIn) {
      setError('Missing tokens on OIDC callback');
      return;
    }

    // Fetch the user record with the new access token. Direct fetch
    // here — apiClient pulls the bearer from authStore, but the store
    // isn't populated yet (this whole component exists to populate
    // it), so we have to pass the new token explicitly.
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`auth/me failed (${res.status})`);
        const json = await res.json();
        const u = json.data;
        login(
          {
            id: u.sub,
            orgId: u.orgId,
            name: u.name,
            email: u.email,
            role: u.role,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          accessToken,
          refreshToken,
          expiresIn,
        );
        navigate(returnTo, { replace: true });
      } catch (err) {
      setError(errorMessage(err, 'Failed to complete sign-in'));
      }
    })();
  }, [login, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f9f7 0%, #f8fafc 50%, #f0f4f8 100%)',
      padding: '1rem',
    }}>
      <div style={{
        textAlign: 'center', padding: '2rem',
        background: '#fff', borderRadius: 12,
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)',
        maxWidth: 400,
      }}>
        {error ? (
          <>
            <div style={{ color: 'var(--color-error)', fontWeight: 600, marginBottom: 8 }}>Sign-in failed</div>
            <div style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>{error}</div>
            <a href="/login" style={{ color: '#0f4f46', textDecoration: 'underline' }}>Back to sign-in</a>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
              Completing sign-in…
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              You'll be redirected in a moment.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
