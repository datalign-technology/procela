import { useState, useEffect, useRef, useCallback } from 'react';
import {
  startRegistration as startWebauthnRegistration,
} from '@simplewebauthn/browser';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import ConnectorsSection from '../components/ConnectorsSection';
import AiSettingsPanel from '../components/AiSettingsPanel';
import ActiveSessionsPanel from '../components/ActiveSessionsPanel';
import ResetAllDataPanel from '../components/ResetAllDataPanel';
import { useAuthStore } from '@/stores/authStore';
import { Link } from 'react-router-dom';
import { useOrgContext } from '../stores/orgContext';

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

// The form uses "display" provider values (dev, local, microsoft,
// okta) which map to the backend's provider types (dev, local, oidc).
// Local is its own backend type — credentials stored on the Person
// record as Argon2 hashes; no IdP required.
type DisplayProvider = 'dev' | 'local' | 'microsoft' | 'okta';

function displayProviderToBackend(dp: DisplayProvider): string {
  if (dp === 'microsoft' || dp === 'okta') return 'oidc';
  if (dp === 'local') return 'local';
  return 'dev';
}

function backendToDisplayProvider(backendProvider: string, issuerUrl: string): DisplayProvider {
  if (backendProvider === 'local') return 'local';
  if (backendProvider !== 'oidc') return 'dev';
  if (issuerUrl.includes('microsoftonline.com') || issuerUrl.includes('login.microsoft')) return 'microsoft';
  if (issuerUrl.includes('okta.com')) return 'okta';
  // Default to microsoft if OIDC is active but issuer doesn't match known patterns
  return 'microsoft';
}

