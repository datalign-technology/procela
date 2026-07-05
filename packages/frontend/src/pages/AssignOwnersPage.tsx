import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useOrgContext } from '@/stores/orgContext';
import { useToastStore } from '@/stores/toastStore';
import PersonPicker from '@/components/PersonPicker';
import EmptyState from '@/components/EmptyState';
import Page from '@/components/Page';
import PageHeader from '@/components/PageHeader';
import { CheckCircle2 } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// AssignOwnersPage — the bulk ownership-assignment review behind Phase ②
// of the Setup Hub. It gathers every entity that currently has NO owner —
// value streams & processes, systems, data domains, and data assets — into
// one screen so a steward can clear the accountability gaps in a single
// pass, instead of bouncing between five CRUD pages.
//
// Each row carries a PersonPicker that assigns immediately on selection; a
// section-level picker assigns one person to every remaining row at once.
// Assigned rows drop out of the list, so the page empties as the gaps close.
// ──────────────────────────────────────────────────────────────────────────

interface OwnerlessItem {
  id: string;
  name: string;
  sub?: string;
}

interface Section {
  key: string;
  title: string;
  hint: string;
  items: OwnerlessItem[];
  assign: (id: string, personId: string) => Promise<void>;
}

const LEVEL_LABEL: Record<string, string> = {
  VALUE_STREAM: 'Value Stream',
  PROCESS: 'Process',
  SUBPROCESS: 'Sub-Process',
  ACTIVITY: 'Step',
};

