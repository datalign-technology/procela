import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

// ──────────────────────────────────────────────────────────────────────────
// Data Quality Rules modal — shared between DataAssetsPage (legacy entry)
// and DataQualityPage (new primary entry).
// ──────────────────────────────────────────────────────────────────────────

export type RuleType = 'NOT_NULL' | 'UNIQUE' | 'REGEX_MATCH' | 'IN_SET' | 'NUMERIC_RANGE' | 'LENGTH_RANGE' | 'CUSTOM';

export interface RuleDefinition {
  language: 'sql' | 'js' | 'pseudo';
  body: string;
  executable: boolean;
}

interface RuleTemplate {
  id: string;
  ruleType: RuleType;
  dimension: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  definition?: RuleDefinition;
}

interface DQRule {
  id: string;
  dataAssetId: string;
  name: string;
  description: string;
  dimension: string;
  threshold: number;
  currentScore: number;
  status: 'PASSING' | 'FAILING' | 'WARNING' | 'NOT_MEASURED';
  lastMeasured: string | null;
  ruleType?: RuleType;
  parameters?: Record<string, any>;
  definition?: RuleDefinition | null;
  lastRun?: {
    ranAt: string;
    simulated: boolean;
    totalRows: number;
    passCount: number;
    failCount: number;
    passRate: number;
    failureSamples: string[];
    message: string;
  };
}

/** Minimum asset shape the modal needs — avoids coupling to the full DataAsset. */
export interface RulesModalAsset {
  id: string;
  name: string;
  sourceAsset?: string;
  sourceColumn?: string;
}

// ── Inline styles (kept local so the modal is self-contained) ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};

/**
 * Renders the concrete "definition" of a rule — the SQL a database driver
 * would run, the JS an in-process engine applies to a file, or the
 * pseudocode shown when no driver exists for the source.
 */
export function DefinitionBlock({ def, label = 'Definition' }: { def: RuleDefinition | null | undefined; label?: string }) {
  if (!def) return null;
  const tag = def.language.toUpperCase();
  const tagColor = def.language === 'sql' ? '#1e40af' : def.language === 'js' ? '#0f4f46' : '#64748b';
  return (
    <div style={{ marginTop: 6, padding: '6px 8px', background: '#0b1220', color: '#d1d5db', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'auto', whiteSpace: 'pre' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontFamily: 'inherit', fontSize: 10, color: '#9ca3af' }}>
        <span style={{ padding: '1px 5px', borderRadius: 3, background: tagColor, color: '#fff', fontWeight: 600, letterSpacing: '0.04em' }}>{tag}</span>
        <span>{label}</span>
        {!def.executable && <span style={{ color: '#f59e0b' }}>\u2014 not executable here (display only)</span>}
      </div>
      <code style={{ color: '#e5e7eb' }}>{def.body}</code>
    </div>
  );
}

