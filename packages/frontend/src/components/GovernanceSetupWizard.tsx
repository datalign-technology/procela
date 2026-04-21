import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

interface GovStatus {
  hasGovProcesses: boolean;
  hasGovGroups: boolean;
  hasDomains: boolean;
  isComplete: boolean;
}

const stepStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', marginBottom: 8,
};

export default function GovernanceSetupWizard() {
  const { activeOrgId } = useOrgContext();
  const [status, setStatus] = useState<GovStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const checkStatus = async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: GovStatus }>(`/dashboard/governance-status${query}`);
      setStatus(res.data);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { checkStatus(); }, [activeOrgId]);

  const applyStep = async (step: 'processes' | 'groups' | 'domains') => {
    setApplying(step);
    try {
      if (step === 'processes') {
        const res = await apiClient.post<{ success: boolean; message?: string }>('/process-catalog/apply-governance-template', { orgId: activeOrgId || undefined });
        setMessages((prev) => [...prev, res.message || 'Governance processes created']);
      } else if (step === 'groups') {
        await apiClient.post('/governance-groups/generate-template', { orgId: activeOrgId || undefined });
        setMessages((prev) => [...prev, 'Governance groups created (Council, Office, Committee, Stewardship Teams, Working Group)']);
      } else if (step === 'domains') {
        const industry = 'General';
        try {
          const orgRes = await apiClient.get<{ success: boolean; data: { industry?: string } }>(`/organizations/${activeOrgId}`);
          if (orgRes.data?.industry) {
            const genRes = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>('/data-domains/generate', { industry: orgRes.data.industry });
            const suggestions = genRes.data || [];
            for (const d of suggestions) {
              await apiClient.post('/data-domains', { name: d.name, description: d.description, orgId: activeOrgId });
            }
            setMessages((prev) => [...prev, `Created ${suggestions.length} data domains based on ${orgRes.data.industry} industry`]);
          } else {
            const defaults = ['Customer Data', 'Financial Data', 'Operational Data', 'Employee Data', 'Regulatory & Compliance'];
            for (const name of defaults) {
              await apiClient.post('/data-domains', { name, description: `${name} domain`, orgId: activeOrgId });
            }
            setMessages((prev) => [...prev, `Created ${defaults.length} default data domains`]);
          }
        } catch {
          setMessages((prev) => [...prev, 'Failed to create domains']);
        }
      }
      await checkStatus();
    } catch (e: any) {
      setMessages((prev) => [...prev, e?.message || `Failed to set up ${step}`]);
    } finally {
      setApplying(null);
    }
  };

  const applyAll = async () => {
    if (!status?.hasGovProcesses) await applyStep('processes');
    if (!status?.hasGovGroups) await applyStep('groups');
    if (!status?.hasDomains) await applyStep('domains');
  };

  if (loading) return null;
  if (!status || status.isComplete) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
      border: '1px solid #93c5fd',
      borderRadius: 'var(--radius-md)',
      padding: 20, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Set Up Governance Framework</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Get started with a DAMA-aligned data governance framework. Each component can be customized after creation.
          </p>
        </div>
        <button
          onClick={applyAll}
          disabled={applying !== null}
          style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600,
            background: 'var(--color-primary)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-md)', cursor: applying ? 'default' : 'pointer',
            opacity: applying ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          {applying ? 'Setting up...' : 'Set Up All'}
        </button>
      </div>

      {/* Steps */}
      <div style={stepStyle}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: status.hasGovProcesses ? '#d1fae5' : '#dbeafe', color: status.hasGovProcesses ? '#065f46' : '#1e40af' }}>
          {status.hasGovProcesses ? '✓' : '1'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Governance Processes</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Creates a "Data Governance Management" value stream with 6 processes and 31 activities — each with DAMA-aligned responsible roles and defined inputs/outputs.
          </div>
        </div>
        {!status.hasGovProcesses && (
          <button onClick={() => applyStep('processes')} disabled={applying !== null}
            style={{ padding: '4px 14px', fontSize: 12, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', opacity: applying ? 0.6 : 1 }}>
            {applying === 'processes' ? 'Creating...' : 'Create'}
          </button>
        )}
      </div>

      <div style={stepStyle}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: status.hasGovGroups ? '#d1fae5' : '#dbeafe', color: status.hasGovGroups ? '#065f46' : '#1e40af' }}>
          {status.hasGovGroups ? '✓' : '2'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Governance Groups</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Creates the organizational structure: Council, Office, Committee, Stewardship Teams, and Working Groups. Assign your people to each group after creation.
          </div>
        </div>
        {!status.hasGovGroups && (
          <button onClick={() => applyStep('groups')} disabled={applying !== null}
            style={{ padding: '4px 14px', fontSize: 12, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', opacity: applying ? 0.6 : 1 }}>
            {applying === 'groups' ? 'Creating...' : 'Create'}
          </button>
        )}
      </div>

      <div style={stepStyle}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: status.hasDomains ? '#d1fae5' : '#dbeafe', color: status.hasDomains ? '#065f46' : '#1e40af' }}>
          {status.hasDomains ? '✓' : '3'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Data Domains</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Creates starter data domains based on your industry. Assign domain owners and stewards, then link your data assets to each domain.
          </div>
        </div>
        {!status.hasDomains && (
          <button onClick={() => applyStep('domains')} disabled={applying !== null}
            style={{ padding: '4px 14px', fontSize: 12, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', opacity: applying ? 0.6 : 1 }}>
            {applying === 'domains' ? 'Creating...' : 'Create'}
          </button>
        )}
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#16a34a' }}>{'✓'}</span> {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
