import { useState } from 'react';
import { apiClient } from '../api/client';
import { usePermissions } from '@/hooks/usePermissions';
import { successToast, errorToast } from '../lib/errorToast';
import Card from './Card';

// ──────────────────────────────────────────────────────────────────────────
// LoadDemoDataPanel — one-click seed of the Tidewater Utilities
// demo fixture. Super-admin only. Idempotent: a second call wipes
// the prior `demo-*` rows and reseeds, so the button always
// converges on a known state.
//
// Sits above ResetAllDataPanel so the demo workflow reads top-to-
// bottom: **Load demo → run the demo → Reset everything**. Reset
// clears the fixture the same way it clears anything else — no
// special interaction between the two buttons required.
//
// Payload is fixed on the server side — no options exposed here on
// purpose. The single-button surface keeps the demo prep from
// turning into a multi-step wizard.
// ──────────────────────────────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
};

interface SeedResponse {
  success: boolean;
  message?: string;
  data?: {
    organizations: number;
    people: number;
    dataAssets: number;
    processNodes: number;
    mappings: number;
    persona: { id: string; name: string };
  };
}

export default function LoadDemoDataPanel() {
  const { isSuperAdmin } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SeedResponse | null>(null);

  if (!isSuperAdmin) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiClient.post<SeedResponse>('/admin/demo-seed', {});
      setResult(res);
      successToast(res.message || 'Demo data loaded');
    } catch (e) {
      errorToast(e, 'Failed to load demo data');
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <Card marginBottom="1.5rem" padding="1.5rem" borderColor="#0f4f46">
      <h3 style={sectionTitleStyle}>Load demo data</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        One-click seed of the Tidewater Utilities demo fixture — org tree, people, systems, agents, data domains, data assets, a process hierarchy with mappings, and a Susan Chen persona pre-populated with tasks and issues so <strong>My Dashboard</strong> tells a story. Every row is stamped <code>demo-*</code>; a second click wipes the prior seed and reseeds. Safe to run repeatedly.
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
        Recommended: run once at the top of a demo, then sign in as <strong>Susan Chen</strong> (CDO) to walk the workflow.
      </p>
      {!confirmOpen ? (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            background: '#0f4f46', color: '#fff', border: 'none',
            borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Load Tidewater demo
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text)' }}>
            Wipe any existing <code>demo-*</code> rows and seed the fixture?
          </span>
          <button
            onClick={run}
            disabled={busy}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              background: '#0f4f46', color: '#fff', border: 'none',
              borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Seeding…' : 'Yes, load demo'}
          </button>
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            style={{
              padding: '6px 14px', fontSize: 12,
              background: 'var(--color-surface)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', borderRadius: 4,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {result?.success && result.data && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: '#d1f0eb', border: '1px solid #6ee7b7', borderRadius: 4, fontSize: 12, color: '#065f46' }}>
          Seeded — {result.data.organizations} orgs, {result.data.people} people, {result.data.dataAssets} data assets, {result.data.processNodes} process nodes, {result.data.mappings} mappings. Sign in as <strong>{result.data.persona.name}</strong> to see the demo persona.
        </div>
      )}
    </Card>
  );
}
