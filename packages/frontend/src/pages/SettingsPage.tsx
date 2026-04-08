import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface AuthConfigData {
  provider: string;
  providerName: string;
  oidcConfigured: boolean;
  issuerUrl: string;
  clientId: string;
}

interface AuthConfigResponse {
  success: boolean;
  data: AuthConfigData;
}

// The form uses "display" provider values (dev, microsoft, okta)
// which map to the backend's provider types (dev, oidc)
type DisplayProvider = 'dev' | 'microsoft' | 'okta';

function displayProviderToBackend(dp: DisplayProvider): string {
  if (dp === 'microsoft' || dp === 'okta') return 'oidc';
  return 'dev';
}

function backendToDisplayProvider(backendProvider: string, issuerUrl: string): DisplayProvider {
  if (backendProvider !== 'oidc') return 'dev';
  if (issuerUrl.includes('microsoftonline.com') || issuerUrl.includes('login.microsoft')) return 'microsoft';
  if (issuerUrl.includes('okta.com')) return 'okta';
  // Default to microsoft if OIDC is active but issuer doesn't match known patterns
  return 'microsoft';
}

export default function SettingsPage() {
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  // Auth settings state
  const [currentProvider, setCurrentProvider] = useState<DisplayProvider>('dev');
  const [currentIssuerUrl, setCurrentIssuerUrl] = useState<string>('');
  const [currentClientId, setCurrentClientId] = useState<string>('');
  const [authLoading, setAuthLoading] = useState(true);

  // Auth config form state
  const [formProvider, setFormProvider] = useState<DisplayProvider>('dev');
  const [formIssuerUrl, setFormIssuerUrl] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [authSaving, setAuthSaving] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await apiClient.get<{ aiConfigured: boolean }>('/health/config');
        setAiConfigured(res.aiConfigured);
      } catch { /* */ }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadAuthConfig() {
      try {
        const res = await apiClient.get<AuthConfigResponse>('/auth/config');
        const config = res.data;
        const dp = backendToDisplayProvider(config.provider, config.issuerUrl || '');
        setCurrentProvider(dp);
        setCurrentIssuerUrl(config.issuerUrl || '');
        setCurrentClientId(config.clientId || '');
        setFormProvider(dp);
        setFormIssuerUrl(config.issuerUrl || '');
        setFormClientId(config.clientId || '');
      } catch {
        // Default to dev mode if config endpoint not available
        setCurrentProvider('dev');
      } finally {
        setAuthLoading(false);
      }
    }
    loadAuthConfig();
  }, []);

  const isOidc = formProvider === 'microsoft' || formProvider === 'okta';

  const handleSaveAuth = async () => {
    setAuthSaving(true);
    setAuthError('');
    setAuthSuccess(false);

    if (isOidc && !formIssuerUrl.trim()) {
      setAuthError('Issuer URL is required for OIDC providers');
      setAuthSaving(false);
      return;
    }
    if (isOidc && !formClientId.trim()) {
      setAuthError('Client ID is required for OIDC providers');
      setAuthSaving(false);
      return;
    }

    try {
      await apiClient.put('/auth/config', {
        provider: displayProviderToBackend(formProvider),
        oidcIssuer: isOidc ? formIssuerUrl.trim() : undefined,
        oidcClientId: isOidc ? formClientId.trim() : undefined,
      });
      setCurrentProvider(formProvider);
      setCurrentIssuerUrl(isOidc ? formIssuerUrl.trim() : '');
      setCurrentClientId(isOidc ? formClientId.trim() : '');
      setAuthSuccess(true);
      setTimeout(() => setAuthSuccess(false), 3000);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to save authentication configuration');
    } finally {
      setAuthSaving(false);
    }
  };

  const providerDisplayName = (provider: DisplayProvider) => {
    switch (provider) {
      case 'dev': return 'Dev Mode';
      case 'microsoft': return 'Microsoft Entra ID';
      case 'okta': return 'Okta';
      default: return provider;
    }
  };

  const maskValue = (value: string) => {
    if (!value) return '';
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</h1>

      {/* Authentication Section */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Authentication</h2>

        {authLoading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Loading auth configuration...</p>
        ) : (
          <>
            {/* Current Provider Status */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Current provider:</span>
                <span style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  padding: '2px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: currentProvider === 'dev' ? '#fffbeb' : '#f0fdf4',
                  color: currentProvider === 'dev' ? '#d97706' : 'var(--color-success)',
                  border: `1px solid ${currentProvider === 'dev' ? '#fde68a' : '#bbf7d0'}`,
                }}>
                  {providerDisplayName(currentProvider)}
                </span>
              </div>

              {currentProvider === 'dev' && (
                <p style={{ fontSize: '0.8125rem', color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', marginTop: '0.5rem' }}>
                  Development mode is active. This is not suitable for production use.
                </p>
              )}

              {currentProvider !== 'dev' && currentIssuerUrl && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Issuer URL:</span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {currentIssuerUrl}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Client ID:</span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {maskValue(currentClientId)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'var(--color-border)', marginBottom: '1.5rem' }} />

            {/* Configure SSO Form */}
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '1rem' }}>Configure SSO</h3>

            {authError && (
              <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8125rem' }}>
                {authError}
              </div>
            )}

            {authSuccess && (
              <div style={{ color: 'var(--color-success)', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8125rem' }}>
                Authentication configuration saved successfully.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Provider Dropdown */}
              <div>
                <label style={labelStyle}>Provider</label>
                <select
                  value={formProvider}
                  onChange={(e) => {
                    setFormProvider(e.target.value as DisplayProvider);
                    setAuthError('');
                  }}
                  style={inputStyle}
                >
                  <option value="dev">Dev Mode</option>
                  <option value="microsoft">Microsoft Entra ID (OIDC)</option>
                  <option value="okta">Okta (OIDC)</option>
                </select>
              </div>

              {/* OIDC Fields */}
              {isOidc && (
                <>
                  <div>
                    <label style={labelStyle}>OIDC Issuer URL</label>
                    <input
                      type="url"
                      placeholder={formProvider === 'microsoft'
                        ? 'https://login.microsoftonline.com/{tenant-id}/v2.0'
                        : 'https://your-org.okta.com/oauth2/default'
                      }
                      value={formIssuerUrl}
                      onChange={(e) => {
                        setFormIssuerUrl(e.target.value);
                        setAuthError('');
                      }}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>OIDC Client ID</label>
                    <input
                      type="text"
                      placeholder="Enter your client ID"
                      value={formClientId}
                      onChange={(e) => {
                        setFormClientId(e.target.value);
                        setAuthError('');
                      }}
                      style={inputStyle}
                    />
                  </div>
                </>
              )}

              {/* Save Button */}
              <div>
                <button
                  onClick={handleSaveAuth}
                  disabled={authSaving}
                  style={{
                    padding: '0.5rem 1.5rem',
                    background: authSaving ? '#6b7280' : 'var(--color-primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: authSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {authSaving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* API Configuration */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>API Configuration</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Anthropic API Key:</span>
          {aiConfigured === null ? (
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Checking...</span>
          ) : aiConfigured ? (
            <span style={{ fontSize: '0.75rem', fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-sm)', backgroundColor: '#f0fdf4', color: 'var(--color-success)' }}>Configured</span>
          ) : (
            <span style={{ fontSize: '0.75rem', fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-sm)', backgroundColor: '#fef2f2', color: 'var(--color-error)' }}>Not configured</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
          Set ANTHROPIC_API_KEY in your .env file to enable AI features (template generation, suggestions, chat).
        </p>
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  padding: '1.5rem',
  maxWidth: 600,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
  marginBottom: '0.375rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.875rem',
  outline: 'none',
  boxSizing: 'border-box',
  background: 'var(--color-surface)',
};
