import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// ──────────────────────────────────────────────────────────────────────────
// SavedViewsMenu - the "Saved views" dropdown that lives in the action
// bar of every list page. Loads / saves / renames / deletes views.
//
// Each list page passes:
//
//   pageKey         A stable identifier for the page ("data-assets" etc).
//                   Used as the bucketing key on the backend.
//
//   currentFilters  The page's current filter state, as a plain object.
//                   The page owns the shape; the menu round-trips it.
//
//   onApply         Callback invoked when the user picks a view from the
//                   list. The page is responsible for splatting the
//                   filters back onto its own state.
//
// Visibility: all views in an org are visible to everyone in v1. Only
// the owner can rename or delete. The isShared flag is on the data
// model already so we can opt into private views without a migration.
// ──────────────────────────────────────────────────────────────────────────

export interface SavedView {
  id: string;
  orgId: string;
  pageKey: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  isShared: boolean;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  pageKey: string;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
  /** Optional: caller can mark a view as "active" if its filters match
   *  the current state. We don't auto-detect because filter objects can
   *  have noisy keys; the page knows best. */
  activeViewId?: string | null;
}

export default function SavedViewsMenu({ pageKey, currentFilters, onApply, activeViewId }: Props) {
  const { activeOrgId } = useOrgContext();
  const currentUser = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [saveMode, setSaveMode] = useState(false);
  const [draftName, setDraftName] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    if (!activeOrgId) { setViews([]); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: SavedView[] }>(
        `/saved-views?orgId=${activeOrgId}&pageKey=${encodeURIComponent(pageKey)}`,
      );
      setViews(res.data || []);
    } catch { /* */ }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeOrgId, pageKey]);

  // Close on outside click / Escape so the popover never traps focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) { setOpen(false); setSaveMode(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSaveMode(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const saveCurrent = async () => {
    if (!draftName.trim()) return;
    try {
      await apiClient.post('/saved-views', {
        orgId: activeOrgId,
        pageKey,
        name: draftName.trim(),
        filters: currentFilters,
        ownerName: currentUser?.name,
      });
      setDraftName('');
      setSaveMode(false);
      setOpen(false);
      addToast('success', `Saved view "${draftName.trim()}"`);
      await refresh();
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to save view');
    }
  };

  const apply = (v: SavedView) => {
    onApply(v.filters);
    setOpen(false);
    addToast('info', `Applied view: ${v.name}`);
  };

  const remove = async (v: SavedView) => {
    try {
      await apiClient.delete(`/saved-views/${v.id}`);
      await refresh();
      addToast('success', `Deleted view "${v.name}"`);
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to delete view');
    }
  };

  const canModify = (v: SavedView): boolean => {
    if (!v.ownerId) return true;                  // dev-mode anonymous views
    return !!currentUser && currentUser.id === v.ownerId;
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Saved views"
        style={{
          padding: '5px 10px', fontSize: 12, fontWeight: 500,
          background: 'var(--color-bg)', color: 'var(--color-text)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{'☰'}</span>
        <span>Views</span>
        {views.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>({views.length})</span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            minWidth: 240, maxWidth: 320,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 6, zIndex: 100,
          }}
        >
          {views.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              No saved views yet.
            </div>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {views.map((v) => {
                const isActive = activeViewId === v.id;
                return (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                      background: isActive ? 'var(--color-bg)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <button
                      onClick={() => apply(v)}
                      title="Apply this view"
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left',
                        background: 'none', border: 'none', padding: 0,
                        cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: 'var(--color-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontWeight: isActive ? 600 : 400 }}>{v.name}</span>
                      {v.ownerName && (
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                          · {v.ownerName}
                        </span>
                      )}
                    </button>
                    {canModify(v) && (
                      <button
                        onClick={() => remove(v)}
                        title="Delete view"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--color-text-muted)', fontSize: 14, padding: '0 4px',
                        }}
                        aria-label={`Delete view ${v.name}`}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ borderTop: views.length > 0 ? '1px solid var(--color-border)' : 'none', marginTop: views.length > 0 ? 6 : 0, paddingTop: views.length > 0 ? 6 : 0 }}>
            {saveMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 4px' }}>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveCurrent();
                    if (e.key === 'Escape') { setSaveMode(false); setDraftName(''); }
                  }}
                  placeholder="Name this view"
                  style={{
                    fontSize: 12, padding: '4px 8px',
                    border: '1px solid var(--color-border)', borderRadius: 4,
                    background: 'var(--color-bg)',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setSaveMode(false); setDraftName(''); }}
                    style={textBtn}
                  >Cancel</button>
                  <button
                    onClick={saveCurrent}
                    disabled={!draftName.trim()}
                    style={{
                      padding: '3px 8px', fontSize: 11, fontWeight: 500,
                      background: 'var(--color-primary)', color: '#fff',
                      border: 'none', borderRadius: 4,
                      cursor: !draftName.trim() ? 'default' : 'pointer',
                      opacity: !draftName.trim() ? 0.5 : 1,
                    }}
                  >Save</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setSaveMode(true); setDraftName(''); }}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '6px 8px', borderRadius: 4,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--color-primary)', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                + Save current filters as view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const textBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: '3px 6px',
  fontSize: 11, color: 'var(--color-text-muted)', cursor: 'pointer',
  fontFamily: 'inherit',
};
