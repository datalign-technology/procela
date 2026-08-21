import { useState } from 'react';
import { apiClient } from '../api/client';
import { usePermissions } from '@/hooks/usePermissions';
import { successToast, errorToast } from '../lib/errorToast';
import Card from './Card';

// ──────────────────────────────────────────────────────────────────────────
// LoadDemoDataPanel — one-click seed of a demo fixture. Super-admin
// only. Idempotent: a second call wipes the prior `demo-*` rows and
// reseeds, so the button always converges on a known state.
//
// The industry picker chooses which fixture to seed — Tidewater
// Utilities or Meridian Shipbuilding. Both are built to the same
// feature coverage, so a demo of either lights up every page. Only
// one demo tenant exists at a time; seeding one clears the other.
//
// Sits above ResetAllDataPanel so the demo workflow reads top-to-
// bottom: **Load demo → run the demo → Reset everything**. Reset
// clears the fixture the same way it clears anything else — no
// special interaction between the two buttons required.
// ──────────────────────────────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
};

type Industry = 'utilities' | 'shipbuilding';

const INDUSTRIES: ReadonlyArray<{
  value: Industry;
  label: string;
  tenant: string;
  persona: string;
  blurb: string;
}> = [
  {
    value: 'utilities',
    label: 'Utilities',
    tenant: 'Tidewater Utilities',
    persona: 'Susan Chen',
    blurb: 'Multi-utility — electric + water + shared services.',
  },
  {
    value: 'shipbuilding',
    label: 'Shipbuilding',
    tenant: 'Meridian Shipbuilding',
    persona: 'Elena Ruiz',
    blurb: 'Naval + commercial shipyard — new construction + fleet sustainment.',
  },
];

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
  const [industry, setIndustry] = useState<Industry>('utilities');
  const [result, setResult] = useState<SeedResponse | null>(null);

  if (!isSuperAdmin) return null;

  const selected = INDUSTRIES.find((i) => i.value === industry)!;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiClient.post<SeedResponse>('/admin/demo-seed', { industry });
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
        One-click seed of a demo fixture — org tree, people, systems, agents, data domains, data assets, a process hierarchy with mappings, and a CDO persona pre-populated with tasks and issues so <strong>My Dashboard</strong> tells a story. Pick an industry below; both are built to the same feature coverage. Every row is stamped <code>demo-*</code>; a second click wipes the prior seed and reseeds. Safe to run repeatedly.
      </p>

      {/* Industry picker — segmented control. */}
      <div role="radiogroup" aria-label="Demo industry" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {INDUSTRIES.map((opt) => {
          const active = opt.value === industry;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={active}
              onClick={() => { setIndustry(opt.value); setConfirmOpen(false); setResult(null); }}
              disabled={busy}
              style={{
                flex: '1 1 200px', textAlign: 'left', padding: '10px 12px',
                border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
                borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--color-primary)' : 'var(--color-text)' }}>
                {opt.tenant}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{opt.blurb}</div>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
        Recommended: run once at the top of a demo, then sign in as <strong>{selected.persona}</strong> (CDO) to walk the workflow.
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
          Load {selected.tenant} demo
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text)' }}>
            Wipe any existing <code>demo-*</code> rows and seed the <strong>{selected.tenant}</strong> fixture?
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
