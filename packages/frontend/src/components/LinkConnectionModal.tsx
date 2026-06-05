import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

// ──────────────────────────────────────────────────────────────────────────
// LinkConnectionModal — three-step flow for pointing a Data Asset at a
// specific location on a Connection.
//
//   1. Pick a connection (dropdown filtered by activeOrg).
//   2. Discover what's inside (columns/tables).
//   3. Pick the concrete table/column → POST /data-assets/:id/bindings.
//
// Unlink happens via the Data Assets row and does not go through this
// modal — but changing an existing binding opens this modal in "change"
// mode, which deletes the current binding after the new one is created.
// ──────────────────────────────────────────────────────────────────────────

interface ConnectionProfile {
  id: string;
  name: string;
  connectionType: string;
  systemId: string;
  config: Record<string, any>;
}

interface DiscoveredAsset {
  name: string;
  type: string;
  rowCount?: number;
  columns?: string[];
}

export interface LinkableAsset {
  id: string;
  name: string;
  sourceAsset?: string;    // not used by the link flow — here so callers can pass a full asset
  sourceColumn?: string;
}

export interface ExistingBindingSummary {
  id: string;
  connectionId: string;
  sourceAsset: string;
  sourceColumn?: string;
}

// ── Inline styles (self-contained so the modal drops into any page) ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

export default function LinkConnectionModal({
  asset, activeOrgId, existingBinding, onClose, onLinked,
}: {
  asset: LinkableAsset;
  activeOrgId: string | null;
  existingBinding?: ExistingBindingSummary;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>(existingBinding?.connectionId || '');
  const [discovered, setDiscovered] = useState<DiscoveredAsset[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pickedAsset, setPickedAsset] = useState<string>(existingBinding?.sourceAsset || '');
  const [, setPickedColumn] = useState<string>(existingBinding?.sourceColumn || '');
  const [saving, setSaving] = useState(false);

  const isChangeMode = !!existingBinding;

  // ── Step 1: load connections for the org ──
  useEffect(() => {
    (async () => {
      try {
        const q = activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : '';
        const res = await apiClient.get<{ success: boolean; data: ConnectionProfile[] }>(`/connections${q}`);
        setConnections(res.data || []);
      } catch { /* */ }
    })();
  }, [activeOrgId]);

  // ── Step 2: kick off discovery whenever a connection is selected ──
  useEffect(() => {
    if (!selectedConnId) { setDiscovered(null); setDiscoverError(null); return; }
    let cancelled = false;
    (async () => {
      setDiscovering(true);
      setDiscoverError(null);
      setDiscovered(null);
      try {
        const res = await apiClient.post<{ success: boolean; data: { success: boolean; message: string; details?: { assets?: DiscoveredAsset[] } } }>(
          `/connections/${selectedConnId}/discover`,
        );
        if (cancelled) return;
        if (res.data?.success) {
          setDiscovered(res.data.details?.assets || []);
        } else {
          setDiscoverError(res.data?.message || 'Discovery failed');
        }
      } catch (err) {
        if (!cancelled) setDiscoverError(err instanceof Error ? err.message : 'Discovery failed');
      } finally {
        if (!cancelled) setDiscovering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedConnId]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedConnId || !pickedAsset) return;
    setSaving(true);
    try {
      // If we're switching from an existing binding, delete it first so the
      // asset ends up with exactly one binding post-swap.
      if (isChangeMode && existingBinding) {
        try {
          await apiClient.delete(`/data-assets/${asset.id}/bindings/${existingBinding.id}`);
        } catch { /* fall through — create attempt may still succeed */ }
      }
      await apiClient.post(`/data-assets/${asset.id}/bindings`, {
        connectionId: selectedConnId,
        sourceAsset: pickedAsset,
        // Bindings are table/file level. Columns are managed as child
        // entities via auto-discover on the Data Assets page.
        isPrimary: true,
      });
      onLinked();
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const pickedConn = connections.find((c) => c.id === selectedConnId);
  const canSave = !!selectedConnId && !!pickedAsset && !saving;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', padding: 20, maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>
              {isChangeMode ? 'Change connection' : 'Link to connection'} {'\u2014'} {asset.name}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Pick a connection, then select the table/file and (optionally) the column this
              asset corresponds to.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection link dialog" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}><span aria-hidden="true">&times;</span></button>
        </div>

        {/* Step 1: pick connection */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>1. Connection</label>
          <select
            style={selectStyle}
            value={selectedConnId}
            onChange={(e) => { setSelectedConnId(e.target.value); setPickedAsset(''); setPickedColumn(''); setExpanded(new Set()); }}
          >
            <option value="">-- Select a connection --</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.connectionType})</option>
            ))}
          </select>
          {connections.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              No connections yet. Create one on the Connections page first.
            </p>
          )}
        </div>

        {/* Step 2: discovery results */}
        {selectedConnId && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
              2. Pick a table / file {pickedConn?.connectionType === 'DATABASE' ? '(and optionally a column)' : ''}
            </label>
            {discovering && (
              <div style={{ padding: 12, border: '1px dashed var(--color-border)', borderRadius: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                {'Discovering\u2026'}
              </div>
            )}
            {discoverError && (
              <div style={{ padding: 12, border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 4, fontSize: 12, color: '#991b1b' }}>
                {discoverError}
              </div>
            )}
            {!discovering && !discoverError && discovered && discovered.length === 0 && (
              <div style={{ padding: 12, border: '1px dashed var(--color-border)', borderRadius: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                No assets discovered on this connection.
              </div>
            )}
            {!discovering && discovered && discovered.length > 0 && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 280, overflow: 'auto' }}>
                {discovered.map((a) => {
                  const isOpen = expanded.has(a.name);
                  const hasCols = !!(a.columns && a.columns.length > 0);
                  const isThisAssetPicked = pickedAsset === a.name;
                  return (
                    <div key={a.name}>
                      <div
                        onClick={() => {
                          // Clicking the row picks the whole-asset binding and toggles cols.
                          setPickedAsset(a.name);
                          setPickedColumn('');
                          if (hasCols) toggleExpand(a.name);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
                          cursor: 'pointer',
                          background: isThisAssetPicked ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 10 }}>
                          {hasCols ? (isOpen ? '\u25BC' : '\u25B6') : '\u2022'}
                        </span>
                        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>{a.name}</span>
                        <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 3 }}>{a.type}</span>
                        {a.rowCount != null && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{a.rowCount.toLocaleString()} rows</span>}
                      </div>
                      {isOpen && hasCols && (a.columns || []).map((col) => (
                          <div
                            key={`${a.name}.${col}`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 12px 6px 34px', borderBottom: '1px solid var(--color-border)',
                              background: '#fafafa',
                            }}
                          >
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{'\u21B3'}</span>
                            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{col}</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>column</span>
                          </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Preview of what will be linked */}
        {pickedAsset && (
          <div style={{ marginBottom: 12, padding: 10, background: 'var(--color-bg)', borderRadius: 4, fontSize: 12 }}>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Will link to:</span>{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {pickedConn?.name} / {pickedAsset}
              </code>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              After linking, use "Auto-discover columns" on the Data Assets page to populate the individual columns for this table/file.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            style={{ ...btnPrimary, opacity: canSave ? 1 : 0.6 }}
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? 'Saving\u2026' : isChangeMode ? 'Change link' : 'Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
