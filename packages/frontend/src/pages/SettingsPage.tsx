import { useState, useEffect } from 'react';
import { INDUSTRIES } from '../types';
import { apiClient } from '../api/client';

interface Organization {
  id: string;
  name: string;
  industry?: string;
}

interface OrgListResponse {
  success: boolean;
  data: Organization[];
}

interface OrgUpdateResponse {
  success: boolean;
  data: Organization;
}

interface ConfigResponse {
  aiConfigured: boolean;
}

export default function SettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const orgsRes = await apiClient.get<OrgListResponse>('/organizations');
        const firstOrg = orgsRes.data?.[0];
        if (firstOrg) {
          setOrg(firstOrg);
          setName(firstOrg.name);
          setIndustry(firstOrg.industry ?? '');
        }
      } catch {
        setError('Failed to load organization.');
      }

      try {
        const configRes = await apiClient.get<ConfigResponse>('/health/config');
        setAiConfigured(configRes.aiConfigured);
      } catch {
        // Non-critical — just leave as unknown
      }
    }
    load();
  }, []);

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setSuccessMsg('');
    setError('');

    try {
      const res = await apiClient.put<OrgUpdateResponse>(`/organizations/${org.id}`, {
        name,
        industry,
      });
      setOrg(res.data);
      setSuccessMsg('Settings saved successfully.');
    } catch {
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</h1>

      {/* Organization section */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
          maxWidth: 600,
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
          Organization
        </h2>

        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--color-text)',
              marginBottom: '0.375rem',
            }}
          >
            Organization Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter organization name"
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--color-text)',
              marginBottom: '0.375rem',
            }}
          >
            Industry
          </label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              background: 'var(--color-surface)',
              boxSizing: 'border-box',
            }}
          >
            <option value="">Select an industry...</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          style={{
            padding: '0.5rem 1.25rem',
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
            opacity: saving || !name.trim() ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>

        {successMsg && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#f0fdf4',
              color: 'var(--color-success)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
            }}
          >
            {successMsg}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#fef2f2',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* API Configuration section */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
          maxWidth: 600,
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
          API Configuration
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
            Anthropic API Key:
          </span>
          {aiConfigured === null ? (
            <span
              style={{
                fontSize: '0.875rem',
                color: 'var(--color-text-muted)',
              }}
            >
              Checking...
            </span>
          ) : aiConfigured ? (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#f0fdf4',
                color: 'var(--color-success)',
              }}
            >
              Configured
            </span>
          ) : (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#fef2f2',
                color: 'var(--color-error)',
              }}
            >
              Not configured
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
