import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import Button from './Button';
import { clickable } from '../lib/a11y';
import { useFocusTrap } from '../hooks/useFocusTrap';

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
  sourceColumns?: string[];
}

// ── Inline styles (self-contained so the modal drops into any page) ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

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
  // The named column set this asset binds to. Empty = the whole table/file.
  const [pickedColumns, setPickedColumns] = useState<string[]>(
    existingBinding?.sourceColumns?.length
      ? existingBinding.sourceColumns
      : existingBinding?.sourceColumn
        ? [existingBinding.sourceColumn]
        : [],
  );
  const [saving, setSaving] = useState(false);

  // Toggle a column in/out of the bound set. Columns belong to a specific
  // table, so picking a column from a different table than the current one
  // switches the picked table and starts a fresh set.
  const toggleColumn = (tableName: string, col: string) => {
    if (pickedAsset !== tableName) {
      setPickedAsset(tableName);
      setPickedColumns([col]);
      return;
    }
    setPickedColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const isChangeMode = !!existingBinding;

  // Accessibility: trap focus in the modal and let Esc close it.
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        // A binding can target the whole table/file, or a named set of its
        // columns. An empty set means "all columns".
        ...(pickedColumns.length ? { sourceColumns: pickedColumns } : {}),
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
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Link to connection"
        style={{ background: '#fff', borderRadius: 12, boxShadow: 'var(--shadow-xl)', padding: 20, maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>
              {isChangeMode ? 'Change connection' : 'Link to connection'} {'\u2014'} {asset.name}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Pick a connection, then select the table/file and (optionally) the set of columns
              this asset corresponds to.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection link dialog" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}><span aria-hidden="true">&times;</span></button>
        </div>

        {/* Step 1: pick connection */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>1. Connection</label>
          <select
            aria-label="Connection"
            style={selectStyle}
            value={selectedConnId}
            onChange={(e) => { setSelectedConnId(e.target.value); setPickedAsset(''); setPickedColumns([]); setExpanded(new Set()); }}
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
              2. Pick a table / file {pickedConn?.connectionType === 'DATABASE' ? '(tick columns to bind a named set)' : ''}
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
                        {...clickable(() => {
                          // Clicking the row picks the whole-asset (all columns)
                          // binding and toggles the column list open.
                          setPickedAsset(a.name);
                          setPickedColumns([]);
                          if (hasCols) toggleExpand(a.name);
                        }, { label: `Select asset ${a.name}` })}
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
                      {isOpen && hasCols && (a.columns || []).map((col) => {
                        const isColChecked = isThisAssetPicked && pickedColumns.includes(col);
                        return (
                          <label
                            key={`${a.name}.${col}`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 12px 6px 28px', borderBottom: '1px solid var(--color-border)',
                              background: isColChecked ? '#eff6ff' : '#fafafa',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isColChecked}
                              onChange={() => toggleColumn(a.name, col)}
                              aria-label={`Include column ${col}`}
                              style={{ cursor: 'pointer' }}
                            />
                            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{col}</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>column</span>
                          </label>
                        );
                      })}
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
            {pickedColumns.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  Column set ({pickedColumns.length}):
                </span>{' '}
                {pickedColumns.map((c) => (
                  <span
                    key={c}
                    style={{
                      display: 'inline-block', margin: '2px 4px 2px 0', padding: '1px 7px',
                      borderRadius: 10, background: '#dbeafe', color: '#1e40af',
                      fontFamily: 'var(--font-mono)', fontSize: 11,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                Binds to the whole table/file (all columns). Tick specific columns above to bind
                this asset to just a named set of them.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? 'Saving\u2026' : isChangeMode ? 'Change link' : 'Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}
