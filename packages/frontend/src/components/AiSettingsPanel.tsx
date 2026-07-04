import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import Combobox from './Combobox';

// Settings → AI panel. Two responsibilities:
//   1. Show what the backend is actually using right now: resolved
//      model + where the value came from (override / env / default),
//      plus a live "test now" button that pings the model with a
//      1-token call so admins can verify reachability.
//   2. Let admins pick a new model from a dropdown populated by
//      Anthropic's own /v1/models endpoint — no hardcoded list to
//      drift, no guessing which dated IDs are on which tier.

interface Settings {
  resolvedModel: string;
  overrideModel: string | null;
  envModel: string | null;
  defaultModel: string;
  source: 'override' | 'env' | 'default';
  apiKeyConfigured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface AnthropicModel {
  id: string;
  display_name?: string;
  created_at?: string;
}

interface TestResult {
  ok: boolean;
  model: string;
  message: string;
}

const SOURCE_LABEL: Record<Settings['source'], string> = {
  override: 'Override (this page)',
  env: 'Env var (ANTHROPIC_MODEL)',
  default: 'Config default',
};

export default function AiSettingsPanel({ sectionStyle, sectionTitleStyle }: {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<AnthropicModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [draftModel, setDraftModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Settings }>('/ai/settings');
      setSettings(res.data);
      setDraftModel(res.data.overrideModel || '');
    } catch (e: any) {
      setSaveError(e?.message || 'Could not load AI settings.');
    }
  }, []);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: AnthropicModel[] }>('/ai/models');
      setModels(res.data || []);
    } catch (e: any) {
      setModelsError(e?.message || 'Could not fetch the model list from Anthropic.');
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadSettings(); loadModels(); }, [loadSettings, loadModels]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      await apiClient.put('/ai/settings', { model: draftModel.trim() });
      await loadSettings();
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ success: boolean; data: TestResult }>('/ai/test');
      setTestResult(res.data);
    } catch (e: any) {
      setTestResult({ ok: false, model: settings?.resolvedModel || '', message: e?.message || 'Test failed.' });
    } finally {
      setTesting(false);
    }
  }

  const canSave = settings && draftModel.trim() !== (settings.overrideModel || '');

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>AI (Claude)</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
        Configure the Claude model Procela uses for process-template generation, data-domain suggestions, chat, and other server-side AI calls. The list below comes directly from Anthropic and shows only models your API key can access — no need to hunt for a valid ID.
      </p>

      {!settings ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : !settings.apiKeyConfigured ? (
        <div style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
          <strong>ANTHROPIC_API_KEY is not set.</strong> Add it to the backend <code>.env</code> file and restart the backend before the wizard, chat, or any AI feature will work.
        </div>
      ) : (
        <>
          {/* Current-state summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13, marginBottom: 16 }}>
            <div style={{ color: 'var(--color-text-muted)' }}>Resolved model</div>
            <div><code>{settings.resolvedModel}</code></div>
            <div style={{ color: 'var(--color-text-muted)' }}>Source</div>
            <div>{SOURCE_LABEL[settings.source]}</div>
            {settings.envModel && (
              <>
                <div style={{ color: 'var(--color-text-muted)' }}>Env var</div>
                <div><code>{settings.envModel}</code></div>
              </>
            )}
            <div style={{ color: 'var(--color-text-muted)' }}>Config default</div>
            <div><code>{settings.defaultModel}</code></div>
            {settings.updatedAt && (
              <>
                <div style={{ color: 'var(--color-text-muted)' }}>Last change</div>
                <div>{new Date(settings.updatedAt).toLocaleString()}</div>
              </>
            )}
          </div>

          {/* Test button */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
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
              </div>
            )}
          </div>

          {/* Model picker */}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            Override model
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <Combobox
                value={draftModel}
                onChange={setDraftModel}
                options={models.map((m) => m.id)}
                placeholder={loadingModels ? 'Loading models…' : 'Pick a model or type an ID'}
                ariaLabel="Anthropic model ID"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                borderRadius: 6, cursor: !canSave || saving ? 'not-allowed' : 'pointer',
                opacity: !canSave || saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
            Leave blank and save to clear the override and fall back to the env var / default.
          </div>

          {modelsError && (
            <div style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10 }}>
              Couldn't fetch the model list: {modelsError}. You can still type an ID manually.
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