// Roles allowed to see the Settings page. Settings holds org-wide
// configuration (auth provider, lifecycle mode, branding, MFA, backup
// + reset everything) — none of which a non-admin should touch.
// Per-user concerns (display preferences, sign out) live in the
// top-right user menu instead.
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ORG_ADMIN']);

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user?.role && ADMIN_ROLES.has(user.role);
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 560, margin: '64px auto', padding: '32px', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Admins only</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          The Settings page holds organization-wide configuration that
          only administrators can change. For your personal display
          preferences (Plain / DAMA, Cozy / Compact), click your name
          in the top-right corner of any page.
        </p>
        <Link
          to="/"
          style={{
            display: 'inline-block', padding: '8px 16px',
            fontSize: 13, fontWeight: 600,
            background: 'var(--color-primary)', color: '#fff',
            borderRadius: 'var(--radius-md)', textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  // Org-level lifecycle mode (Simple = 3 statuses, Advanced = 6).
  // The toggle used to live on the Organizations page but it
  // governs how non-org entities (processes, assets, policies)
  // move through their statuses — wrong page for the audience.
  // It's a one-time configuration so Settings is the right home.
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [lifecycleMode, setLifecycleMode] = useState<'simple' | 'advanced'>('simple');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [confirmLifecycle, setConfirmLifecycle] = useState<'simple' | 'advanced' | null>(null);
  const [lifecycleMigrationMsg, setLifecycleMigrationMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!activeOrgId) return;
    apiClient
      .get<{ success: boolean; data: { statusMode?: string } }>(`/organizations/${activeOrgId}`)
      .then((res) => setLifecycleMode((res.data?.statusMode as 'simple' | 'advanced') || 'simple'))
      .catch(() => { /* leave default */ });
  }, [activeOrgId]);
  const applyLifecycle = async (newMode: 'simple' | 'advanced') => {
    if (!activeOrgId || lifecycleBusy) return;
    setLifecycleBusy(true);
    try {
      const res = await apiClient.post<{ success: boolean; message?: string; migrated?: number }>(`/organizations/${activeOrgId}/status-mode`, { mode: newMode });
      setLifecycleMode(newMode);
      setLifecycleMigrationMsg(res.message || null);
    } catch { /* toast handled by client */ }
    finally { setLifecycleBusy(false); setConfirmLifecycle(null); }
  };

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

  // Backup & Restore state
  const [exportLoading, setExportLoading] = useState(false);
  const [, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<Record<string, number> | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<Record<string, number> | null>(null);
  const [importError, setImportError] = useState('');
  const importParsedData = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = async () => {
    setExportLoading(true);
    try {
      const data = await apiClient.get<any>('/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `procela-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Failed to export backup: ' + (err.message || 'Unknown error'));
    } finally {
      setExportLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportResult(null);
    setImportError('');
    const file = e.target.files?.[0] || null;
    setImportFile(file);
    setImportPreview(null);
    importParsedData.current = null;

    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (!parsed.data || typeof parsed.data !== 'object') {
            setImportError('Invalid backup file: missing "data" field.');
            return;
          }
          importParsedData.current = parsed;
          const counts: Record<string, number> = {};
          for (const [key, value] of Object.entries(parsed.data)) {
            if (Array.isArray(value)) {
              counts[key] = value.length;
            }
          }
          setImportPreview(counts);
        } catch {
          setImportError('Invalid JSON file. Please select a valid Procela backup file.');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleImportConfirm = async () => {
    setImportConfirmOpen(false);
    setImportLoading(true);
    setImportError('');
    setImportResult(null);
    try {
      const res = await apiClient.post<{ success: boolean; imported: Record<string, number> }>('/backup/import', importParsedData.current);
      setImportResult(res.imported);
      setImportFile(null);
      setImportPreview(null);
      importParsedData.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setImportError('Import failed: ' + (err.message || 'Unknown error'));
    } finally {
      setImportLoading(false);
    }
  };

  const providerDisplayName = (provider: DisplayProvider) => {
    switch (provider) {
      case 'dev': return 'Dev Mode';
      case 'local': return 'Local credentials';
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
      <PageHeader
        title="Settings"
        actions={
          <button
            onClick={() => window.dispatchEvent(new Event('procela:start-tour'))}
            style={{
              padding: '6px 14px', background: 'var(--color-surface)',
              color: 'var(--color-primary)', border: '1px solid var(--color-primary)',
              borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
            title="Show the three-phase Define / Connect / Discover intro again"
          >
            Replay intro
          </button>
        }
      />

      {/* Branding — quick link to the dedicated theming page */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={sectionTitleStyle}>Branding</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Company name, logo, and color palette.
            </p>
          </div>
          <button
            onClick={() => navigate('/settings/branding')}
            style={{ padding: '8px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}
          >
            Customize branding
          </button>
        </div>
      </div>

      {/* Process & Asset Lifecycle — org-level workflow shape.
          Drives the status dropdowns on the Process Catalog, Data
          Assets, Policies / Governance Documents, and anywhere else
          a row carries a Draft / Active / Deprecated status. Simple
          is right for most orgs; Advanced adds Proposed / Under
          Review / Approved gates between Draft and Active for
          highly-regulated environments. */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={sectionTitleStyle}>Process & Asset Lifecycle</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Decides which workflow statuses appear on processes, data assets, policies and other governed entities in <strong>{activeOrgName || 'this org'}</strong>. A one-time setup for most organizations — change it carefully because items in statuses the new mode doesn't have will be migrated.
            </p>
            <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)', paddingLeft: 18, listStyle: 'disc', marginBottom: 8 }}>
              <li><strong>Simple</strong> (3 statuses): Draft → Active → Deprecated. The default — right for most teams.</li>
              <li><strong>Advanced</strong> (6 statuses): Draft → Proposed → Under Review → Approved → Active → Deprecated. For regulated environments that need explicit review gates before items go live.</li>
            </ul>
            {lifecycleMigrationMsg && (
              <div style={{ fontSize: 12, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 4, padding: '6px 10px', marginTop: 4 }}>
                {lifecycleMigrationMsg}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{lifecycleMode === 'advanced' ? 'Advanced' : 'Simple'}</span>
            </div>
            <button
              onClick={() => setConfirmLifecycle(lifecycleMode === 'advanced' ? 'simple' : 'advanced')}
              disabled={!activeOrgId || lifecycleBusy}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 500,
                background: activeOrgId ? 'var(--color-surface)' : 'var(--color-bg)',
                border: '1px solid var(--color-primary)',
                color: activeOrgId ? 'var(--color-primary)' : 'var(--color-text-muted)',
                borderRadius: 6, cursor: activeOrgId ? 'pointer' : 'not-allowed',
              }}
            >
              {lifecycleBusy ? 'Switching…' : `Switch to ${lifecycleMode === 'advanced' ? 'Simple' : 'Advanced'}`}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmLifecycle}
        title={`Switch to ${confirmLifecycle === 'advanced' ? 'Advanced' : 'Simple'} lifecycle?`}
        message={confirmLifecycle === 'simple'
          ? 'Items currently in Proposed, Under Review, or Approved will be moved to Draft. Active and Deprecated items are unaffected. This setting takes effect immediately across every page that uses status (Process Catalog, Data Assets, Policies, etc.).'
          : 'This adds Proposed, Under Review, and Approved steps between Draft and Active. Existing Draft / Active / Deprecated items keep their status. Once enabled, new items created at higher tiers will go through the review gates.'}
        confirmLabel={`Switch to ${confirmLifecycle === 'advanced' ? 'Advanced' : 'Simple'}`}
        variant="primary"
        onConfirm={async () => { if (confirmLifecycle) await applyLifecycle(confirmLifecycle); }}
        onCancel={() => setConfirmLifecycle(null)}
      />

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
                  <option value="local">Local credentials (email + password)</option>
                  <option value="microsoft">Microsoft Entra ID (OIDC)</option>
                  <option value="okta">Okta (OIDC)</option>
                </select>
                {formProvider === 'local' && (
                  <div style={{ marginTop: '0.5rem', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Procela stores Argon2id password hashes on each Person record. Use{' '}
                    <strong>Migrate to Local</strong> below to generate temporary passwords for
                    everyone, then distribute them out-of-band. Users will be forced to set a
                    new password on first login.
                  </div>
                )}
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

              {/* Local credentials: one-time migration. Always
                  available so an admin can pre-stage temp passwords
                  before flipping the provider switch (avoids the
                  lockout where switching to Local with no hashes set
                  blocks every login). */}
              {(formProvider === 'local' || currentProvider === 'local') && (
                <LocalMigrationPanel />
              )}
            </div>
          </>
        )}
      </div>

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* Two-step verification (MFA / TOTP) */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Two-step verification</h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
          Use an authenticator app (Google Authenticator, 1Password, Authy)
          to generate a one-time code at sign-in. When enabled, your
          password alone won't be enough to sign in.
        </p>
        <MfaPanel />
      </div>

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* Active sessions */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Active sessions</h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
          Every device or browser you're signed in from has its own refresh
          token. Revoke one if you've finished with a public computer, lost a
          device, or want to force a fresh login from somewhere.
        </p>
        <ActiveSessionsPanel />
      </div>

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* API Configuration */}
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

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* Backup & Restore */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Backup & Restore</h2>

        {/* Export */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.5rem' }}>Export Backup</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Download a complete backup of all Procela data as a JSON file.
          </p>
          <button
            onClick={handleExportBackup}
            disabled={exportLoading}
            style={{
              padding: '0.5rem 1.5rem',
              background: exportLoading ? '#6b7280' : 'var(--color-primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: exportLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {exportLoading ? 'Exporting...' : 'Export Backup'}
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'var(--color-border)', marginBottom: '1.5rem' }} />

        {/* Import */}
        <div>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.5rem' }}>Import Backup</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Restore data from a previously exported Procela backup file.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}
          />

          {importError && (
            <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8125rem' }}>
              {importError}
            </div>
          )}

          {importPreview && (
            <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.5rem' }}>
                This backup contains:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {Object.entries(importPreview).map(([key, count]) => (
                  <div key={key}>
                    <span style={{ fontWeight: 500 }}>{count}</span> {key}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: '#d97706' }}>
                Warning: This will replace ALL existing data. This cannot be undone.
              </div>
              <button
                onClick={() => setImportConfirmOpen(true)}
                disabled={importLoading}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 1.5rem',
                  background: importLoading ? '#6b7280' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: importLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {importLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          )}

          {importResult && (
            <div style={{ color: 'var(--color-success)', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Import successful!</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem' }}>
                {Object.entries(importResult).map(([key, count]) => (
                  <div key={key}>
                    <span style={{ fontWeight: 500 }}>{count}</span> {key}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={importConfirmOpen}
        title="Replace All Data?"
        message="This will permanently replace ALL existing data with the contents of the backup file. This action cannot be undone. Are you sure you want to continue?"
        confirmLabel="Yes, Import"
        onConfirm={handleImportConfirm}
        onCancel={() => setImportConfirmOpen(false)}
      />

      <AiSettingsPanel sectionStyle={sectionStyle} sectionTitleStyle={sectionTitleStyle} />

      <ConnectorsSection sectionStyle={sectionStyle} sectionTitleStyle={sectionTitleStyle} />

      {/* Spacer */}
      <div style={{ height: '1.5rem' }} />

      {/* Reset everything — super-admin only "factory reset" that
          wipes every store on disk + in memory. Lives next to Backup
          & Restore so it's reachable from the same scroll position as
          the Export button, and so the recommended Export-first
          workflow is one click away. */}
      <ResetAllDataPanel onExportFirst={handleExportBackup} />

    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  padding: '1.5rem',
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


// ──────────────────────────────────────────────────────────────────────────
// LocalMigrationPanel — one-time admin action that moves people without
// a stored credential onto Local auth. Generates a strong temporary
// password for each, hashes it server-side, returns the plaintext
// values ONCE so the admin can distribute them out-of-band. Every
// generated password is marked must-change so the user is forced into
// the change-password flow on first login.
//
// The panel deliberately doesn't ship credentials over email — that
// integration is a separate concern. The download-as-CSV affordance
// is the recommended distribution method until SMTP is wired.
// ──────────────────────────────────────────────────────────────────────────

interface TempCredential {
  personId: string;
  email: string;
  name: string;
  tempPassword: string;
}

function LocalMigrationPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ count: number; message: string; tempPasswords: TempCredential[] } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: { count: number; message: string; tempPasswords: TempCredential[] } }>(
        '/auth/migrate-to-local',
        {},
      );
      setResult(res.data);
    } catch { /* toast already shown by client */ }
    finally { setBusy(false); setConfirming(false); }
  };

  const downloadCsv = () => {
    if (!result) return;
    const csv = [
      'Email,Name,Temporary password',
      ...result.tempPasswords.map((p) => `"${p.email}","${p.name}","${p.tempPassword}"`),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procela-temp-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      marginTop: '1rem', padding: '1rem',
      background: 'var(--color-bg)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        Migrate people to Local auth
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
        Generates a temporary password for every Person without a stored credential.
        Returns the plaintext values <strong>once</strong> — copy or download them now,
        because they aren't stored after this response. Every recipient is required to
        change their password on first login.
      </div>

      {!result && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          style={{
            padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
            background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Generate temporary passwords…
        </button>
      )}

      {confirming && !result && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12 }}>Run now? The values are only returned once.</span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Running…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {result && (
        <div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{result.message}</div>
          {result.tempPasswords.length > 0 && (
            <>
              <button
                type="button"
                onClick={downloadCsv}
                style={{
                  padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                  background: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', marginBottom: 10,
                }}
              >
                Download as CSV
              </button>
              <div style={{
                maxHeight: 220, overflowY: 'auto',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
                background: 'var(--color-surface)',
              }}>
                {result.tempPasswords.map((p) => (
                  <div key={p.personId} style={{
                    padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', gap: 12, justifyContent: 'space-between',
                  }}>
                    <span>{p.email}</span>
                    <span style={{ fontWeight: 600 }}>{p.tempPassword}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MfaPanel — enroll / disable TOTP for the current user.
//
// Three states:
//   - loading                 fetching /auth/me to see if already enrolled
//   - enrolled                shows "Enrolled" pill + Disable button
//   - not-enrolled / enrolling  shows the QR + secret + a 6-digit code
//                              prompt. After verify, displays backup
//                              codes ONCE and asks the user to confirm
//                              they've saved them.
//
// MFA is bound to the local-credential auth path. Users signing in via
// OIDC see this panel disabled with a one-line note — their IdP is the
// place to enforce MFA. Dev-mode users see it disabled too.
// ──────────────────────────────────────────────────────────────────────────

interface MeResponse {
  data: {
    sub: string;
    mfaEnrolled?: boolean;
    mfaBackupCodesRemaining?: number;
    role: string;
  };
}

interface WebauthnCredentialView {
  id: string;
  label: string;
  createdAt: string;
  transports?: string[];
}

function MfaPanel() {
  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(false);
  const [backupRemaining, setBackupRemaining] = useState<number>(0);
  const [webauthnCreds, setWebauthnCreds] = useState<WebauthnCredentialView[]>([]);
  const [enrolling, setEnrolling] = useState<{
    secret: string;
    qrDataUrl: string;
    uri: string;
    replacing: boolean;
  } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Disable flow state
  const [disablingOpen, setDisablingOpen] = useState(false);
  // Confirmation state for "Remove security key" — replaces the stray
  // window.confirm() so the rest of the app's ConfirmDialog patterns
  // (focus trap, escape-to-cancel, themed buttons) apply here too.
  const [confirmRemoveCred, setConfirmRemoveCred] = useState<{ id: string; label: string } | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Regenerate-backup-codes flow state (separate from the
  // post-enrollment one-shot display).
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');

  const refresh = useCallback(async () => {
    try {
      const me = await apiClient.get<MeResponse>('/auth/me');
      const personRes = await apiClient.get<{
        data: {
          mfaEnrolled?: boolean;
          webauthnCredentials?: WebauthnCredentialView[];
        };
      }>(`/people/${me.data.sub}`);
      setEnrolled(!!personRes.data.mfaEnrolled);
      setWebauthnCreds(personRes.data.webauthnCredentials || []);
      setBackupRemaining(me.data.mfaBackupCodesRemaining ?? 0);
    } catch { /* default to not enrolled */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEnrollment = async () => {
    setErr('');
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { secret: string; qrDataUrl: string; uri: string; replacing: boolean } }>(
        '/auth/mfa/start', {});
      setEnrolling(res.data);
      setCode('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to start enrollment');
    } finally { setBusy(false); }
  };

  const verifyEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { backupCodes: string[] } }>(
        '/auth/mfa/verify', { code });
      setBackupCodes(res.data.backupCodes);
      setEnrolled(true);
      setEnrolling(null);
      setCode('');
    } catch (e: any) {
      setErr(e?.message || 'Invalid code');
    } finally { setBusy(false); }
  };

  const disableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await apiClient.post('/auth/mfa/disable', { currentPassword: disablePassword, code: disableCode });
      setEnrolled(false);
      setDisablingOpen(false);
      setDisablePassword('');
      setDisableCode('');
    } catch (e: any) {
      setErr(e?.message || 'Could not disable two-step verification');
    } finally { setBusy(false); }
  };

  const regenerateBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { backupCodes: string[] } }>(
        '/auth/mfa/regenerate-backup-codes', { code: regenCode });
      setBackupCodes(res.data.backupCodes);
      setRegenOpen(false);
      setRegenCode('');
      await refresh();
    } catch (e: any) {
      setErr(e?.message || 'Could not regenerate backup codes');
    } finally { setBusy(false); }
  };

  // ── WebAuthn enrollment ──
  const registerWebauthn = async () => {
    setErr('');
    setBusy(true);
    try {
      const startRes = await apiClient.post<{ data: any }>('/auth/mfa/webauthn/register-start', {});
      // Default label takes a sensible guess from the platform; user
      // can rename via the API later. Keep it short so the chip in
      // the credentials list doesn't get unwieldy.
      const label = window.prompt(
        'Name this security key (e.g. "YubiKey 5", "MacBook Touch ID"):',
        'Security key',
      ) || 'Security key';
      const attestation = await startWebauthnRegistration({ optionsJSON: startRes.data });
      await apiClient.post('/auth/mfa/webauthn/register-finish', { response: attestation, label });
      await refresh();
    } catch (e: any) {
      // Browser cancel / user dismissed prompt — silent.
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return;
      setErr(e?.message || 'Could not register security key');
    } finally { setBusy(false); }
  };

  const removeWebauthn = async (credId: string) => {
    setBusy(true);
    try {
      await apiClient.delete(`/auth/mfa/webauthn/credentials/${credId}`);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || 'Could not remove security key');
    } finally { setBusy(false); }
  };

  const downloadBackupCodes = () => {
    if (!backupCodes) return;
    const blob = new Blob([
      'Procela backup codes — keep these somewhere safe.\n',
      'Each code is single-use. Use them to sign in if you lose access to your authenticator app.\n\n',
      ...backupCodes.map((c) => c + '\n'),
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procela-backup-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>;
  }

  // renderTotp encapsulates the four states the TOTP sub-panel can
  // be in (one-time backup codes display, enrolled, mid-enrollment
  // QR scan, or the default "Set up" button). Wrapped this way so
  // the outer return can stack it next to the WebAuthn subsection
  // without duplicating the auto-layout.
  const renderTotp = (): React.ReactNode => {

  // ── Backup-codes display (post-enrollment, one-time) ──
  if (backupCodes) {
    return (
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          Save these backup codes
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          Each code is single-use. Save them somewhere you'll be able to
          reach when you don't have your authenticator app — a password
          manager, an offline note, a printout. They aren't stored on
          our side after this and can't be recovered.
        </p>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 13,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 12,
          marginBottom: 12,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 16px',
        }}>
          {backupCodes.map((c) => <div key={c}>{c}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={downloadBackupCodes}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Download as text
          </button>
          <button
            type="button"
            onClick={() => setBackupCodes(null)}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            I've saved them
          </button>
        </div>
      </div>
    );
  }

  // ── Already enrolled ──
  if (enrolled) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: '#d1fae5', color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>Enrolled</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            You'll be asked for a code at sign-in.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={startEnrollment}
            disabled={busy}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Replace authenticator
          </button>
          <button
            type="button"
            onClick={() => setDisablingOpen(true)}
            disabled={busy}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)', color: 'var(--color-error, #dc2626)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Disable
          </button>
        </div>

        {disablingOpen && (
          <form onSubmit={disableMfa} style={{
            marginTop: 12, padding: 12,
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Confirm with your current password and a code from your authenticator:
            </div>
            {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 6 }}>{err}</div>}
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Current password"
              required
              autoComplete="current-password"
              style={inputStyle}
            />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              required
              style={{ ...inputStyle, marginTop: 6 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setDisablingOpen(false); setErr(''); }}
                style={{
                  padding: '0.4rem 1rem', fontSize: 13,
                  background: 'transparent', color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                  background: 'var(--color-error, #dc2626)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {busy ? 'Disabling…' : 'Disable'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // ── Mid-enrollment (QR + code prompt) ──
  if (enrolling) {
    return (
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          {enrolling.replacing ? 'Replace your authenticator' : 'Scan with your authenticator'}
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          Open Google Authenticator, 1Password, Authy, or another TOTP app and
          scan this QR code. Then enter the 6-digit code it generates.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <img src={enrolling.qrDataUrl} alt="MFA QR code" width={180} height={180} style={{ border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff' }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Can't scan? Type this:
            </div>
            <div style={{
              fontFamily: 'var(--font-mono, monospace)', fontSize: 13,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 4, padding: '6px 8px', marginBottom: 12,
              wordBreak: 'break-all',
            }}>
              {enrolling.secret}
            </div>
            <form onSubmit={verifyEnrollment}>
              {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 6 }}>{err}</div>}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                required
                autoFocus
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  style={{
                    padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                    background: 'var(--color-primary)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: (busy || code.length !== 6) ? 'default' : 'pointer',
                    opacity: (busy || code.length !== 6) ? 0.5 : 1,
                  }}
                >
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEnrolling(null); setErr(''); }}
                  style={{
                    padding: '0.4rem 1rem', fontSize: 13,
                    background: 'transparent', color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Default: not enrolled, offer to start ──
  return (
    <div>
      {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 6 }}>{err}</div>}
      <button
        type="button"
        onClick={startEnrollment}
        disabled={busy}
        style={{
          padding: '0.5rem 1rem', fontSize: 13, fontWeight: 500,
          background: 'var(--color-primary)', color: '#fff',
          border: 'none', borderRadius: 'var(--radius-md)',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Starting…' : 'Set up two-step verification'}
      </button>
    </div>
  );

  }; // end renderTotp

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Authenticator app (TOTP) */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Authenticator app
        </div>
        {renderTotp()}

        {/* Backup-codes running-low nudge. Shown when enrolled and
            <= 3 codes remain. Each code is single-use; users who
            burn through them on lost-authenticator events end up
            with zero. */}
        {enrolled && !backupCodes && backupRemaining <= 3 && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 'var(--radius-md)', fontSize: 12, color: '#92400e',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span>{backupRemaining} backup code{backupRemaining === 1 ? '' : 's'} remaining — regenerate before you run out.</span>
            <button
              type="button"
              onClick={() => { setRegenOpen(true); setErr(''); }}
              style={{
                marginLeft: 'auto',
                padding: '4px 10px', fontSize: 12, fontWeight: 500,
                background: '#fff', color: '#92400e',
                border: '1px solid #fde68a', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Regenerate
            </button>
          </div>
        )}
        {enrolled && !backupCodes && regenOpen && (
          <form onSubmit={regenerateBackupCodes} style={{
            marginTop: 8, padding: 12,
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              Confirm with a code from your authenticator to generate a new set of 10 backup codes. The current set will be invalidated.
            </div>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={regenCode}
              onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code" required
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setRegenOpen(false); setErr(''); }}
                style={{ padding: '0.4rem 1rem', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={busy || regenCode.length !== 6}
                style={{ padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: (busy || regenCode.length !== 6) ? 'default' : 'pointer', opacity: (busy || regenCode.length !== 6) ? 0.5 : 1 }}>
                {busy ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Security keys (WebAuthn / FIDO2). Available regardless of
          whether TOTP is set up — they're independent second-factor
          methods, either one (or both) satisfies the login gate. */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Security keys
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
          Hardware keys (YubiKey, Titan) or platform authenticators (Touch ID,
          Windows Hello, Android fingerprint). Faster than typing a code; users
          who register a key can sign in by tapping it.
        </p>
        {webauthnCreds.length === 0 ? (
          <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--color-text-muted)', marginBottom: 10 }}>
            No security keys registered.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {webauthnCreds.map((c) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', fontSize: 13,
              }}>
                <span style={{ flex: 1 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Added {new Date(c.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveCred({ id: c.id, label: c.label })}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-error, #dc2626)', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={registerWebauthn}
          disabled={busy}
          style={{
            padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
            background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          + Register a security key
        </button>
      </div>
      <ConfirmDialog
        open={!!confirmRemoveCred}
        title="Remove this security key?"
        message={confirmRemoveCred ? `Remove "${confirmRemoveCred.label}"? You won't be able to use this security key to sign in.` : ''}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={async () => {
          const target = confirmRemoveCred;
          setConfirmRemoveCred(null);
          if (target) await removeWebauthn(target.id);
        }}
        onCancel={() => setConfirmRemoveCred(null)}
      />
    </div>
  );
}

