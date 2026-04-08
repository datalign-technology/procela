import { useState, useEffect, useCallback } from 'react';
import { INDUSTRIES } from '../types';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

interface Organization {
  id: string;
  name: string;
  type: string;
  industry: string;
  description: string;
  parentId: string | null;
}

interface OrgTreeNode {
  id: string; name: string; type: string; children: OrgTreeNode[];
}

function flattenTree(nodes: OrgTreeNode[], depth = 0): Array<{ id: string; name: string; type: string; label: string }> {
  const result: Array<{ id: string; name: string; type: string; label: string }> = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
    const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    result.push({ id: node.id, name: node.name, type: node.type, label: `${indent}${node.name} (${typeLabel})` });
    if (node.children.length > 0) result.push(...flattenTree(node.children, depth + 1));
  }
  return result;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  fontSize: '0.875rem', boxSizing: 'border-box', background: 'var(--color-surface)',
};

export default function SettingsPage() {
  const { activeOrgId } = useOrgContext();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string; type: string; label: string }>>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Organization[]; tree: OrgTreeNode[] }>('/organizations');
      setOrgs(res.data || []);
      setOrgOptions(flattenTree(res.tree || []));

      // Auto-select: active org from header, or first org
      const initialId = activeOrgId || res.data?.[0]?.id || '';
      if (initialId && !selectedOrgId) {
        setSelectedOrgId(initialId);
        const org = res.data?.find((o: Organization) => o.id === initialId);
        if (org) { setName(org.name); setIndustry(org.industry || ''); setDescription(org.description || ''); }
      }
    } catch { setError('Failed to load organizations.'); }

    try {
      const configRes = await apiClient.get<{ aiConfigured: boolean }>('/health/config');
      setAiConfigured(configRes.aiConfigured);
    } catch { /* */ }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleOrgSelect = (id: string) => {
    setSelectedOrgId(id);
    setSuccessMsg(''); setError('');
    const org = orgs.find((o) => o.id === id);
    if (org) { setName(org.name); setIndustry(org.industry || ''); setDescription(org.description || ''); }
  };

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);

  async function handleSave() {
    if (!selectedOrgId || !name.trim()) return;
    setSaving(true); setSuccessMsg(''); setError('');
    try {
      await apiClient.put(`/organizations/${selectedOrgId}`, { name, industry, description });
      setSuccessMsg('Settings saved successfully.');
      fetchData();
    } catch { setError('Failed to save settings.'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!selectedOrgId) return;
    if (!confirm(`Delete "${selectedOrg?.name}"? Children will be re-parented.`)) return;
    try {
      await apiClient.delete(`/organizations/${selectedOrgId}`);
      setSelectedOrgId(''); setName(''); setIndustry(''); setDescription('');
      fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot delete this organization.');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</h1>

      {/* Organization section */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '1.5rem', maxWidth: 600, marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Organization</h2>

        {/* Org selector */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem' }}>
            Select Organization
          </label>
          <select value={selectedOrgId} onChange={(e) => handleOrgSelect(e.target.value)}
            style={{ ...inputStyle, appearance: 'auto' as any }}>
            <option value="">-- Select an organization to manage --</option>
            {orgOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        {selectedOrgId && (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem' }}>
                Organization Name
              </label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" style={inputStyle} />
            </div>

            {selectedOrg?.type === 'company' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem' }}>
                  Industry
                </label>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)} style={{ ...inputStyle, appearance: 'auto' as any }}>
                  <option value="">Select an industry...</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem' }}>
                Description
              </label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" style={inputStyle} />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={handleSave} disabled={saving || !name.trim()}
                style={{
                  padding: '0.5rem 1.25rem', backgroundColor: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', fontWeight: 500,
                  cursor: saving || !name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !name.trim() ? 0.6 : 1,
                }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={handleDelete}
                style={{
                  padding: '0.5rem 1.25rem', backgroundColor: 'transparent', color: 'var(--color-error)',
                  border: '1px solid var(--color-error)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem',
                  fontWeight: 500, cursor: 'pointer',
                }}>
                Delete Organization
              </button>
            </div>

            {successMsg && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#f0fdf4', color: 'var(--color-success)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem' }}>
                {successMsg}
              </div>
            )}
            {error && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', color: 'var(--color-error)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* API Configuration section */}
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
      </div>
    </div>
  );
}
