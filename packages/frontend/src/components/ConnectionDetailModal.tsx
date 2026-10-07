import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import Modal from './Modal';
import PageHeader from './PageHeader';
import { useBreadcrumbLeaf } from './BreadcrumbContext';
import Button from './Button';
import SectionLabel from './SectionLabel';
import EditableField from './EditableField';
import DetailEditActions from './DetailEditActions';
import { apiClient } from '../api/client';
import { successToast, errorToast } from '../lib/errorToast';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import {
  type ConnectionProfile,
  type SystemEntity,
  STATUS_BADGES,
  TYPE_BADGES,
  TYPE_LABELS,
  formatBytes,
  configSummary,
  timeAgo,
} from '../lib/connectionDisplay';

// ──────────────────────────────────────────────────────────────────────────
// ConnectionDetailModal — the read-only detail view for a single Data
// Connection, opened on whole-row click (mirrors SystemDetailModal so the
// Connections list behaves like Systems / Data Assets). Edit lives in the
// header actions and hands back to the page's inline editor; the per-row
// Test / Discover / Duplicate / Delete actions stay on the list row.
//
// No new backend call: the list already holds the full ConnectionProfile, so
// the modal renders from the row object the page passes in.
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  conn: ConnectionProfile;
  systems: SystemEntity[];
  canWrite: boolean;
  onClose: () => void;
  /** Opens the full list editor (per-type config, credentials, test, upload)
   *  — the connection's type-specific config lives there, not in this modal. */
  onEdit: (conn: ConnectionProfile) => void;
  /** Called after an in-modal save so the list refreshes. */
  onSaved?: () => void;
  /** Render as a routed detail page (PageHeader + Back) instead of a modal —
   *  the /connections/:id route, matching the Systems detail page. */
  asPage?: boolean;
}

const backLinkStyle: CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

const badgeStyle = (palette: { bg: string; color: string }): CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 11, fontWeight: 500, background: palette.bg, color: palette.color,
});

// camelCase / snake_case config key → human label ("dbType" → "Db Type").
function prettyKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Config entries worth showing read-only, with empty/secret/noise keys
// dropped. File metadata (size, columns) is formatted; everything else is
// rendered as a plain string so new connection types need no changes here.
function configEntries(conn: ConnectionProfile): Array<{ label: string; value: string }> {
  const skip = new Set(['localFilePath']); // internal server path, not user-facing
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, raw] of Object.entries(conn.config || {})) {
    if (skip.has(key)) continue;
    if (raw === null || raw === undefined || raw === '') continue;
    let value: string;
    if (key === 'fileSize') value = formatBytes(raw as number);
    else if (key === 'columns' && Array.isArray(raw)) value = `${raw.length} columns`;
    else if (Array.isArray(raw)) value = raw.join(', ');
    else if (key === 'lastUploadedAt') value = new Date(raw as string).toLocaleString();
    else value = String(raw);
    out.push({ label: prettyKey(key), value });
  }
  return out;
}

