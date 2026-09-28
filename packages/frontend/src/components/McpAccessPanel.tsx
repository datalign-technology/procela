import { useState, useEffect } from 'react';
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

export default function McpAccessPanel({ sectionStyle, sectionTitleStyle }: Props) {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { serverEnabled, writeEnabled } = useMcpDeployment();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    setMsg(null);
    apiClient
      .get<{ success: boolean; data: { mcpEnabled?: boolean } }>(`/organizations/${activeOrgId}`)
      .then((res) => setEnabled(res.data?.mcpEnabled === true))
      .catch(() => setEnabled(false));
  }, [activeOrgId]);

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
    </div>
  );
}
