import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { useMcpDeployment } from '../stores/aiConfigStore';

// ──────────────────────────────────────────────────────────────────────────
// McpAccessPanel — per-tenant enablement of the MCP (agent) surface.
//
// An org admin opts this tenant into the Model Context Protocol server, so
// external AI agents can query its governed catalog (and, where the deployment
// allows, make audited writes). This is on TOP of the deployment kill switches:
// the toggle only takes effect when the operator has MCP enabled for the
// deployment — the panel says so when it isn't, rather than pretending.
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}

interface ServicePrincipal {
  id: string;
  label: string;
  role: string;
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  createdAt: string;
}

export default function McpAccessPanel({ sectionStyle, sectionTitleStyle }: Props) {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { serverEnabled, writeEnabled } = useMcpDeployment();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── Service tokens ──
  const [tokens, setTokens] = useState<ServicePrincipal[]>([]);
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newRole, setNewRole] = useState<'VIEWER' | 'EDITOR'>('VIEWER');
  const [minting, setMinting] = useState(false);
  const [freshToken, setFreshToken] = useState<{ label: string; token: string } | null>(null);
  const [tokenErr, setTokenErr] = useState<string | null>(null);

  const loadTokens = useCallback(() => {
    if (!activeOrgId) return;
    apiClient
      .get<{ success: boolean; data: ServicePrincipal[] }>(`/service-principals?orgId=${encodeURIComponent(activeOrgId)}`)
      .then((res) => { setTokens(res.data || []); setTokensLoaded(true); })
      .catch(() => setTokensLoaded(true));
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) return;
    setMsg(null);
    setFreshToken(null);
    apiClient
      .get<{ success: boolean; data: { mcpEnabled?: boolean } }>(`/organizations/${activeOrgId}`)
      .then((res) => setEnabled(res.data?.mcpEnabled === true))
      .catch(() => setEnabled(false));
    loadTokens();
  }, [activeOrgId, loadTokens]);

  const mintToken = async () => {
    if (!activeOrgId || minting || !newLabel.trim()) return;
    setMinting(true);
    setTokenErr(null);
    setFreshToken(null);
    try {
      const res = await apiClient.post<{ success: boolean; data: ServicePrincipal & { token: string } }>('/service-principals', {
        orgId: activeOrgId, label: newLabel.trim(), role: newRole,
      });
      setFreshToken({ label: res.data.label, token: res.data.token });
      setNewLabel('');
      setNewRole('VIEWER');
      loadTokens();
    } catch (e) {
      setTokenErr(errorMessage(e, 'Failed to create token'));
    } finally {
      setMinting(false);
    }
  };

  const revokeToken = async (id: string) => {
    try {
      await apiClient.delete(`/service-principals/${id}`);
      loadTokens();
    } catch (e) {
      setTokenErr(errorMessage(e, 'Failed to revoke token'));
    }
  };

  const toggle = async () => {
    if (!activeOrgId || busy || enabled === null) return;
    const next = !enabled;
    const prev = enabled;
    setEnabled(next);
    setBusy(true);
    setMsg(null);
    try {
      await apiClient.put(`/organizations/${activeOrgId}`, { mcpEnabled: next });
      setMsg(next ? 'MCP access enabled for this organization.' : 'MCP access disabled.');
    } catch (e) {
      setEnabled(prev);
      setMsg(errorMessage(e, 'Failed to update MCP access'));
    } finally {
      setBusy(false);
    }
  };

  const on = enabled === true;

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>Agent access (MCP)</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        Let external AI agents (Claude Desktop, IDE assistants, your own copilots) query{' '}
        <strong>{activeOrgName || 'this organization'}</strong>&rsquo;s governed catalog over the{' '}
        <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>Model Context Protocol</a>.
        Agents authenticate as a Procela user and see no more than that user&rsquo;s role allows — every
        call is scoped to your org and written to the audit log.
      </p>

      <label
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          cursor: busy || enabled === null ? 'wait' : 'pointer',
          background: on ? 'var(--color-primary-light)' : 'var(--color-bg)',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          disabled={busy || enabled === null}
          onChange={toggle}
          aria-label="Enable MCP access for this organization"
          style={{ marginTop: 2 }}
        />
        <span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {on ? 'MCP access is enabled' : 'Enable MCP access'}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {on
              ? 'This tenant’s governed context is reachable by authenticated agents.'
              : 'This tenant is not reachable over MCP. Turn this on to expose its governed context to agents.'}
          </span>
        </span>
      </label>

      {msg && (
        <p style={{ marginTop: 10, fontSize: 12, color: msg.toLowerCase().includes('fail') ? 'var(--color-error)' : 'var(--color-success)' }}>
          {msg}
        </p>
      )}

      {/* Deployment-gate honesty: the per-tenant toggle only takes effect when
          the operator has the MCP surface enabled for the whole deployment. */}
      {!serverEnabled && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-warning)', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
          The MCP surface is turned off for this deployment, so this setting is saved but has no
          effect yet. An operator must set <code>MCP_SERVER_ENABLED=true</code> (and keep AI features
          on) to serve it.
        </p>
      )}

      {on && serverEnabled && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          Agents can read the process hierarchy, ownership, gaps, asset health, and governance scope.
          {writeEnabled
            ? ' Write tools (assign owner, set status, create task) are also available and require the agent’s user to hold the matching edit permission.'
            : ' Write tools are off for this deployment, so access is read-only.'}
        </p>
      )}

      {/* ── Service tokens ── */}
      {on && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Service tokens</h3>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            A service token is the bearer an agent authenticates with — org-scoped, revocable, and capped
            to the role you choose (Viewer is read-only; Editor also enables the write tools). Give each
            agent its own token; the secret is shown once, so copy it now. Revoke any time.
          </p>

          {/* Freshly minted token — shown once. */}
          {freshToken && (
            <div style={{ marginBottom: 12, padding: '10px 12px', border: '1px solid var(--color-success)', borderRadius: 'var(--radius-md)', background: '#f0fdf4' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)', marginBottom: 6 }}>
                Token for “{freshToken.label}” — copy it now, it won’t be shown again.
              </div>
              <code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 8px', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                {freshToken.token}
              </code>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(freshToken.token); }}
                style={{ marginTop: 8, fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer' }}
              >
                Copy
              </button>
            </div>
          )}

          {/* Mint form */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void mintToken(); } }}
              placeholder="Token label (e.g. Claude Desktop — Analytics)"
              maxLength={120}
              aria-label="New token label"
              style={{ flex: 1, minWidth: 220, fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'VIEWER' | 'EDITOR')}
              aria-label="New token role"
              style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}
            >
              <option value="VIEWER">Viewer (read-only)</option>
              <option value="EDITOR">Editor (read + write)</option>
            </select>
            <button
              type="button"
              onClick={() => void mintToken()}
              disabled={minting || !newLabel.trim()}
              style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', color: '#fff', cursor: minting || !newLabel.trim() ? 'not-allowed' : 'pointer', opacity: minting || !newLabel.trim() ? 0.5 : 1 }}
            >
              {minting ? 'Generating…' : 'Generate token'}
            </button>
          </div>

          {tokenErr && <p style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{tokenErr}</p>}

          {/* Existing tokens */}
          {tokensLoaded && tokens.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No service tokens yet.</p>
          )}
          {tokens.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tokens.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', opacity: t.active ? 1 : 0.55 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                      {t.role === 'EDITOR' ? 'Editor' : 'Viewer'} · …{t.tokenPrefix || '••••'} ·{' '}
                      {t.active
                        ? (t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used')
                        : `revoked ${t.revokedAt ? new Date(t.revokedAt).toLocaleDateString() : ''}`}
                    </span>
                  </span>
                  {t.active
                    ? (
                      <button
                        type="button"
                        onClick={() => void revokeToken(t.id)}
                        style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-error)', cursor: 'pointer' }}
                      >
                        Revoke
                      </button>
                    )
                    : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Revoked</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