export default function ConnectionDetailModal({ conn, systems, canWrite, onClose, onEdit, onSaved, asPage = false }: Props) {
  const systemNameMap: Record<string, string> = {};
  systems.forEach((s) => { systemNameMap[s.id] = s.name; });

  const m = useDetailEditMode<{ name: string; systemIds: string[] }>(
    { name: conn.name, systemIds: conn.systemIds ?? [] },
    async (draft) => {
      try {
        await apiClient.put(`/connections/${conn.id}`, draft);
        successToast('Connection updated');
        onSaved?.();
      } catch (err) { errorToast(err, 'Failed to update connection'); throw err; }
    },
  );
  const shownSystemIds = m.isEditing ? m.draft.systemIds : (conn.systemIds ?? []);
  const servedNames = shownSystemIds.map((id) => systemNameMap[id]).filter(Boolean);

  const typeBadge = TYPE_BADGES[conn.connectionType] || TYPE_BADGES.DATABASE;
  const statusBadge = STATUS_BADGES[conn.status] || STATUS_BADGES.UNTESTED;
  const entries = configEntries(conn);
  const credentialKeys = Object.entries(conn.credentials || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k]) => prettyKey(k));

  const sectionHead: CSSProperties = { marginTop: 20, marginBottom: 10 };
  const dlRow: CSSProperties = {
    display: 'flex', gap: 10, padding: '6px 0', borderTop: '1px solid var(--color-border)', fontSize: 13,
  };
  const dtStyle: CSSProperties = { color: 'var(--color-text-muted)', minWidth: 140, flexShrink: 0 };

  // On the /connections/:id route the trail ends on the connection's name.
  useBreadcrumbLeaf(asPage ? conn.name : undefined);

  const editActions = (
    <>
      <span style={badgeStyle(statusBadge)}>{conn.status}</span>
      <DetailEditActions
        editing={m.isEditing}
        canEdit={canWrite}
        dirty={m.dirty}
        saving={m.saving}
        onEdit={m.enter}
        onCancel={m.cancel}
        onSave={m.save}
      />
    </>
  );

  const detailBody = (
    <>
      {/* Overview */}
      <SectionLabel style={{ marginBottom: 10 }}>Overview</SectionLabel>
      {m.isEditing && (
        <div style={{ marginBottom: 12 }}>
          <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Connection name" />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <span style={badgeStyle(typeBadge)}>{TYPE_LABELS[conn.connectionType] || conn.connectionType}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {configSummary(conn)}
        </span>
      </div>

      {/* Systems served */}
      <SectionLabel style={sectionHead}>Systems served</SectionLabel>
      {m.isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {servedNames.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {shownSystemIds.map((sid) => (
                <span key={sid} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px 2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                }}>
                  {systemNameMap[sid] || sid}
                  <button
                    type="button"
                    aria-label={`Remove ${systemNameMap[sid] || sid}`}
                    onClick={() => m.set('systemIds', m.draft.systemIds.filter((x) => x !== sid))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', fontSize: 14, lineHeight: 1 }}
                  >&times;</button>
                </span>
              ))}
            </div>
          )}
          <select
            aria-label="Add a system"
            value=""
            onChange={(e) => { const sid = e.target.value; if (sid && !m.draft.systemIds.includes(sid)) m.set('systemIds', [...m.draft.systemIds, sid]); }}
            style={{ fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)', appearance: 'auto', boxSizing: 'border-box' }}
          >
            <option value="">-- Add a system --</option>
            {systems.filter((s) => !m.draft.systemIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : servedNames.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Not assigned to any system yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {servedNames.map((name) => (
            <span key={name} style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              background: 'var(--color-primary-light)', color: 'var(--color-primary)',
            }}>
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Type-specific config lives in the full list editor (per-type fields,
          credentials, connection test, file upload) — not duplicated here. */}
      {m.isEditing && canWrite && (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" size="sm" onClick={() => onEdit(conn)}>
            Edit type, config &amp; credentials&hellip;
          </Button>
        </div>
      )}

      {/* Read-only context — hidden while editing the name / systems. */}
      {!m.isEditing && (<>
      {/* Configuration */}
      {entries.length > 0 && (
        <>
          <SectionLabel style={sectionHead}>Configuration</SectionLabel>
          <div>
            {entries.map((e) => (
              <div key={e.label} style={dlRow}>
                <span style={dtStyle}>{e.label}</span>
                <span style={{ wordBreak: 'break-word' }}>{e.value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Credentials — names only, never values */}
      <SectionLabel style={sectionHead}>Credentials</SectionLabel>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        {credentialKeys.length === 0
          ? <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No credentials stored.</span>
          : `${credentialKeys.join(', ')} ${credentialKeys.length === 1 ? 'is' : 'are'} set.`}
      </div>

      {/* Connection test */}
      <SectionLabel style={sectionHead}>Connection test</SectionLabel>
      <div>
        <div style={dlRow}>
          <span style={dtStyle}>Last tested</span>
          <span title={conn.lastTestedAt ? new Date(conn.lastTestedAt).toLocaleString() : undefined}>
            {conn.lastTestedAt ? timeAgo(conn.lastTestedAt) : 'Never tested'}
          </span>
        </div>
        {conn.lastTestResult && (
          <div style={dlRow}>
            <span style={dtStyle}>Last result</span>
            <span style={{ wordBreak: 'break-word' }}>{conn.lastTestResult}</span>
          </div>
        )}
      </div>

      {/* Metadata */}
      <SectionLabel style={sectionHead}>Record</SectionLabel>
      <div>
        <div style={dlRow}>
          <span style={dtStyle}>Created</span>
          <span>{conn.createdAt ? new Date(conn.createdAt).toLocaleString() : '--'}</span>
        </div>
        <div style={dlRow}>
          <span style={dtStyle}>Updated</span>
          <span>{conn.updatedAt ? new Date(conn.updatedAt).toLocaleString() : '--'}</span>
        </div>
      </div>
      </>)}
    </>
  );

  if (asPage) {
    return (
      <div>
        <PageHeader
          kicker="CONNECTION"
          title={conn.name}
          copyId={conn.id}
          copyLabel="Copy connection ID"
          subtitle={TYPE_LABELS[conn.connectionType] || conn.connectionType}
          actions={<>
            <Link to="/systems?tab=connections" style={backLinkStyle}>{'←'} Back to Connections</Link>
            {editActions}
          </>}
        />
        {detailBody}
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      kicker="CONNECTION"
      title={conn.name}
      subtitle={TYPE_LABELS[conn.connectionType] || conn.connectionType}
      ariaLabel={`Connection: ${conn.name}`}
      actions={editActions}
    >
      {detailBody}
    </Modal>
  );
}