export default function DataQualityRulesModal({ asset, onClose, onAfterChange }: {
  asset: RulesModalAsset;
  onClose: () => void;
  onAfterChange: () => void;
}) {
  const [rules, setRules] = useState<DQRule[]>([]);
  const [suggested, setSuggested] = useState<RuleTemplate[]>([]);
  const [generic, setGeneric] = useState<RuleTemplate[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [configuringTemplateId, setConfiguringTemplateId] = useState<string | null>(null);
  const [configParams, setConfigParams] = useState<Record<string, any>>({});

  const columnName = asset.sourceColumn;

  const load = async () => {
    try {
      const tmplQuery = [
        columnName ? `column=${encodeURIComponent(columnName)}` : '',
        `assetId=${encodeURIComponent(asset.id)}`,
      ].filter(Boolean).join('&');
      const [rulesRes, tmplRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DQRule[] }>(`/data-quality/by-asset/${asset.id}`),
        apiClient.get<{ success: boolean; data: { suggested: RuleTemplate[]; generic: RuleTemplate[] } }>(
          `/data-quality/templates?${tmplQuery}`,
        ),
      ]);
      setRules(rulesRes.data || []);
      setSuggested(tmplRes.data?.suggested || []);
      setGeneric(tmplRes.data?.generic || []);
    } catch { /* */ }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [asset.id]);

  const needsConfig = (t: RuleTemplate): boolean => {
    if (t.ruleType === 'IN_SET') return !t.parameters.allowedValues || t.parameters.allowedValues.length === 0;
    if (t.ruleType === 'NUMERIC_RANGE') return t.parameters.min === undefined && t.parameters.max === undefined;
    if (t.ruleType === 'LENGTH_RANGE') return t.parameters.minLength === undefined && t.parameters.maxLength === undefined;
    if (t.ruleType === 'CUSTOM') return !t.parameters.body || !String(t.parameters.body).trim();
    return false;
  };

  const addFromTemplate = async (t: RuleTemplate, overrideParams?: Record<string, any>) => {
    try {
      const parameters = overrideParams ?? t.parameters;
      await apiClient.post('/data-quality', {
        dataAssetId: asset.id,
        name: columnName ? `${columnName}: ${t.name}` : t.name,
        description: t.description,
        dimension: t.dimension,
        ruleType: t.ruleType,
        parameters,
        threshold: 95,
      });
      setConfiguringTemplateId(null);
      setConfigParams({});
      await load();
      onAfterChange();
    } catch { /* */ }
  };

  const handleAddClick = (t: RuleTemplate) => {
    if (needsConfig(t)) {
      setConfiguringTemplateId(t.id);
      setConfigParams({ ...t.parameters });
    } else {
      addFromTemplate(t);
    }
  };

  const runRule = async (rule: DQRule) => {
    setRunningId(rule.id);
    try {
      await apiClient.post(`/data-quality/${rule.id}/run`);
      await load();
      onAfterChange();
    } catch { /* */ } finally {
      setRunningId(null);
    }
  };

  const deleteRule = async (rule: DQRule) => {
    try {
      await apiClient.delete(`/data-quality/${rule.id}`);
      await load();
      onAfterChange();
    } catch { /* */ }
  };

  const templateRow = (t: RuleTemplate) => {
    const isConfiguring = configuringTemplateId === t.id;
    return (
      <div key={t.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{t.description}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {t.ruleType}{t.parameters.pattern ? ` /${t.parameters.pattern}/` : ''}
            </div>
            {t.definition && <DefinitionBlock def={t.definition} label="Would execute" />}
          </div>
          <button
            onClick={() => handleAddClick(t)}
            style={{ ...btnPrimary, padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap' }}
            disabled={isConfiguring}
          >
            {isConfiguring ? 'Configure \u2193' : '+ Add'}
          </button>
        </div>
        {isConfiguring && (
          <div style={{ marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 4 }}>
            {t.ruleType === 'IN_SET' && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Allowed values (comma-separated)
                </label>
                <input
                  style={{ ...inputStyle, fontSize: 12 }}
                  placeholder="e.g. active, inactive, suspended"
                  value={(configParams.allowedValues || []).join(', ')}
                  onChange={(e) => setConfigParams({
                    ...configParams,
                    allowedValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                  })}
                />
              </div>
            )}
            {t.ruleType === 'NUMERIC_RANGE' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Min</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.min ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Max</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.max ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              </div>
            )}
            {t.ruleType === 'LENGTH_RANGE' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Min length</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.minLength ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, minLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Max length</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.maxLength ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              </div>
            )}
            {t.ruleType === 'CUSTOM' && (
              <div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`lang-${t.id}`}
                      checked={(configParams.language || 'js') === 'js'}
                      onChange={() => setConfigParams({ ...configParams, language: 'js' })}
                    />
                    JS (executes on LOCAL files)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`lang-${t.id}`}
                      checked={configParams.language === 'sql'}
                      onChange={() => setConfigParams({ ...configParams, language: 'sql' })}
                    />
                    SQL (display-only, simulated)
                  </label>
                </div>
                <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  {(configParams.language || 'js') === 'js'
                    ? 'Expression (runs once per value — the current value is bound to `value`)'
                    : 'SQL query'}
                </label>
                <textarea
                  style={{ ...inputStyle, fontSize: 12, fontFamily: 'var(--font-mono)', minHeight: 70, whiteSpace: 'pre' }}
                  placeholder={(configParams.language || 'js') === 'js'
                    ? "value !== null && /^HII-\\d+$/.test(value)"
                    : 'SELECT COUNT(*) FILTER (WHERE my_column IS NULL) AS fail_count, COUNT(*) AS total FROM my_table;'}
                  value={configParams.body || ''}
                  onChange={(e) => setConfigParams({ ...configParams, body: e.target.value })}
                />
                <div style={{ fontSize: 10, color: '#92400e', marginTop: 4 }}>
                  Heads up: JS expressions run server-side via `new Function()`. Fine in this prototype; real deployments need a proper sandbox.
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                style={{ ...btnSecondary, padding: '4px 12px', fontSize: 11 }}
                onClick={() => { setConfiguringTemplateId(null); setConfigParams({}); }}
              >Cancel</button>
              <button
                style={{ ...btnPrimary, padding: '4px 12px', fontSize: 11 }}
                onClick={() => addFromTemplate(t, configParams)}
              >Add rule</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', padding: 20, maxWidth: 820, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Data Quality Rules — {asset.name}</h3>
            {(asset.sourceAsset || columnName) && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {asset.sourceAsset || ''}{columnName ? `.${columnName}` : ''}
              </p>
            )}
            {!columnName && (
              <p style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                This asset isn\u2019t bound to a specific column, so rules will run against the whole asset (simulated only).
              </p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>&times;</button>
        </div>

        {/* Active rules */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Active rules ({rules.length})
          </div>
          {rules.length === 0 ? (
            <div style={{ padding: '12px 14px', border: '1px dashed var(--color-border)', borderRadius: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
              No rules yet. Pick a template below to add one.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--color-border)', borderRadius: 4 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Last Run</th>
                  <th style={thStyle}>Result</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const pr = r.lastRun?.passRate;
                  const prColor = pr === undefined ? '#64748b' : pr >= 95 ? '#16a34a' : pr >= 80 ? '#ca8a04' : '#dc2626';
                  return (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500 }}>{r.name}</div>
                        {r.description && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.description}</div>}
                        <DefinitionBlock def={r.definition} label="Engine runs" />
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11, fontFamily: 'var(--font-mono)' }}>{r.ruleType || '\u2014'}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {r.lastRun ? new Date(r.lastRun.ranAt).toLocaleString() : 'Never'}
                        {r.lastRun?.simulated && <span style={{ marginLeft: 4, fontSize: 10, color: '#92400e' }}>(simulated)</span>}
                      </td>
                      <td style={tdStyle}>
                        {r.lastRun ? (
                          <div>
                            <div style={{ fontWeight: 600, color: prColor, fontSize: 13 }}>
                              {r.lastRun.passRate}% pass ({r.lastRun.passCount.toLocaleString()}/{r.lastRun.totalRows.toLocaleString()})
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.lastRun.message}</div>
                            {r.lastRun.failureSamples.length > 0 && (
                              <div style={{ fontSize: 10, color: '#7f1d1d', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                                Samples: {r.lastRun.failureSamples.slice(0, 3).join(', ')}{r.lastRun.failureSamples.length > 3 ? '\u2026' : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Not yet run</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button
                          style={{ ...btnPrimary, padding: '3px 10px', fontSize: 11, marginRight: 4, opacity: !r.ruleType || runningId === r.id ? 0.6 : 1 }}
                          disabled={!r.ruleType || runningId === r.id}
                          onClick={() => runRule(r)}
                          title={r.ruleType ? 'Run rule against the data' : 'Legacy rule \u2014 no typed execution'}
                        >
                          {runningId === r.id ? 'Running\u2026' : 'Run'}
                        </button>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 11 }}
                          onClick={() => deleteRule(r)}
                        >Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Templates */}
        <div style={{ marginTop: 20 }}>
          {suggested.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Suggested for {columnName ? <code>{columnName}</code> : 'this asset'}
              </div>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, marginBottom: 16 }}>
                {suggested.map(templateRow)}
              </div>
            </>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            All rule templates
          </div>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {generic.map(templateRow)}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={btnSecondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
