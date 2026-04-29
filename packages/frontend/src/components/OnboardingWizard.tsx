import { useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { INDUSTRIES } from '../types';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '10px 24px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
};

const PHASE_INFO = [
  { num: 1, title: 'Define', description: 'Describe how your business works using a structured process hierarchy. No technical knowledge required.', color: '#3b82f6' },
  { num: 2, title: 'Connect', description: 'Link each process step to the data and systems that support it, in plain business language.', color: '#8b5cf6' },
  { num: 3, title: 'Discover', description: 'Find gaps, monitor health, and connect to real data sources as your program matures.', color: '#22c55e' },
];

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { setActiveOrg, triggerRefresh } = useOrgContext();
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [generateTemplate, setGenerateTemplate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const handleCreateOrg = async () => {
    if (!orgName.trim()) { setError('Organization name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.post<{ success: boolean; data: { id: string; name: string; type: string } }>('/organizations', {
        name: orgName.trim(),
        type: 'company',
        industry: industry || undefined,
      });
      const org = res.data;
      setCreatedOrgId(org.id);
      setActiveOrg(org.id, org.name, org.type);
      triggerRefresh();
      setStep(2);
    } catch (err: any) {
      setError(err?.message || 'Failed to create organization. Please try again.');
    } finally { setSaving(false); }
  };

  const handleFinish = async () => {
    if (generateTemplate && createdOrgId) {
      setGenerating(true);
      try {
        await apiClient.post('/process-catalog/apply-governance-template', { orgId: createdOrgId });
      } catch { /* template generation is best-effort */ }
      try {
        await apiClient.post('/data-domains/generate', { industry: industry || 'Manufacturing' });
      } catch { /* domain generation is best-effort */ }
      setGenerating(false);
    }
    localStorage.setItem('procela:onboarding-complete', 'true');
    triggerRefresh();
    onComplete();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 12, maxWidth: 560, width: '95vw',
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)', overflow: 'hidden',
      }}>
        {/* Progress bar */}
        <div style={{ display: 'flex', height: 4 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, background: i <= step ? 'var(--color-primary)' : 'var(--color-border)', transition: 'background 0.3s' }} />
          ))}
        </div>

        <div style={{ padding: '32px 36px' }}>
          {/* Step 0: Welcome */}
          {step === 0 && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Welcome to Procela</h1>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
                Procela helps you connect your business processes to the data and systems that support them.
                Here's how it works:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
                {PHASE_INFO.map((phase) => (
                  <div key={phase.num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', background: phase.color,
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700, flexShrink: 0,
                    }}>{phase.num}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{phase.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginTop: 2 }}>{phase.description}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={btnPrimary} onClick={() => setStep(1)}>Get Started</button>
              </div>
            </>
          )}

          {/* Step 1: Create Organization */}
          {step === 1 && (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Set up your organization</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                Everything in Procela is scoped to an organization. Start by naming yours and selecting your industry
                so we can suggest relevant process templates.
              </p>
              {error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--color-text)' }}>Organization name *</label>
                  <input
                    autoFocus
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Acme Corp, City of Portland, Your Company"
                    style={{
                      width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateOrg()}
                  />
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    This is your top-level company or agency. You can add divisions and teams later.
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--color-text)' }}>Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', appearance: 'auto' as any,
                    }}
                  >
                    <option value="">-- Select your industry --</option>
                    {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Helps Procela suggest relevant process templates and data categories for your sector.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button style={btnSecondary} onClick={() => setStep(0)}>Back</button>
                <button
                  style={{ ...btnPrimary, opacity: !orgName.trim() || saving ? 0.6 : 1, cursor: !orgName.trim() || saving ? 'not-allowed' : 'pointer' }}
                  disabled={!orgName.trim() || saving}
                  onClick={handleCreateOrg}
                >
                  {saving ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </>
          )}

          {/* Step 2: Ready to go */}
          {step === 2 && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{'✓'}</div>
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
                {orgName} is ready
              </h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
                Your organization has been created. Would you like Procela to generate a starting
                process hierarchy and data domains based on your industry?
              </p>

              <div style={{
                background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 20,
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={generateTemplate}
                    onChange={(e) => setGenerateTemplate(e.target.checked)}
                    style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Generate industry templates</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
                      Creates a starter set of governance processes and data domains tailored to
                      {industry ? ` the ${industry} industry` : ' your organization'}. You can edit or remove anything afterward.
                    </div>
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  style={{ ...btnPrimary, opacity: generating ? 0.6 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
                  disabled={generating}
                  onClick={handleFinish}
                >
                  {generating ? 'Setting up...' : generateTemplate ? 'Generate & Continue' : 'Continue to Dashboard'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
