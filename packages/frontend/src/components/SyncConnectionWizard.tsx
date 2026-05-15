import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useToastStore } from '../stores/toastStore';
import { useOrgContext } from '../stores/orgContext';

interface SyncConnectionWizardProps {
  open: boolean;
  onClose: () => void;
  targetEntity: 'organizations' | 'people' | 'systems' | 'business-glossary';
  orgId: string;
  onCreated: () => void;
}

type SourceType = 'DATABASE' | 'CSV_URL' | 'JSON_URL';
type DbType = 'POSTGRESQL' | 'MYSQL' | 'SQLSERVER';

const TARGET_FIELDS: Record<string, { key: string; label: string; required?: boolean }[]> = {
  organizations: [
    { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type' },
    { key: 'industry', label: 'Industry' },
    { key: 'description', label: 'Description' },
  ],
  people: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'title', label: 'Title' },
    { key: 'jobRole', label: 'Job Role' },
  ],
  systems: [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description' },
    { key: 'systemType', label: 'System Type' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'businessCriticality', label: 'Business Criticality' },
  ],
  'business-glossary': [
    { key: 'term', label: 'Term', required: true },
    { key: 'definition', label: 'Definition' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
    { key: 'sourceOfTruth', label: 'Source of Truth' },
    { key: 'context', label: 'Context' },
  ],
};

const DEFAULT_MATCH_KEY: Record<string, string> = {
  organizations: 'name',
  people: 'email',
  systems: 'name',
  'business-glossary': 'term',
};