export default function AssignOwnersPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { addToast } = useToastStore();

  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkPick, setBulkPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const orgQ = activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : '';

  const load = useCallback(async () => {
    if (!activeOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [procRes, sysRes, domRes, assetRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; level: string; ownerId: string | null }> }>(`/process-catalog${orgQ}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; ownerPersonId?: string | null }> }>(`/systems${orgQ}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; ownerId: string | null }> }>(`/data-domains${orgQ}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; ownerPersonId?: string | null }> }>(`/data-assets${orgQ}`),
      ]);

      const procItems: OwnerlessItem[] = (procRes.data || [])
        .filter((n) => !n.ownerId && (n.level === 'VALUE_STREAM' || n.level === 'PROCESS'))
        .map((n) => ({ id: n.id, name: n.name, sub: LEVEL_LABEL[n.level] || n.level }));
      const sysItems: OwnerlessItem[] = (sysRes.data || [])
        .filter((s) => !s.ownerPersonId)
        .map((s) => ({ id: s.id, name: s.name }));
      const domItems: OwnerlessItem[] = (domRes.data || [])
        .filter((d) => !d.ownerId)
        .map((d) => ({ id: d.id, name: d.name }));
      const assetItems: OwnerlessItem[] = (assetRes.data || [])
        .filter((a) => !a.ownerPersonId)
        .map((a) => ({ id: a.id, name: a.name }));

      setSections([
        {
          key: 'processes',
          title: 'Processes',
          hint: 'Value streams and processes with no accountable owner.',
          items: procItems,
          assign: (id, personId) => apiClient.put(`/process-catalog/nodes/${id}`, { ownerId: personId }).then(() => undefined),
        },
        {
          key: 'systems',
          title: 'Systems',
          hint: 'Systems with no business owner.',
          items: sysItems,
          assign: (id, personId) => apiClient.put(`/systems/${id}`, { ownerPersonId: personId }).then(() => undefined),
        },
        {
          key: 'domains',
          title: 'Data domains',
          hint: 'Domains with no data owner.',
          items: domItems,
          assign: (id, personId) => apiClient.put(`/data-domains/${id}`, { ownerId: personId }).then(() => undefined),
        },
        {
          key: 'assets',
          title: 'Data assets',
          hint: 'Data assets with no owner.',
          items: assetItems,
          assign: (id, personId) => apiClient.put(`/data-assets/${id}`, { ownerPersonId: personId }).then(() => undefined),
        },
      ]);
    } catch {
      addToast('error', 'Failed to load items needing an owner.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, orgQ, addToast]);

  useEffect(() => { load(); }, [load]);

  const removeItem = (sectionKey: string, id: string) =>
    setSections((prev) => prev.map((s) => s.key === sectionKey ? { ...s, items: s.items.filter((i) => i.id !== id) } : s));

  const assignOne = async (section: Section, item: OwnerlessItem, personId: string) => {
    if (!personId) return;
    const busyKey = `${section.key}:${item.id}`;
    setBusy((b) => new Set(b).add(busyKey));
    try {
      await section.assign(item.id, personId);
      removeItem(section.key, item.id);
      addToast('success', `Owner assigned to ${item.name}.`);
    } catch (err: any) {
      addToast('error', err?.message || `Couldn't assign an owner to ${item.name}.`);
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(busyKey); return n; });
    }
  };

  const assignAll = async (section: Section) => {
    const personId = bulkPick[section.key];
    if (!personId) { addToast('info', 'Pick a person to assign to all rows first.'); return; }
    const targets = [...section.items];
    let ok = 0;
    let failed = 0;
    for (const item of targets) {
      try {
        await section.assign(item.id, personId);
        removeItem(section.key, item.id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkPick((p) => ({ ...p, [section.key]: '' }));
    if (ok > 0) addToast('success', `Assigned owner to ${ok} ${section.title.toLowerCase()}${failed ? ` (${failed} could not be updated)` : ''}.`);
    else if (failed > 0) addToast('error', `Could not update ${failed} ${section.title.toLowerCase()}.`);
  };

  const totalRemaining = sections.reduce((sum, s) => sum + s.items.length, 0);

  if (!activeOrgId) {
    return (
      <Page width="narrow">
        <div style={{ marginTop: 48, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <p>Select an organization from the header to review ownership.</p>
        </div>
      </Page>
    );
  }

  return (
    <Page width="wizard" padding="8px 0 64px">
      {/* Was hand-rolled &lt;h1 fontSize:20&gt; + &lt;p&gt; subtitle + a
          separate back link — one full point smaller than every
          other page's header. Now uses the shared PageHeader for
          consistent sizing; back-to-Setup lives in the actions
          slot as a link-styled button. */}
      <PageHeader
        title="Assign owners"
        subtitle={`Everything in ${activeOrgName} that currently has no owner, in one place. Assign a person to each — or use a section's picker to assign one person to every remaining item at once.`}
        actions={(
          <button onClick={() => navigate('/setup')}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, padding: 0 }}>
            ← Back to Get Started
          </button>
        )}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : totalRemaining === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={36} strokeWidth={1.8} color="var(--color-success, #16a34a)" />}
          title="Everything has an owner"
          description="No unassigned processes, systems, domains, or data assets."
          action={{ label: 'Back to Get Started', onClick: () => navigate('/setup') }}
        />
      ) : (
        sections.map((section) => (
          <section key={section.key} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>{section.title}</h2>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {section.items.length === 0 ? 'all assigned' : `${section.items.length} need an owner`}
              </span>
            </div>

            {section.items.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '8px 0' }}>{section.title} are all assigned.</div>
            ) : (
              <>
                {/* Bulk assign to all remaining in this section */}
                <div style={{
                  display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 14px', marginBottom: 8,
                  background: 'var(--color-bg)', border: '1px dashed var(--color-border)', borderRadius: 8,
                }}>
                  <div style={{ width: 280 }}>
                    <PersonPicker
                      label={`Assign one person to all ${section.items.length}`}
                      orgId={activeOrgId}
                      value={bulkPick[section.key] || null}
                      onChange={(v) => setBulkPick((p) => ({ ...p, [section.key]: v || '' }))}
                    />
                  </div>
                  <button onClick={() => assignAll(section)} disabled={!bulkPick[section.key]}
                    style={{ ...primaryBtn, opacity: bulkPick[section.key] ? 1 : 0.5, cursor: bulkPick[section.key] ? 'pointer' : 'not-allowed' }}>
                    Apply to all
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {section.items.map((item) => {
                    const busyKey = `${section.key}:${item.id}`;
                    return (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8,
                        opacity: busy.has(busyKey) ? 0.6 : 1,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</span>
                          {item.sub && (
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>{item.sub}</span>
                          )}
                        </div>
                        <div style={{ width: 260, flexShrink: 0 }}>
                          <PersonPicker
                            orgId={activeOrgId}
                            placeholder="Assign owner…"
                            value={null}
                            disabled={busy.has(busyKey)}
                            onChange={(v) => v && assignOne(section, item, v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        ))
      )}
    </Page>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
