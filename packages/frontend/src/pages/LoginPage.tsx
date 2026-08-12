import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { errorMessage } from '@/lib/errorToast';
import { useAuthStore } from '@/stores/authStore';
import CaptchaPrompt from '@/components/CaptchaPrompt';
import Spinner from '@/components/Spinner';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AuthProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

interface ProvidersResponse {
  success: boolean;
  data: {
    /** The provider type currently configured for the org — drives
     *  which login methods are rendered. One of: 'dev' | 'local' |
     *  'oidc' | 'saml'. */
    current: string;
    providers: AuthProvider[];
  };
}

interface LoginResponse {
  success: boolean;
  data: {
    /** Set by the backend when the user has enrolled in MFA. Instead
     *  of access + refresh tokens, the login response carries this
     *  short-lived opaque token + a `mfaRequired: true` flag. The
     *  frontend prompts for a TOTP / backup code and POSTs both to
     *  /auth/mfa/login-verify, which returns the real session.
     *  Mutually exclusive with the standard accessToken/refreshToken
     *  shape — one or the other is present, never both. */
    mfaRequired?: boolean;
    mfaToken?: string;

    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    /** Set by the backend when the Local provider issued a temporary
     *  password (admin reset or dev→local migration). The session is
     *  still issued so the change-password endpoint is reachable; the
     *  frontend should block normal navigation and force a change. */
    passwordMustChange?: boolean;
    /** Surface from the MFA login-verify response so the UI can nudge
     *  a regen when the user is running low on backup codes. */
    backupCodesRemaining?: number;
    user?: {
      sub: string;
      email: string;
      name: string;
      orgId: string;
      role: string;
    };
  };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [currentProviderType, setCurrentProviderType] = useState<string>('dev');
  const [providersLoading, setProvidersLoading] = useState(true);
  // Forced-change state. When the login response carries
  // passwordMustChange=true, we hold off navigating and surface a
  // modal that requires the user to set a new password before
  // continuing. The current (temporary) password is kept in state so
  // the change-password endpoint can re-verify it without asking the
  // user to type it again.
  const [forcedChange, setForcedChange] = useState<{ currentPassword: string } | null>(null);
  // MFA gate: once the password check succeeds and the user has TOTP
  // enrolled, /auth/login returns mfaRequired: true + an opaque
  // mfaToken instead of issuing a session. We hold the token + the
  // password (so forced-change still works if needed) and show the
  // 6-digit prompt until login-verify clears the gate.
  const [mfaPending, setMfaPending] = useState<{
    token: string;
    currentPassword?: string;
    availableFactors?: { totp: boolean; webauthn: boolean };
  } | null>(null);
  // CAPTCHA gate: once the backend has seen enough failures from
  // this IP it returns challengeRequired=true on every subsequent
  // attempt. We render a tiny "confirm you're human" prompt and
  // include the resulting token on the next login post.
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  // Forgot-password modal state.
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  // Accessibility: focus-trap the forgot-password modal while it's open,
  // and let Esc dismiss it.
  const forgotRef = useRef<HTMLDivElement>(null);
  useFocusTrap(forgotRef, forgotOpen);
  useEffect(() => {
    if (!forgotOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setForgotOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [forgotOpen]);

  // Surface a back-channel error from the OIDC callback. When the
  // backend hits a problem (state mismatch, token-exchange failure,
  // unsigned id_token) it redirects here with ?error=…; we lift that
  // into the page-level error banner and clear the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      setError(err);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await apiClient.get<ProvidersResponse>('/auth/providers');
        setProviders(res.data.providers);
        setCurrentProviderType(res.data.current || 'dev');
      } catch {
        // If the endpoint is not available, default to dev mode only
        setProviders([{ id: 'dev', name: 'Dev Mode', type: 'dev', enabled: true }]);
        setCurrentProviderType('dev');
      } finally {
        setProvidersLoading(false);
      }
    }
    fetchProviders();
  }, []);

  // Per-tenant branding — resolve the tenant from ?tenant=slug on
  // the URL first (works on any dev + local host), then let the
  // backend fall back to the Host-header subdomain in production.
  // Silent failure → the sign-in card just renders the platform
  // default, which is fine.
  type TenantBrand = {
    tenantSlug: string | null;
    displayName: string;
    glyph: string;
    ssoButtonLabel: string;
    primaryColor: string;
    isTenantBrand: boolean;
  };
  const [tenantBrand, setTenantBrand] = useState<TenantBrand | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tenant');
    const path = q ? `/branding/tenant/${encodeURIComponent(q)}` : '/branding/tenant';
    apiClient.get<{ success: boolean; data: TenantBrand }>(path)
      .then((r) => setTenantBrand(r.data))
      .catch(() => { /* leave default */ });
  }, []);

  // Show only the auth method the org has configured (set in
  // Settings → Authentication). The backend still surfaces every
  // configured OIDC provider so multi-IdP orgs render all their
  // SSO buttons; everything else is gated on `currentProviderType`.
  const showDev = currentProviderType === 'dev';
  const showLocal = currentProviderType === 'local';
  const showSso = currentProviderType === 'oidc' || currentProviderType === 'saml';
  const devProvider = showDev ? providers.find((p) => p.type === 'dev') : undefined;
  const localProvider = showLocal ? providers.find((p) => p.type === 'local') : undefined;
  const ssoProviders = showSso
    ? providers.filter((p) => (p.type === 'oidc' || p.type === 'saml') && p.enabled)
    : [];

  const completeLogin = (
    data: LoginResponse['data'],
    loginPassword?: string,
  ) => {
    const { accessToken, refreshToken, expiresIn, user, passwordMustChange } = data;
    if (!accessToken || !refreshToken || !expiresIn || !user) {
      setError('Login response was incomplete');
      return;
    }
    login(
      {
        id: user.sub,
        orgId: user.orgId,
        name: user.name,
        email: user.email,
        role: user.role as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      accessToken,
      refreshToken,
      expiresIn,
    );
    if (passwordMustChange && loginPassword) {
      setForcedChange({ currentPassword: loginPassword });
    } else {
      navigate('/');
    }
  };

  const loginWithEmail = async (loginEmail: string, loginName?: string, loginPassword?: string, loginRole?: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', {
        email: loginEmail,
        name: loginName || undefined,
        password: loginPassword || undefined,
        // Dev-mode only. The backend's DevAuthProvider honours the
        // role field when a People-store lookup doesn't override it,
        // so test-account buttons that advertise "Super Admin"
        // actually produce a SUPER_ADMIN session on a fresh install
        // (before any People CSV import). Without this, the dev
        // provider fell back to ORG_ADMIN and Eleanor lost half of
        // the admin surface.
        role: loginRole || undefined,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // MFA gate: the user has TOTP enrolled, so the backend issued
      // an opaque mfaToken instead of a session. Hold the password
      // (for forced-change after MFA clears) and show the code prompt.
      if (res.data.mfaRequired && res.data.mfaToken) {
        const dataWithFactors = res.data as typeof res.data & { availableFactors?: { totp: boolean; webauthn: boolean } };
        setMfaPending({
          token: res.data.mfaToken,
          currentPassword: loginPassword,
          availableFactors: dataWithFactors.availableFactors,
        });
        return;
      }
      // Successful login — clear any captcha state for the next session.
      setCaptchaRequired(false);
      setCaptchaToken('');
      completeLogin(res.data, loginPassword);
    } catch (err) {
      // 401 / 428 may include challengeRequired — the user needs to
      // solve a CAPTCHA before the next attempt will be processed.
      // captchaSiteKey lets us know whether the backend is wired to
      // hCaptcha (non-empty) or running in dev mode (empty, accept
      // any non-empty token).
      const e = err as { body?: { challengeRequired?: boolean; captchaSiteKey?: string }; message?: string };
      const responseBody = e.body || {};
      if (responseBody.challengeRequired) {
        setCaptchaRequired(true);
        setCaptchaSiteKey(responseBody.captchaSiteKey || '');
        setCaptchaToken('');
      }
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    await loginWithEmail(email.trim());
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    await loginWithEmail(email.trim(), undefined, password);
  };

  // Passwordless WebAuthn login. Runs the discoverable-credential
  // ceremony — the browser surfaces every registered key for this
  // RP and lets the user pick. The assertion carries the userHandle
  // (Procela personId) so the backend identifies the user without
  // an email-first lookup.
  const signInWithSecurityKey = async () => {
    setError('');
    setLoading(true);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      // WebAuthn options are an opaque browser-standard shape; the
      // library re-serialises them and we only pass them through.
      const startRes = await apiClient.post<{ data: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
        '/auth/webauthn/discoverable/login-start', {});
      const assertion = await startAuthentication({ optionsJSON: startRes.data });
      const finishRes = await apiClient.post<LoginResponse>(
        '/auth/webauthn/discoverable/login-finish', { response: assertion });
      completeLogin(finishRes.data);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
        // User dismissed the browser prompt — silent.
        return;
      }
      setError(e.message || 'Could not sign in with a security key');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    try {
      // Always returns 204 from the backend regardless of whether the
      // email matched — same UX either way so we don't leak existence.
      await apiClient.post('/auth/password/forgot', { email: forgotEmail.trim() });
    } catch { /* */ }
    setForgotSubmitted(true);
  };

  const handleSsoClick = async (provider: AuthProvider | undefined) => {
    if (!provider || !provider.enabled) return;
    setError('');
    setLoading(true);
    try {
      // POST hints which OIDC variant (microsoft / okta) so the backend
      // can route to the right configured provider. The backend mints
      // state + PKCE + nonce, stashes them, and returns the IdP's
      // authorization URL. We then hand the browser off to the IdP —
      // it'll come back to /api/v1/auth/callback which redirects to
      // our /oidc-complete with tokens in the URL fragment.
      const res = await apiClient.post<{ success: boolean; data: { loginUrl: string } }>(
        '/auth/login',
        { providerId: provider.id, returnTo: '/' },
      );
      if (res.data?.loginUrl) {
        window.location.href = res.data.loginUrl;
      } else {
        setError('Failed to start SSO sign-in');
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to start SSO sign-in'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Brand mark — icon image + wordmark text as separate
            elements, so the composition centers cleanly regardless of
            whatever padding lives inside the icon PNG. On a tenant-
            branded page (?tenant=<slug> or matching subdomain) the
            wordmark switches to the customer's display name and the
            emoji glyph replaces the icon. */}
        <div style={styles.brandMark}>
          {tenantBrand?.isTenantBrand && tenantBrand.glyph ? (
            <span aria-hidden="true" style={{ ...styles.brandIcon, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>
              {tenantBrand.glyph}
            </span>
          ) : (
            <img
              src="/procela-icon.png"
              alt=""
              aria-hidden="true"
              style={styles.brandIcon}
            />
          )}
          <span style={styles.brandWordmark}>
            {tenantBrand?.displayName || 'Procela'}
          </span>
        </div>
        {/* Attribution line — reads "Powered by Procela" when we're
            on a tenant-branded card so the platform stays credited
            without dominating the sign-in surface. */}
        {tenantBrand?.isTenantBrand && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)', marginTop: -4, marginBottom: 12 }}>
            Powered by Procela
          </div>
        )}

        {/* Heading — wordmark above already carries the brand, so
            this just states the action. */}
        <h1 style={styles.heading}>Sign in</h1>
        <p style={styles.subheading}>
          Choose your authentication method to continue
        </p>

        {/* Error banner */}
        {error && (
          <div style={styles.errorBanner}>
            {error}
          </div>
        )}

        {/* CAPTCHA prompt — visible after enough failures from this IP.
            When HCAPTCHA_SITE_KEY is configured server-side, render
            the hCaptcha widget; otherwise fall back to a single
            "confirm you're human" button (dev / no-hCaptcha path). */}
        {captchaRequired && (
          <CaptchaPrompt
            siteKey={captchaSiteKey}
            token={captchaToken}
            onToken={setCaptchaToken}
          />
        )}

        {providersLoading ? (
          <Spinner label="Loading…" />
        ) : (
          <>
            {/* SSO Providers — rendered only when the configured
                auth method is OIDC or SAML. Each configured IdP gets
                its own button; well-known issuers (Microsoft, Okta)
                get their branded icon, everything else gets a
                neutral key glyph. */}
            {ssoProviders.length > 0 && (
              <div style={styles.ssoSection}>
                {ssoProviders.map((p, ssoIdx) => {
                  const isMs = p.id === 'microsoft' || /microsoft|entra|azure/i.test(p.name);
                  const isOkta = p.id === 'okta' || /okta/i.test(p.name);
                  const brandStyle = isMs ? styles.microsoftButton : isOkta ? styles.oktaButton : {};
                  // On a tenant-branded page, the FIRST SSO button gets
                  // the customer's own label ("Sign in with Corp SSO")
                  // and their primary color. Additional providers keep
                  // their built-in branding so users can still tell
                  // Microsoft vs Okta apart at a glance.
                  const useTenantLabel = ssoIdx === 0 && tenantBrand?.isTenantBrand;
                  const buttonLabel = useTenantLabel ? tenantBrand.ssoButtonLabel : `Sign in with ${p.name}`;
                  const tenantAccent = useTenantLabel && tenantBrand?.primaryColor
                    ? { background: tenantBrand.primaryColor, color: '#fff', border: 'none' as const }
                    : {};
                  return (
                    <button
                      key={p.id}
                      style={{ ...styles.ssoButton, ...brandStyle, ...tenantAccent }}
                      onClick={() => handleSsoClick(p)}
                      title={buttonLabel}
                    >
                      <span style={styles.ssoIcon}>
                        {isMs ? (
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <rect x="1" y="1" width="8.5" height="8.5" fill="#F25022" />
                            <rect x="10.5" y="1" width="8.5" height="8.5" fill="#7FBA00" />
                            <rect x="1" y="10.5" width="8.5" height="8.5" fill="#00A4EF" />
                            <rect x="10.5" y="10.5" width="8.5" height="8.5" fill="#FFB900" />
                          </svg>
                        ) : isOkta ? (
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="9" stroke="#007DC1" strokeWidth="2" fill="none" />
                            <circle cx="10" cy="10" r="4" fill="#007DC1" />
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="8" cy="15" r="4" />
                            <path d="M10.85 12.15 19 4" />
                            <path d="m18 5 2 2" />
                            <path d="m15 8 2 2" />
                          </svg>
                        )}
                      </span>
                      <span>{buttonLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Local credentials (email + password). Only shown when
                the backend reports the Local provider as the active
                one. Otherwise the email/password fields would invite
                users to type credentials into the dev-mode flow that
                ignores them. */}
            {localProvider && (
              <>
                <form onSubmit={handleLocalLogin} style={styles.devForm} autoComplete="on">
                  <input
                    type="email"
                    name="login-email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    style={styles.input}
                  />
                  <input
                    type="password"
                    name="login-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    style={styles.input}
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      ...styles.devSubmitButton,
                      ...(loading ? styles.devSubmitButtonDisabled : {}),
                    }}
                  >
                    {loading ? 'Signing in...' : 'Sign in'}
                  </button>
                </form>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    onClick={signInWithSecurityKey}
                    disabled={loading}
                    style={{ background: 'none', border: 'none', color: '#0f4f46', fontSize: 12, cursor: loading ? 'default' : 'pointer', padding: 0, textDecoration: 'underline' }}
                    title="Sign in with a registered security key — no email or password needed."
                  >
                    Sign in with a security key
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setForgotOpen(true); setForgotSubmitted(false); }}
                    style={{ background: 'none', border: 'none', color: '#0f4f46', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    Forgot password?
                  </button>
                </div>
              </>
            )}

            {devProvider && (
              <>
                {/* Dev Mode */}
                <div style={styles.devSection}>
                  <div style={styles.devBadge}>
                    <span style={styles.devBadgeIcon}>&#9881;</span>
                    Dev Mode
                  </div>
                  <form onSubmit={handleDevLogin} style={styles.devForm} autoComplete="off">
                    <input
                      type="email"
                      name="login-email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      style={styles.input}
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      style={{
                        ...styles.devSubmitButton,
                        ...(loading ? styles.devSubmitButtonDisabled : {}),
                      }}
                    >
                      {loading ? 'Signing in...' : 'Sign in'}
                    </button>
                  </form>

                  {/* Quick test logins */}
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Accounts</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { email: 'eleanor.briggs@tidewater-utilities.com', name: 'Eleanor Briggs', label: 'Super Admin', role: 'SUPER_ADMIN' },
                        { email: 'susan.chen@tidewater-utilities.com',     name: 'Susan Chen',     label: 'Editor',      role: 'EDITOR' },
                      ].map((acct) => (
                        <button
                          key={acct.email}
                          type="button"
                          disabled={loading}
                          onClick={() => loginWithEmail(acct.email, acct.name, undefined, acct.role)}
                          style={{
                            flex: 1, minWidth: 140, padding: '8px 12px', borderRadius: 6,
                            border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer',
                            textAlign: 'left', fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{acct.name}</div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{acct.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Footer */}
        <p style={styles.footer}>
          Procela — Process Intelligence Platform
        </p>
      </div>

      {/* Forced-change modal — blocks until the user picks a new
          password. The current (temporary) password is held in state
          so the user doesn't have to retype it. */}
      {forcedChange && (
        <ForcedChangeModal
          currentPassword={forcedChange.currentPassword}
          onDone={() => { setForcedChange(null); navigate('/'); }}
        />
      )}

      {/* MFA / TOTP prompt — shown when /auth/login returned
          mfaRequired:true. Locks the page until the user supplies
          a valid code (or backup code); on success the real session
          is issued and we navigate (or hand off to the forced-change
          modal if the password also needs rotation). */}
      {mfaPending && (
        <MfaPromptModal
          mfaToken={mfaPending.token}
          availableFactors={mfaPending.availableFactors || { totp: true, webauthn: false }}
          onSuccess={(data) => {
            const pwd = mfaPending.currentPassword;
            setMfaPending(null);
            completeLogin(data, pwd);
          }}
          onCancel={() => setMfaPending(null)}
        />
      )}

      {/* Forgot-password modal — fire-and-forget POST to /password/forgot.
          The backend always returns 204; we acknowledge the submission
          without confirming whether the email matched. */}
      {forgotOpen && (
        <div style={styles.modalScrim} onClick={() => setForgotOpen(false)}>
          <div ref={forgotRef} role="dialog" aria-modal="true" aria-label="Reset password" style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            {!forgotSubmitted ? (
              <>
                <div style={styles.modalTitle}>Reset your password</div>
                <p style={styles.modalText}>
                  Enter the email address tied to your Procela account. If we
                  recognise it, we'll send instructions for setting a new
                  password.
                </p>
                <form onSubmit={handleForgotSubmit}>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    autoFocus
                    style={styles.input}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" onClick={() => setForgotOpen(false)} style={styles.modalSecondary}>Cancel</button>
                    <button type="submit" style={styles.modalPrimary}>Send instructions</button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div style={styles.modalTitle}>Check your email</div>
                <p style={styles.modalText}>
                  If <strong>{forgotEmail}</strong> matches an active account,
                  you'll receive instructions for setting a new password
                  shortly.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" onClick={() => setForgotOpen(false)} style={styles.modalPrimary}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ForcedChangeModal — pops after a Local-provider login when the
// backend reports passwordMustChange=true. The session is already
// active (the access token was stored by useAuthStore.login()), but
// the user is held here until they pick a real password — navigation
// is gated behind a successful change.
// ──────────────────────────────────────────────────────────────────────────

function ForcedChangeModal({ currentPassword, onDone }: {
  currentPassword: string;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Accessibility: trap focus in this forced flow. No Esc / dismiss —
  // the user must set a new password before continuing.
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (newPassword !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post('/auth/password', { currentPassword, newPassword });
      onDone();
    } catch (e) {
      setErr(errorMessage(e, 'Failed to set a new password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.modalScrim}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label="Change your password" style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>Set a new password</div>
        <p style={styles.modalText}>
          Your account is using a temporary password. Choose a new one
          before continuing — at least 12 characters; password must not be
          on the common-breach list.
        </p>
        {err && <div style={styles.errorBanner}>{err}</div>}
        <form onSubmit={submit}>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            required
            autoComplete="new-password"
            autoFocus
            style={styles.input}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            required
            autoComplete="new-password"
            style={{ ...styles.input, marginTop: 8 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="submit" disabled={busy} style={styles.modalPrimary}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f9f7 0%, #f8fafc 50%, #f0f4f8 100%)',
    padding: '1rem',
  },
  card: {
    textAlign: 'center',
    padding: '2.5rem 2.5rem 2rem',
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 10px 15px -3px rgba(0, 0, 0, 0.05)',
    maxWidth: '440px',
    width: '100%',
    border: '1px solid #e2e8f0',
  },
  brandMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '1.5rem',
  },
  brandIcon: {
    height: '40px',
    width: '40px',
    objectFit: 'contain' as const,
    flexShrink: 0,
  },
  brandWordmark: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  heading: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: '0.5rem',
    letterSpacing: '-0.025em',
  },
  subheading: {
    fontSize: '0.875rem',
    color: '#64748b',
    marginBottom: '2rem',
  },
  errorBanner: {
    color: 'var(--color-error)',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '0.625rem 1rem',
    marginBottom: '1rem',
    fontSize: '0.875rem',
    textAlign: 'left' as const,
  },
  loadingText: {
    fontSize: '0.875rem',
    color: '#94a3b8',
    padding: '2rem 0',
  },
  ssoSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  ssoButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    width: '100%',
    padding: '0.75rem 1.25rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.9375rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    position: 'relative' as const,
  },
  microsoftButton: {
    background: '#0078d4',
    color: '#ffffff',
  },
  oktaButton: {
    background: '#ffffff',
    color: '#1e293b',
    border: '2px solid #007DC1',
  },
  ssoButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  ssoIcon: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  comingSoonBadge: {
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(0,0,0,0.1)',
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    margin: '1.5rem 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: '#e2e8f0',
  },
  dividerText: {
    fontSize: '0.8125rem',
    color: '#94a3b8',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  devSection: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '1.25rem',
  },
  devBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--color-warning)',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    padding: '0.25rem 0.625rem',
    marginBottom: '1rem',
  },
  devBadgeIcon: {
    fontSize: '0.8125rem',
  },
  devForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.625rem',
  },
  input: {
    width: '100%',
    padding: '0.625rem 0.875rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.9375rem',
    outline: 'none',
    boxSizing: 'border-box' as const,
    background: '#ffffff',
    transition: 'border-color 0.15s ease',
  },
  devSubmitButton: {
    width: '100%',
    padding: '0.625rem 1.25rem',
    background: '#1a7a6d',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.9375rem',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '0.25rem',
  },
  devSubmitButtonDisabled: {
    background: '#6b7280',
    cursor: 'not-allowed',
  },
  footer: {
    fontSize: '0.75rem',
    color: '#94a3b8',
    marginTop: '2rem',
  },
  modalScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    zIndex: 1000,
  },
  modalCard: {
    background: '#fff',
    borderRadius: '12px',
    padding: '1.5rem',
    width: 'min(420px, 100%)',
    boxShadow: 'var(--shadow-xl)',
  },
  modalTitle: {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: '0.5rem',
  },
  modalText: {
    fontSize: '0.85rem',
    color: '#475569',
    lineHeight: 1.5,
    marginBottom: '1rem',
  },
  modalPrimary: {
    padding: '0.5rem 1rem',
    background: '#0f4f46',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  modalSecondary: {
    padding: '0.5rem 1rem',
    background: '#fff',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
};

// ──────────────────────────────────────────────────────────────────────────
// MfaPromptModal — pops after a password login when the backend says
// MFA is required. Takes a 6-digit TOTP from the user's authenticator
// app or, when they've lost access, a single-use backup code. Calls
// /auth/mfa/login-verify with whichever the user supplied; on success
// the real session payload comes back and the caller hands it to
// authStore.
// ──────────────────────────────────────────────────────────────────────────

function MfaPromptModal({ mfaToken, availableFactors, onSuccess, onCancel }: {
  mfaToken: string;
  availableFactors: { totp: boolean; webauthn: boolean };
  onSuccess: (data: LoginResponse['data']) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  // Default factor: WebAuthn if available (faster + more secure),
  // else TOTP. User can flip via the "Use … instead" link.
  const [factor, setFactor] = useState<'webauthn' | 'totp'>(
    availableFactors.webauthn ? 'webauthn' : 'totp',
  );
  // mfaToken can rotate when we call /webauthn/login-start (which
  // consumes the original and mints a fresh one). Track the current
  // valid token in state so a TOTP fallback after a WebAuthn attempt
  // still works.
  const [currentToken, setCurrentToken] = useState(mfaToken);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Accessibility: trap focus in the MFA prompt and let Esc cancel it.
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!code.trim()) return;
    setBusy(true);
    try {
      const body = useBackup
        ? { mfaToken: currentToken, backupCode: code.trim() }
        : { mfaToken: currentToken, code: code.replace(/\D/g, '') };
      const res = await apiClient.post<LoginResponse>('/auth/mfa/login-verify', body);
      onSuccess(res.data);
    } catch (e) {
      setErr(errorMessage(e, 'Invalid code'));
    } finally { setBusy(false); }
  };

  const submitWebauthn = async () => {
    setErr('');
    setBusy(true);
    try {
      // Dynamic import keeps the WebAuthn helper out of the initial
      // login bundle for users / browsers that never reach this
      // branch.
      const { startAuthentication } = await import('@simplewebauthn/browser');
      type WebauthnOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];
      const startRes = await apiClient.post<{ data: { options: WebauthnOptions; mfaToken: string } }>(
        '/auth/mfa/webauthn/login-start', { mfaToken: currentToken });
      // Update the token immediately so a fall-through to TOTP after
      // a user-cancel still has a valid handle.
      setCurrentToken(startRes.data.mfaToken);
      const assertion = await startAuthentication({ optionsJSON: startRes.data.options });
      const finishRes = await apiClient.post<LoginResponse>(
        '/auth/mfa/webauthn/login-finish',
        { mfaToken: startRes.data.mfaToken, response: assertion });
      onSuccess(finishRes.data);
    } catch (err) {
      // Browser cancel / user-dismissed-prompt — present a soft
      // fallback rather than an error banner.
      const e = err as { name?: string; message?: string };
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
        setErr('No response from the security key — try again, or use your authenticator code.');
      } else {
        setErr(e.message || 'Could not verify security key');
      }
    } finally { setBusy(false); }
  };

  return (
    <div style={styles.modalScrim}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label="Two-factor authentication" style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>
          {factor === 'webauthn'
            ? 'Use your security key'
            : useBackup
              ? 'Enter a backup code'
              : 'Two-step verification'}
        </div>
        <p style={styles.modalText}>
          {factor === 'webauthn'
            ? 'Tap the button to use your registered security key (YubiKey, Touch ID, Windows Hello).'
            : useBackup
              ? 'Backup codes are the strings you saved at enrollment. Each one works only once.'
              : 'Open your authenticator app and enter the 6-digit code it shows.'}
        </p>
        {err && <div style={styles.errorBanner}>{err}</div>}

        {factor === 'webauthn' ? (
          <div>
            <button
              type="button"
              onClick={submitWebauthn}
              disabled={busy}
              style={{ ...styles.modalPrimary, width: '100%' }}
            >
              {busy ? 'Waiting on key…' : 'Use security key'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              {availableFactors.totp && (
                <button
                  type="button"
                  onClick={() => { setFactor('totp'); setErr(''); }}
                  style={{ background: 'none', border: 'none', color: '#0f4f46', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Use authenticator code instead
                </button>
              )}
              <button type="button" onClick={onCancel} disabled={busy} style={styles.modalSecondary}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitTotp}>
            <input
              type="text"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useBackup ? 24 : 6}
              value={code}
              onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ''))}
              placeholder={useBackup ? 'Backup code' : '6-digit code'}
              required
              autoFocus
              style={styles.input}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => { setUseBackup(!useBackup); setCode(''); setErr(''); }}
                  style={{ background: 'none', border: 'none', color: '#0f4f46', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', textAlign: 'left' }}
                >
                  {useBackup ? 'Use authenticator instead' : 'Lost your authenticator? Use a backup code'}
                </button>
                {availableFactors.webauthn && (
                  <button
                    type="button"
                    onClick={() => { setFactor('webauthn'); setCode(''); setUseBackup(false); setErr(''); }}
                    style={{ background: 'none', border: 'none', color: '#0f4f46', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', textAlign: 'left' }}
                  >
                    Use a security key instead
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={onCancel} disabled={busy} style={styles.modalSecondary}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !code.trim()}
                  style={{
                    ...styles.modalPrimary,
                    opacity: (busy || !code.trim()) ? 0.6 : 1,
                    cursor: (busy || !code.trim()) ? 'default' : 'pointer',
                  }}
                >
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
