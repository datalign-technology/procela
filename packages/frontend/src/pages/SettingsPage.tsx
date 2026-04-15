import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

// ── User Management types ──

interface UMPerson {
  id: string;
  orgIds: string[];
  accessibleOrgIds: string[];
  name: string;
  email: string;
  role: string;
  title: string;
}

interface UMOrgFlat {
  id: string;
  name: string;
  type: string;
}

interface UMAuditEntry {
  id: string;
  entityType: string;
  action: string;
  after: Record<string, any> | null;
  timestamp: string;
}

// ── User Management helpers ──

const UM_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ORG_ADMIN: 'Org Admin', EDITOR: 'Editor',
  CONTRIBUTOR: 'Contributor', VIEWER: 'Viewer',
};

const umRoleBadgeStyle = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    SUPER_ADMIN: { bg: '#fce7f3', color: '#9d174d' },
    ORG_ADMIN: { bg: '#ede9fe', color: '#5b21b6' },
    EDITOR: { bg: '#d1f0eb', color: '#0f4f46' },
    CONTRIBUTOR: { bg: '#fef3c7', color: '#92400e' },
    VIEWER: { bg: '#f1f5f9', color: '#64748b' },
  };
  const c = colors[role] || colors.VIEWER;
  return { display: 'inline-block', padding: '1px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: c.bg, color: c.color };
};

function umRelativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

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
  const navigate = useNavigate();
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  // User Management state
  const [umPeople, setUmPeople] = useState<UMPerson[]>([]);
  const [umOrgs, setUmOrgs] = useState<UMOrgFlat[]>([]);
  const [umLoginMap, setUmLoginMap] = useState<Record<string, string>>({}); // email -> most recent LOGIN_SUCCESS timestamp
  const [umLoading, setUmLoading] = useState(true);

  useEffect(() => {
    async function loadUserManagement() {
      try {
        const [peopleRes, orgsRes, auditRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: UMPerson[] }>('/people'),
          apiClient.get<{ success: boolean; data: UMOrgFlat[]; tree: any[] }>('/organizations'),
          apiClient.get<{ success: boolean; data: UMAuditEntry[] }>('/audit?entityType=Auth&limit=1000'),
        ]);
        setUmPeople(peopleRes.data || []);
        setUmOrgs(orgsRes.data || []);

        // Build email -> most recent LOGIN_SUCCESS timestamp map
        const loginMap: Record<string, string> = {};
        for (const entry of (auditRes.data || [])) {
          if (entry.action === 'LOGIN_SUCCESS' && entry.after && typeof entry.after === 'object' && (entry.after as any).email) {
            const email = ((entry.after as any).email as string).toLowerCase();
            if (!loginMap[email] || new Date(entry.timestamp) > new Date(loginMap[email])) {
              loginMap[email] = entry.timestamp;
            }
          }
        }
        setUmLoginMap(loginMap);
      } catch {
        // Silently handle - sections will show empty state
      } finally {
        setUmLoading(false);
      }
    }
    loadUserManagement();
  }, []);

  // Computed user management data
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const umUsers = umPeople.filter((p) => p.email && p.email.trim() !== '');
  const orgNameMap = new Map(umOrgs.map((o) => [o.id, o.name]));
  const umActiveUsers = umUsers.filter((p) => {
    const lastLogin = umLoginMap[p.email.toLowerCase()];
    return lastLogin && (Date.now() - new Date(lastLogin).getTime()) < THIRTY_DAYS_MS;
  });
  const umInactiveUsers = umUsers.filter((p) => {
    const lastLogin = umLoginMap[p.email.toLowerCase()];
    return !lastLogin || (Date.now() - new Date(lastLogin).getTime()) >= THIRTY_DAYS_MS;
  });
  const umRoleCounts: Record<string, number> = {};
  for (const u of umUsers) {
    umRoleCounts[u.role] = (umRoleCounts[u.role] || 0) + 1;
  }

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Settings</h1>
        <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
      </div>

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

      {/* User Management Section */}
      <div style={{ ...sectionStyle, maxWidth: 900 }}>
        <h2 style={sectionTitleStyle}>User Management</h2>

        {/* Info banner */}
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
          padding: '0.625rem 0.875rem', marginBottom: '1.25rem', fontSize: '0.8125rem', color: '#1e40af',
        }}>
          User access is managed through People records in Organizations. Connect enterprise SSO (Azure AD / Okta) for full user management with automatic provisioning.
        </div>

        {umLoading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Loading user data...</p>
        ) : umUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              No users found. Add people with email addresses in the Organizations page to see them here.
            </p>
            <button
              onClick={() => navigate('/organizations')}
              style={{
                padding: '0.5rem 1.25rem', background: 'var(--color-primary)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
              }}
            >
              Manage in Organizations
            </button>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <div style={umStatCardStyle}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>{umUsers.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total Users</div>
              </div>
              <div style={umStatCardStyle}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#16a34a' }}>{umActiveUsers.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Active</div>
              </div>
              <div style={umStatCardStyle}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#9ca3af' }}>{umInactiveUsers.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Inactive</div>
              </div>
              {Object.entries(umRoleCounts).map(([role, count]) => (
                <div key={role} style={umStatCardStyle}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>{count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{UM_ROLE_LABELS[role] || role}</div>
                </div>
              ))}
            </div>

            {/* User table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                    <th style={umThStyle}>Name</th>
                    <th style={umThStyle}>Email</th>
                    <th style={umThStyle}>App Role</th>
                    <th style={umThStyle}>Organizations</th>
                    <th style={umThStyle}>Org Access</th>
                    <th style={umThStyle}>Last Login</th>
                    <th style={umThStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {umUsers.map((person) => {
                    const lastLogin = umLoginMap[person.email.toLowerCase()];
                    const isActive = lastLogin && (Date.now() - new Date(lastLogin).getTime()) < THIRTY_DAYS_MS;
                    const orgNames = person.orgIds
                      .map((id) => orgNameMap.get(id))
                      .filter(Boolean)
                      .join(', ');
                    const totalOrgAccess = new Set([...person.orgIds, ...person.accessibleOrgIds]).size;

                    return (
                      <tr key={person.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={umTdStyle}>{person.name || '-'}</td>
                        <td style={{ ...umTdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{person.email}</td>
                        <td style={umTdStyle}>
                          <span style={umRoleBadgeStyle(person.role)}>
                            {UM_ROLE_LABELS[person.role] || person.role}
                          </span>
                        </td>
                        <td style={{ ...umTdStyle, maxWidth: 180 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={orgNames}>
                            {orgNames || '-'}
                          </span>
                        </td>
                        <td style={umTdStyle}>
                          {totalOrgAccess > 0 ? `${totalOrgAccess} org${totalOrgAccess !== 1 ? 's' : ''}` : '-'}
                        </td>
                        <td style={umTdStyle}>
                          {lastLogin ? umRelativeTime(lastLogin) : 'Never'}
                        </td>
                        <td style={umTdStyle}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: '0.75rem', fontWeight: 500,
                            color: isActive ? '#16a34a' : '#9ca3af',
                          }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: isActive ? '#16a34a' : '#d1d5db',
                              display: 'inline-block',
                            }} />
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Manage link */}
            <div style={{ marginTop: '1.25rem' }}>
              <button
                onClick={() => navigate('/organizations')}
                style={{
                  padding: '0.5rem 1.25rem', background: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
                }}
              >
                Manage in Organizations
              </button>
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

// ── User Management styles ──

const umStatCardStyle: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '0.625rem 1rem',
  textAlign: 'center',
  minWidth: 80,
};

const umThStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const umTdStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: '0.8125rem',
  color: 'var(--color-text)',
};
