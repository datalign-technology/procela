import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

export default function SettingsPage() {
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiClient.get<{ aiConfigured: boolean }>('/health/config');
        setAiConfigured(res.aiConfigured);
      } catch { /* */ }
    }
    load();
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</h1>

      {/* API Configuration */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '1.5rem', maxWidth: 600 }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>API Configuration</h2>
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