const INTERVALS = [
  { value: 60, label: 'Every 1 hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

const ENTITY_LABELS: Record<string, string> = {
  organizations: 'Organizations',
  people: 'People',
  systems: 'Systems',
  'business-glossary': 'Glossary Terms',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const STEPS = ['Source', 'Connect', 'Map Fields', 'Schedule', 'Review'];

interface OrgOption { id: string; name: string; type: string }

interface ConnectionOption {
  id: string;
  name: string;
  connectionType: string;
  status?: string;
  systemId?: string;
  config?: { host?: string; port?: number; database?: string; baseUrl?: string };
}

type ConnectionMode = 'saved' | 'inline';

function isCompatibleConnection(c: ConnectionOption, sourceType: SourceType): boolean {
  if (sourceType === 'DATABASE') return c.connectionType === 'DATABASE' || c.connectionType === 'DATA_WAREHOUSE';
  return c.connectionType === 'API' || c.connectionType === 'FILE_STORAGE';
}

export default function SyncConnectionWizard({ open, onClose, targetEntity, orgId, onCreated }: SyncConnectionWizardProps) {
  const { addToast } = useToastStore();
  const { orgs: contextOrgs } = useOrgContext();
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('DATABASE');
  const [targetOrgId, setTargetOrgId] = useState(orgId);
  const [orgList, setOrgList] = useState<OrgOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setTargetOrgId(orgId);
    apiClient.get<{ success: boolean; data: OrgOption[] }>('/organizations')
      .then((res) => setOrgList(res.data || []))
      .catch(() => setOrgList(contextOrgs.map((o) => ({ id: o.id, name: o.name, type: o.type || 'company' }))));
  }, [open, orgId, contextOrgs]);

  // Step 2 — connection mode + saved/inline fields
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('saved');
  const [savedConnectionId, setSavedConnectionId] = useState('');
  const [saveAsConnection, setSaveAsConnection] = useState(false);
  const [allConnections, setAllConnections] = useState<ConnectionOption[]>([]);
  const [dbType, setDbType] = useState<DbType>('POSTGRESQL');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('');
  const [schema, setSchema] = useState('public');
  const [table, setTable] = useState('');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');

  useEffect(() => {
    if (!open) return;
    apiClient
      .get<{ success: boolean; data: ConnectionOption[] }>(`/connections${orgId ? `?orgId=${orgId}` : ''}`)
      .then((res) => setAllConnections(res.data || []))
      .catch(() => setAllConnections([]));
  }, [open, orgId]);

  // If switching source types makes the previously selected connection
  // incompatible, clear it so we don't submit a stale reference.
  useEffect(() => {
    if (!savedConnectionId) return;
    const sel = allConnections.find((c) => c.id === savedConnectionId);
    if (!sel || !isCompatibleConnection(sel, sourceType)) setSavedConnectionId('');
  }, [sourceType, allConnections, savedConnectionId]);

  const compatibleConnections = allConnections.filter((c) => isCompatibleConnection(c, sourceType));

  // No saved connections → fall back to inline so the user isn't stuck on
  // an empty dropdown they can't satisfy without leaving the wizard.
  useEffect(() => {
    if (!open) return;
    if (compatibleConnections.length === 0 && connectionMode === 'saved') {
      setConnectionMode('inline');
    }
  }, [open, compatibleConnections.length, connectionMode]);

  // Step 3
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [matchKey, setMatchKey] = useState(DEFAULT_MATCH_KEY[targetEntity] || 'name');

  // Step 4
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(360);
  const [runImmediately, setRunImmediately] = useState(true);

  if (!open) return null;

  const fields = TARGET_FIELDS[targetEntity] || [];

  const canAdvance = (): boolean => {
    if (step === 0) return name.trim().length > 0 && targetOrgId.length > 0;
    if (step === 1) {
      if (connectionMode === 'saved') {
        // A saved connection covers host/port/credentials. We still need
        // the source-specific fields the connection profile doesn't
        // capture: which table/query, or which path under baseUrl.
        if (!savedConnectionId) return false;
        if (sourceType === 'DATABASE') return table.trim().length > 0;
        return true;
      }
      if (sourceType === 'DATABASE') return host.trim().length > 0 && database.trim().length > 0 && table.trim().length > 0;
      return url.trim().length > 0;
    }
    if (step === 2) {
      const required = fields.filter((f) => f.required);
      return required.every((f) => fieldMapping[f.key]?.trim());
    }
    return true;
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const config: Record<string, any> = {};
      let connectionId: string | null = null;

      if (connectionMode === 'saved') {
        connectionId = savedConnectionId;
        // Sync still owns table/query (DB) or any URL fragment that the
        // saved baseUrl doesn't cover. Everything else comes from the
        // referenced connection at run time via resolveEffectiveConfig.
        if (sourceType === 'DATABASE') {
          if (table.trim()) config.table = table;
          if (query.trim()) config.query = query;
        } else if (url.trim()) {
          // Allow a sync to override baseUrl with a fully qualified URL.
          config.url = url;
        }
      } else {
        if (sourceType === 'DATABASE') {
          config.dbType = dbType;
          config.host = host;
          config.port = Number(port) || 5432;
          config.database = database;
          config.schema = schema || 'public';
          config.table = table;
          if (query.trim()) config.query = query;
        } else {
          config.url = url;
          if (authHeader.trim()) config.authHeader = authHeader;
        }

        if (saveAsConnection) {
          // Promote the inline definition to a reusable Connection profile
          // before creating the sync, so future syncs can pick it up.
          try {
            const saved = await apiClient.post<{ success: boolean; data: { id: string } }>('/connections', {
              orgId: targetOrgId,
              name: `${name.trim()} (saved)`,
              connectionType: sourceType === 'DATABASE' ? 'DATABASE' : 'API',
              config: sourceType === 'DATABASE'
                ? { dbType, host, port: Number(port) || 5432, database, schema: schema || 'public' }
                : { baseUrl: url },
              credentials: {},
            });
            if (saved?.data?.id) connectionId = saved.data.id;
          } catch {
            // Non-fatal: fall through and create the sync inline only.
            addToast('error', 'Could not save inline connection — sync will use inline credentials only.');
          }
        }
      }

      const res = await apiClient.post<{ success: boolean; data: { id: string } }>('/sync-connections', {
        orgId: targetOrgId,
        name: name.trim(),
        targetEntity,
        sourceType,
        connectionId,
        config,
        fieldMapping,
        matchKey,
        schedule: {
          enabled: scheduleEnabled,
          intervalMinutes,
        },
      });

      addToast('success', `Sync connection "${name}" created`);

      if (runImmediately && res.data?.id) {
        try {
          const runRes = await apiClient.post<{ success: boolean; data: { created: number; updated: number; skipped: number; missingFromSource: number; errors: number; simulated?: boolean } }>(`/sync-connections/${res.data.id}/run`);
          const r = runRes.data;
          if (r) {
            const parts = [];
            if (r.created) parts.push(`${r.created} created`);
            if (r.updated) parts.push(`${r.updated} updated`);
            if (r.skipped) parts.push(`${r.skipped} unchanged`);
            if (r.missingFromSource) parts.push(`${r.missingFromSource} no longer in source`);
            if (r.errors) parts.push(`${r.errors} errors`);
            addToast(r.errors ? 'error' : 'success', `Sync complete${r.simulated ? ' (simulated)' : ''}: ${parts.join(', ') || 'no changes'}`);
          }
        } catch {
          addToast('error', 'Connection created but initial sync failed');
        }
      }

      onCreated();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to create sync connection';
      addToast('error', msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', width: '100%', maxWidth: 600, maxHeight: '85vh', overflow: 'auto', padding: 24, boxShadow: 'var(--shadow-lg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Connect to Source</h2>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Sync {ENTITY_LABELS[targetEntity]} from an external data source</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>&times;</button>
        </div>

        {/* Step Indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 3, borderRadius: 2, marginBottom: 4,
                background: i <= step ? 'var(--color-primary)' : 'var(--color-border)',
                transition: 'background 0.2s',
              }} />
              <span style={{ fontSize: 10, color: i <= step ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: i === step ? 600 : 400 }}>{s}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Source Type */}
        {step === 0 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Connection Name *</label>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. HR Database → ${ENTITY_LABELS[targetEntity]}`} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Organization *</label>
              <select style={selectStyle} value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)}>
                <option value="">-- Select organization --</option>
                {orgList.map((o) => {
                  const typeLabel = o.type.charAt(0).toUpperCase() + o.type.slice(1);
                  return <option key={o.id} value={o.id}>{o.name} ({typeLabel})</option>;
                })}
              </select>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Synced records will be assigned to this organization level.
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 8 }}>Source Type</label>
            {([
              { type: 'DATABASE' as SourceType, label: 'Database Table', desc: 'Connect to a PostgreSQL, MySQL, or SQL Server table' },
              { type: 'CSV_URL' as SourceType, label: 'CSV URL', desc: 'Poll a CSV file from a URL on a schedule' },
              { type: 'JSON_URL' as SourceType, label: 'JSON URL', desc: 'Poll a JSON endpoint on a schedule' },
            ]).map((opt) => (
              <label key={opt.type} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 6,
                background: sourceType === opt.type ? '#eff6ff' : 'var(--color-bg)',
                border: `1px solid ${sourceType === opt.type ? '#93c5fd' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
              }}>
                <input type="radio" name="sourceType" checked={sourceType === opt.type} onChange={() => setSourceType(opt.type)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        {/* Step 2: Connection Details */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <button
                type="button"
                onClick={() => setConnectionMode('saved')}
                disabled={compatibleConnections.length === 0}
                style={{
                  flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 500, border: 'none', cursor: compatibleConnections.length === 0 ? 'not-allowed' : 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  background: connectionMode === 'saved' ? 'var(--color-surface)' : 'transparent',
                  color: connectionMode === 'saved' ? 'var(--color-text)' : 'var(--color-text-muted)',
                  boxShadow: connectionMode === 'saved' ? 'var(--shadow-sm)' : 'none',
                  opacity: compatibleConnections.length === 0 ? 0.5 : 1,
                }}
                title={compatibleConnections.length === 0 ? 'No compatible saved connections — define one in the Connections page first' : 'Reuse a connection profile'}
              >
                Use saved connection {compatibleConnections.length > 0 && `(${compatibleConnections.length})`}
              </button>
              <button
                type="button"
                onClick={() => setConnectionMode('inline')}
                style={{
                  flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  background: connectionMode === 'inline' ? 'var(--color-surface)' : 'transparent',
                  color: connectionMode === 'inline' ? 'var(--color-text)' : 'var(--color-text-muted)',
                  boxShadow: connectionMode === 'inline' ? 'var(--shadow-sm)' : 'none',
                }}
              >
                Define inline
              </button>
            </div>

            {connectionMode === 'saved' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Saved Connection *</label>
                <select style={selectStyle} value={savedConnectionId} onChange={(e) => setSavedConnectionId(e.target.value)}>
                  <option value="">-- Select a saved connection --</option>
                  {compatibleConnections.map((c) => {
                    const detail = c.config?.host
                      ? `${c.config.host}${c.config.port ? `:${c.config.port}` : ''}${c.config.database ? `/${c.config.database}` : ''}`
                      : c.config?.baseUrl || '';
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.connectionType}{detail ? ` (${detail})` : ''}
                      </option>
                    );
                  })}
                </select>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                  Host, credentials, and base URL are read from the saved connection at sync time.
                </span>
              </div>
            )}
          </div>
        )}

        {step === 1 && sourceType === 'DATABASE' && connectionMode === 'inline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Database Type</label>
              <select style={selectStyle} value={dbType} onChange={(e) => setDbType(e.target.value as DbType)}>
                <option value="POSTGRESQL">PostgreSQL</option>
                <option value="MYSQL">MySQL</option>
                <option value="SQLSERVER">SQL Server</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Host *</label>
                <input style={inputStyle} value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. db.company.com" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Port</label>
                <input style={inputStyle} value={port} onChange={(e) => setPort(e.target.value)} placeholder="5432" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Database *</label>
                <input style={inputStyle} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="procela_db" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Schema</label>
                <input style={inputStyle} value={schema} onChange={(e) => setSchema(e.target.value)} placeholder="public" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Table *</label>
              <input style={inputStyle} value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. employees, org_units" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Custom Query (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 50, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SELECT * FROM employees WHERE active = true" />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Overrides the table setting. Use this for filtered or joined data.</span>
            </div>
          </div>
        )}

        {step === 1 && (sourceType === 'CSV_URL' || sourceType === 'JSON_URL') && connectionMode === 'inline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>URL *</label>
              <input style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={sourceType === 'CSV_URL' ? 'https://example.com/data/people.csv' : 'https://api.example.com/v1/systems'} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Authorization Header (optional)</label>
              <input style={inputStyle} value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="Bearer eyJhbG... or Basic dXNlcjpwYXNz" />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Sent as the Authorization header on each request</span>
            </div>
          </div>
        )}

        {step === 1 && sourceType === 'DATABASE' && connectionMode === 'saved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Table *</label>
              <input style={inputStyle} value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. employees, org_units" />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Which table on the saved connection to read from</span>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Custom Query (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 50, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SELECT * FROM employees WHERE active = true" />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Overrides the table setting. Use this for filtered or joined data.</span>
            </div>
          </div>
        )}

        {step === 1 && (sourceType === 'CSV_URL' || sourceType === 'JSON_URL') && connectionMode === 'saved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Override URL (optional)</label>
              <input style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Leave blank to use the saved connection's base URL" />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Useful when one base URL serves multiple endpoints</span>
            </div>
          </div>
        )}

        {step === 1 && connectionMode === 'inline' && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            <input type="checkbox" checked={saveAsConnection} onChange={(e) => setSaveAsConnection(e.target.checked)} style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Save as a reusable connection</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Promote this inline definition to a Connection profile so future syncs can pick it up.
              </div>
            </div>
          </label>
        )}

        {/* Step 3: Field Mapping */}
        {step === 2 && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Map each {ENTITY_LABELS[targetEntity].toLowerCase()} field to the column name in your source data.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fields.map((f) => (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '140px 20px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {f.label} {f.required && <span style={{ color: 'var(--color-error, #ef4444)' }}>*</span>}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>{'←'}</span>
                  <input
                    style={inputStyle}
                    value={fieldMapping[f.key] || ''}
                    onChange={(e) => setFieldMapping((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={`Source column for ${f.label.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Match Key</label>
              <select style={selectStyle} value={matchKey} onChange={(e) => setMatchKey(e.target.value)}>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                Used to detect existing records. If a source row matches an existing record on this field, it will be updated instead of duplicated.
              </span>
            </div>
          </div>
        )}

        {/* Step 4: Schedule */}
        {step === 3 && (
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Enable scheduled polling</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Automatically sync data on a recurring schedule</div>
              </div>
            </label>
            {scheduleEnabled && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Polling Interval</label>
                <select style={selectStyle} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                  {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <input type="checkbox" checked={runImmediately} onChange={(e) => setRunImmediately(e.target.checked)} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Run sync immediately after creation</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Fetches data from the source right away</div>
              </div>
            </label>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Connection</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {connectionMode === 'saved'
                  ? (() => {
                      const sel = compatibleConnections.find((c) => c.id === savedConnectionId);
                      const base = sel ? `Using saved: ${sel.name}` : 'Using saved connection';
                      if (sourceType === 'DATABASE') return `${base} · table ${table}${query ? ' (custom query)' : ''}`;
                      return url ? `${base} · ${url}` : base;
                    })()
                  : sourceType === 'DATABASE'
                    ? `${dbType} → ${host}:${port}/${database}.${table}${saveAsConnection ? ' · will save as connection' : ''}`
                    : `${url}${saveAsConnection ? ' · will save as connection' : ''}`}
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Target</div>
              <div style={{ fontSize: 13 }}>{ENTITY_LABELS[targetEntity]} — match on <strong>{matchKey}</strong></div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>Organization: {orgList.find((o) => o.id === targetOrgId)?.name || targetOrgId}</div>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Field Mapping</div>
              {Object.entries(fieldMapping).filter(([, v]) => v.trim()).map(([target, source]) => (
                <div key={target} style={{ fontSize: 12, display: 'flex', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: 'var(--color-text-muted)', minWidth: 100 }}>{target}</span>
                  <span>{'←'}</span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{source}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Schedule</div>
              <div style={{ fontSize: 12 }}>
                {scheduleEnabled
                  ? `Polling ${INTERVALS.find((i) => i.value === intervalMinutes)?.label.toLowerCase() || `every ${intervalMinutes} min`}`
                  : 'Manual sync only'}
                {runImmediately && ' · Will run immediately'}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button
            style={btnSecondary}
            onClick={() => { if (step === 0) onClose(); else setStep((s) => s - 1); }}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button
              style={{ ...btnPrimary, opacity: canAdvance() ? 1 : 0.5 }}
              disabled={!canAdvance()}
              onClick={() => setStep((s) => s + 1)}
            >
              Next
            </button>
          ) : (
            <button
              style={{ ...btnPrimary, opacity: creating ? 0.6 : 1 }}
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? 'Creating...' : 'Create Connection'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
