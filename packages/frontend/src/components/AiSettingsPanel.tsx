import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';

// Settings → AI panel (multi-vendor, phase 3b). Lets an org admin choose the
// AI vendor + model + key THIS organization uses, overriding the deployment
// default. Reads/writes the per-tenant endpoints:
//   GET  /ai/org-config        — current org config + the deployment fallback
//   PUT  /ai/org-config        — set/clear the org's provider/model/key
//   POST /ai/org-config/test   — probe the vendor this org will actually use
// The API key is write-only here: the stored value is never returned, only a
// "configured" flag; leaving the field blank keeps the existing key.

type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'bedrock';

interface OrgConfig {
  provider: ProviderName | null;
  model: string | null;
  baseUrl: string | null;
  region: string | null;
  enabled: boolean;
  apiKeyConfigured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface OrgConfigResponse {
  orgConfig: OrgConfig;
  deploymentDefault: { provider: string; model: string };
  encryptionConfigured: boolean;
}

interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  source: 'org' | 'deployment';
}

// '' is the sentinel for "use the deployment default" (clears the override).
const PROVIDER_OPTIONS: Array<{ value: '' | ProviderName; label: string }> = [
  { value: '', label: 'Use deployment default' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI / Azure / self-hosted' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'bedrock', label: 'AWS Bedrock' },
];

const MODEL_PLACEHOLDER: Record<ProviderName, string> = {
  anthropic: 'e.g. claude-sonnet-5 (blank = deployment default)',
  openai: 'e.g. gpt-4o (blank = deployment default)',
  gemini: 'e.g. gemini-1.5-pro (blank = deployment default)',
  bedrock: 'e.g. anthropic.claude-3-5-sonnet-... (blank = deployment default)',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: '1px solid var(--color-border)', borderRadius: 6,
  background: 'var(--color-surface)', color: 'var(--color-text)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500,
  color: 'var(--color-text-secondary)', margin: '0 0 4px',
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 };

export default function AiSettingsPanel({ sectionStyle, sectionTitleStyle }: {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}) {
  const [data, setData] = useState<OrgConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft form state.
  const [provider, setProvider] = useState<'' | ProviderName>('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [region, setRegion] = useState('');
  // The key is write-only: `apiKey` holds a freshly-typed value; `clearKey`
  // asks to remove the stored one. An untouched blank field keeps the key.
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const hydrate = useCallback((res: OrgConfigResponse) => {
    setData(res);
    setProvider(res.orgConfig.provider ?? '');
    setModel(res.orgConfig.model ?? '');
    setBaseUrl(res.orgConfig.baseUrl ?? '');
    setRegion(res.orgConfig.region ?? '');
    setApiKey('');
    setClearKey(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: OrgConfigResponse }>('/ai/org-config');
      hydrate(res.data);
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not load AI provider settings.'));
    }
  }, [hydrate]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        provider: provider || null,
        model: model.trim() || null,
        baseUrl: baseUrl.trim() || null,
        region: region.trim() || null,
      };
      // Only touch the key when the admin typed a new one or asked to clear it;
      // otherwise omit it so the stored key is preserved.
      if (clearKey) body.apiKey = null;
      else if (apiKey.trim()) body.apiKey = apiKey.trim();
      const res = await apiClient.put<{ success: boolean; data: OrgConfig }>('/ai/org-config', body);
      // Reload to pick up the fresh deployment-default context + apiKeyConfigured.
      if (data) setData({ ...data, orgConfig: res.data });
      await load();
    } catch (e) {
      setSaveError(errorMessage(e, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ success: boolean; data: TestResult }>('/ai/org-config/test');
      setTestResult(res.data);
    } catch (e) {
      setTestResult({ ok: false, provider: '', model: '', message: errorMessage(e, 'Test failed.'), source: 'org' });
    } finally {
      setTesting(false);
    }
  }

  const usingOverride = !!provider;
  const showKey = usingOverride && provider !== 'bedrock';

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>AI provider</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
        Choose the AI model vendor this organization uses for process-template generation, data-domain suggestions, chat, and other server-side AI. Leave it on the deployment default, or bring your own vendor and key. The key is stored encrypted and never shown again.
      </p>

      {loadError ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
          {loadError}
        </div>
      ) : !data ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : (
        <>
          {/* Deployment fallback context */}
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
            Deployment default (used when this org has no provider set):{' '}
            <code>{data.deploymentDefault.provider}</code> · <code>{data.deploymentDefault.model}</code>
          </div>

          {/* Provider picker */}
          <label style={labelStyle}>Provider for this organization</label>
          <select
            aria-label="AI provider"
            value={provider}
            onChange={(e) => { setProvider(e.target.value as '' | ProviderName); setTestResult(null); }}
            style={{ ...inputStyle, maxWidth: 360, appearance: 'auto' as React.CSSProperties['appearance'] }}
          >
            {PROVIDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {usingOverride && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, maxWidth: 480 }}>
              <div>
                <label style={labelStyle}>Model</label>
                <input aria-label="Model" style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} placeholder={MODEL_PLACEHOLDER[provider]} />
              </div>

              {provider === 'openai' && (
                <div>
                  <label style={labelStyle}>Base URL</label>
                  <input aria-label="OpenAI base URL" style={inputStyle} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="blank = api.openai.com; set for Azure / Ollama / vLLM / LiteLLM" />
                </div>
              )}

              {provider === 'bedrock' && (
                <div>
                  <label style={labelStyle}>AWS region</label>
                  <input aria-label="AWS region" style={inputStyle} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. us-east-1" />
                  <div style={hintStyle}>Bedrock uses the deployment's AWS credential chain — no key needed here.</div>
                </div>
              )}

              {showKey && (
                <div>
                  <label style={labelStyle}>API key</label>
                  <input
                    aria-label="API key"
                    type="password"
                    autoComplete="new-password"
                    style={{ ...inputStyle, opacity: clearKey ? 0.5 : 1 }}
                    value={apiKey}
                    disabled={clearKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={data.orgConfig.apiKeyConfigured ? '•••••••• configured — blank keeps it' : 'Paste the vendor API key'}
                  />
                  {data.orgConfig.apiKeyConfigured && (
                    <label style={{ ...hintStyle, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={clearKey} onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(''); }} />
                      Remove the stored key
                    </label>
                  )}
                  {!data.encryptionConfigured && (
                    <div style={{ ...hintStyle, color: 'var(--color-warning)' }}>
                      At-rest encryption isn't configured (MFA_ENCRYPTION_KEY / KMS). Keys are stored in plaintext — set it before storing a production key.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-surface)', border: '1px solid var(--color-primary)',
                color: 'var(--color-primary)', borderRadius: 6,
                cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.6 : 1,
              }}
            >
              {testing ? 'Testing…' : 'Test now'}
            </button>
            {testResult && (
              <div style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 13,
                background: testResult.ok ? '#dcfce7' : '#fee2e2',
                color: testResult.ok ? '#166534' : '#991b1b',
                border: `1px solid ${testResult.ok ? '#86efac' : '#fecaca'}`,
              }}>
                {testResult.ok ? '✓' : '✗'} {testResult.message}
                {testResult.provider && (
                  <span style={{ opacity: 0.8 }}> · {testResult.provider} / {testResult.model} ({testResult.source})</span>
                )}
              </div>
            )}
          </div>

          {data.orgConfig.updatedAt && (
            <div style={{ ...hintStyle, marginTop: 10 }}>
              Last changed {new Date(data.orgConfig.updatedAt).toLocaleString()}.
            </div>
          )}
          {saveError && (
            <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10 }}>
              {saveError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
