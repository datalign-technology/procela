import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

interface AuthProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

interface ProvidersResponse {
  success: boolean;
  data: {
    providers: AuthProvider[];
  };
}

interface LoginResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
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
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await apiClient.get<ProvidersResponse>('/auth/providers');
        setProviders(res.data.providers);
      } catch {
        // If the endpoint is not available, default to dev mode only
        setProviders([{ id: 'dev', name: 'Dev Mode', type: 'dev', enabled: true }]);
      } finally {
        setProvidersLoading(false);
      }
    }
    fetchProviders();
  }, []);

  const devProvider = providers.find((p) => p.type === 'dev' && p.enabled);
  const microsoftProvider = providers.find((p) => p.type === 'oidc' && p.id === 'microsoft');
  const oktaProvider = providers.find((p) => p.type === 'oidc' && p.id === 'okta');

  const loginWithEmail = async (loginEmail: string, loginName?: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', {
        email: loginEmail,
        name: loginName || undefined,
      });
      const { accessToken, refreshToken, expiresIn, user } = res.data;
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
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
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
    await loginWithEmail(email.trim(), name.trim());
  };

  const handleSsoClick = (provider: AuthProvider | undefined) => {
    if (!provider || !provider.enabled) return;
    // Future: redirect to OIDC auth URL
    // For now, SSO providers show as coming soon
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Logo */}
        <img
          src="/procela-logo.png"
          alt="Procela"
          style={styles.logo}
        />

        {/* Heading */}
        <h1 style={styles.heading}>Sign in to Procela</h1>
        <p style={styles.subheading}>
          Choose your authentication method to continue
        </p>

        {/* Error banner */}
        {error && (
          <div style={styles.errorBanner}>
            {error}
          </div>
        )}

        {providersLoading ? (
          <div style={styles.loadingText}>Loading providers...</div>
        ) : (
          <>
            {/* SSO Providers */}
            <div style={styles.ssoSection}>
              {/* Microsoft Entra ID */}
              <button
                style={{
                  ...styles.ssoButton,
                  ...styles.microsoftButton,
                  ...(microsoftProvider?.enabled ? {} : styles.ssoButtonDisabled),
                }}
                onClick={() => handleSsoClick(microsoftProvider)}
                disabled={!microsoftProvider?.enabled}
                title={!microsoftProvider?.enabled ? 'Coming soon — configure in Settings' : 'Sign in with Microsoft Entra ID'}
              >
                <span style={styles.ssoIcon}>
                  {/* Microsoft icon placeholder */}
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <rect x="1" y="1" width="8.5" height="8.5" fill="#F25022" />
                    <rect x="10.5" y="1" width="8.5" height="8.5" fill="#7FBA00" />
                    <rect x="1" y="10.5" width="8.5" height="8.5" fill="#00A4EF" />
                    <rect x="10.5" y="10.5" width="8.5" height="8.5" fill="#FFB900" />
                  </svg>
                </span>
                <span>Sign in with Microsoft Entra ID</span>
                {!microsoftProvider?.enabled && (
                  <span style={styles.comingSoonBadge}>Coming soon</span>
                )}
              </button>

              {/* Okta */}
              <button
                style={{
                  ...styles.ssoButton,
                  ...styles.oktaButton,
                  ...(oktaProvider?.enabled ? {} : styles.ssoButtonDisabled),
                }}
                onClick={() => handleSsoClick(oktaProvider)}
                disabled={!oktaProvider?.enabled}
                title={!oktaProvider?.enabled ? 'Coming soon — configure in Settings' : 'Sign in with Okta'}
              >
                <span style={styles.ssoIcon}>
                  {/* Okta icon placeholder */}
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="9" stroke="#007DC1" strokeWidth="2" fill="none" />
                    <circle cx="10" cy="10" r="4" fill="#007DC1" />
                  </svg>
                </span>
                <span>Sign in with Okta</span>
                {!oktaProvider?.enabled && (
                  <span style={styles.comingSoonBadge}>Coming soon</span>
                )}
              </button>
            </div>

            {/* Divider */}
            {devProvider && (
              <>
                <div style={styles.divider}>
                  <div style={styles.dividerLine} />
                  <span style={styles.dividerText}>or</span>
                  <div style={styles.dividerLine} />
                </div>

                {/* Dev Mode */}
                <div style={styles.devSection}>
                  <div style={styles.devBadge}>
                    <span style={styles.devBadgeIcon}>&#9881;</span>
                    Dev Mode
                  </div>
                  <form onSubmit={handleDevLogin} style={styles.devForm}>
                    <input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      style={styles.input}
                    />
                    <input
                      type="text"
                      placeholder="Full name (optional)"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
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
                        { email: 'eleanor.briggs@tidewater-utilities.com', name: 'Eleanor Briggs', role: 'Super Admin' },
                        { email: 'susan.chen@tidewater-utilities.com', name: 'Susan Chen', role: 'Editor' },
                      ].map((acct) => (
                        <button
                          key={acct.email}
                          type="button"
                          disabled={loading}
                          onClick={() => loginWithEmail(acct.email, acct.name)}
                          style={{
                            flex: 1, minWidth: 140, padding: '8px 12px', borderRadius: 6,
                            border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer',
                            textAlign: 'left', fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{acct.name}</div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{acct.role}</div>
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
  logo: {
    height: '48px',
    marginBottom: '1.5rem',
    display: 'inline-block',
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
    color: '#dc2626',
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
    color: '#d97706',
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
};
