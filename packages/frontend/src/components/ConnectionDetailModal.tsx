import type { CSSProperties } from 'react';
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
import { relativeTime, absoluteTime } from '../lib/relativeTime';
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
  /** asPage only: run a connection test now (wired to the list's test handler). */
  onTest?: () => void;
  /** asPage only: open the Discover-assets flow for this connection. */
  onDiscover?: () => void;
  /** asPage only: a test is currently running. */
  testing?: boolean;
}

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

export default function ConnectionDetailModal({ conn, systems, canWrite, onClose, onEdit, onSaved, asPage = false, onTest, onDiscover, testing = false }: Props) {
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

  const editActionsCore = (
    <DetailEditActions
      editing={m.isEditing}
      canEdit={canWrite}
      dirty={m.dirty}
      saving={m.saving}
      onEdit={m.enter}
      onCancel={m.cancel}
      onSave={m.save}
    />
  );
  // Modal header carries the status badge inline (the modal title has no meta
  // slot); the asPage header shows status as a pill in `meta` instead.
  const editActions = (
    <>
      <span style={badgeStyle(statusBadge)}>{conn.status}</span>
      {editActionsCore}
    </>
  );

  // The in-page editor (name + systems served). Type-specific config and
  // credentials live in the full list editor, reached via the button.
  const editCard = (
    <>
      <SectionLabel style={{ marginBottom: 10 }}>Edit connection</SectionLabel>
      <div style={{ marginBottom: 12 }}>
        <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Connection name" />
      </div>
      <SectionLabel style={{ marginBottom: 6 }}>Systems served</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {servedNames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {shownSystemIds.map((sid) => (
              <span key={sid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                {systemNameMap[sid] || sid}
                <button type="button" aria-label={`Remove ${systemNameMap[sid] || sid}`} onClick={() => m.set('systemIds', m.draft.systemIds.filter((x) => x !== sid))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', fontSize: 14, lineHeight: 1 }}>&times;</button>
              </span>
            ))}
          </div>
        )}
        <select aria-label="Add a system" value="" onChange={(e) => { const sid = e.target.value; if (sid && !m.draft.systemIds.includes(sid)) m.set('systemIds', [...m.draft.systemIds, sid]); }} style={{ fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)', appearance: 'auto', boxSizing: 'border-box' }}>
          <option value="">-- Add a system --</option>
          {systems.filter((s) => !m.draft.systemIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {canWrite && (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" size="sm" onClick={() => onEdit(conn)}>Edit type, config &amp; credentials&hellip;</Button>
        </div>
      )}
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
    const card: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 };
    const sectionH: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
    const statusPillColor = statusBadge.color;
    const factRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--color-border)', fontSize: 14, alignItems: 'center' };
    const isFile = conn.connectionType === 'FILE_STORAGE';
    const noCreds = credentialKeys.length === 0;
    const ghostBtn: CSSProperties = { height: 40, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 8, fontSize: 14, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' };
    // Last-test outcome card — Passed (green) when connected, Failed (red) on
    // error, neutral otherwise.
    const testState = conn.status === 'CONNECTED'
      ? { label: 'Passed', bg: '#F3F9F6', border: '#DCEFE5', fg: '#17604B' }
      : conn.status === 'ERROR'
        ? { label: 'Failed', bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' }
        : { label: conn.status === 'UNTESTED' ? 'Not tested yet' : 'Disconnected', bg: 'var(--color-bg)', border: 'var(--color-border)', fg: 'var(--color-text-secondary)' };

    return (
      <div>
        <PageHeader
          kicker="Connection"
          title={conn.name}
          copyId={conn.id}
          copyLabel="Copy connection ID"
          meta={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, background: statusBadge.bg, color: statusPillColor, fontSize: 13, fontWeight: 600 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: statusPillColor }} />{conn.status.charAt(0) + conn.status.slice(1).toLowerCase()}</span>}
          subtitle={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{TYPE_LABELS[conn.connectionType] || conn.connectionType}{servedNames.length > 0 && <> · serves {servedNames.join(', ')}</>}</span>}
          actions={<>
            {!m.isEditing && canWrite && onTest && (
              <button type="button" disabled={testing} onClick={onTest} style={{ ...ghostBtn, opacity: testing ? 0.6 : 1, cursor: testing ? 'default' : 'pointer' }}>{testing ? 'Testing…' : 'Test now'}</button>
            )}
            {!m.isEditing && canWrite && onDiscover && conn.status === 'CONNECTED' && (
              <button type="button" onClick={onDiscover} style={ghostBtn}>Discover assets</button>
            )}
            {editActionsCore}
          </>}
        />

        {m.isEditing ? (
          <div style={{ ...card, marginTop: 8 }}>{editCard}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 8, alignItems: 'flex-start' }}>
            <main style={{ flex: '999 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Last test */}
              <section style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={sectionH}>Last test</h2>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }} title={conn.lastTestedAt ? absoluteTime(conn.lastTestedAt) : undefined}>{conn.lastTestedAt ? relativeTime(conn.lastTestedAt) : 'Never tested'}</span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 'var(--radius-md)', background: testState.bg, border: `1px solid ${testState.border}` }}>
                  <div>
                    <div style={{ fontWeight: 600, color: testState.fg }}>{testState.label}</div>
                    {conn.lastTestResult
                      ? <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>{conn.lastTestResult}</div>
                      : <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{conn.lastTestedAt ? 'No details recorded.' : 'Run a test to check this connection can be read.'}</div>}
                  </div>
                </div>
              </section>

              {/* Configuration */}
              <section style={card}>
                <h2 style={sectionH}>Configuration</h2>
                <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'minmax(140px, 200px) 1fr', fontSize: 14 }}>
                  {entries.map((e, i) => (
                    <div key={e.label} style={{ display: 'contents' }}>
                      <dt style={{ color: 'var(--color-text-muted)', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>{e.label}</dt>
                      <dd style={{ margin: 0, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)', wordBreak: 'break-word' }}>{e.value}</dd>
                    </div>
                  ))}
                  <div style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--color-text-muted)', padding: '10px 0', borderTop: entries.length === 0 ? 'none' : '1px solid var(--color-border)' }}>Credentials</dt>
                    <dd style={{ margin: 0, padding: '10px 0', borderTop: entries.length === 0 ? 'none' : '1px solid var(--color-border)' }}>
                      {noCreds
                        ? <>None needed <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{isFile ? '(uploaded files don’t use a login)' : '(no login stored)'}</span></>
                        : `${credentialKeys.join(', ')} ${credentialKeys.length === 1 ? 'is' : 'are'} set.`}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Data assets found here */}
              <section style={card}>
                <h2 style={sectionH}>Data assets found here</h2>
                <div style={{ marginTop: 12, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: 'var(--color-bg)' }}>
                  <div style={{ maxWidth: 560 }}>
                    <div style={{ fontWeight: 600 }}>Register what this connection holds</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>Run Discover to list the tables and files this connection can see, then register them as data assets so they can be owned, mapped and quality-checked.</div>
                  </div>
                  {canWrite && onDiscover && (
                    <button type="button" disabled={conn.status !== 'CONNECTED'} title={conn.status !== 'CONNECTED' ? 'Test the connection first' : undefined} onClick={onDiscover} style={{ height: 40, padding: '0 16px', border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-primary)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: conn.status !== 'CONNECTED' ? 'not-allowed' : 'pointer', opacity: conn.status !== 'CONNECTED' ? 0.5 : 1 }}>Discover assets</button>
                  )}
                </div>
              </section>
            </main>

            {/* Facts rail */}
            <aside style={{ flex: '1 1 300px' }}>
              <section style={card}>
                <SectionLabel style={{ marginBottom: 2 }}>Facts</SectionLabel>
                <dl style={{ margin: 0 }}>
                  <div style={{ ...factRow, borderTop: 'none' }}><dt style={{ color: 'var(--color-text-muted)' }}>Status</dt><dd style={{ margin: 0, color: statusPillColor, fontWeight: 600 }}>{conn.status.charAt(0) + conn.status.slice(1).toLowerCase()}</dd></div>
                  <div style={factRow}><dt style={{ color: 'var(--color-text-muted)' }}>Type</dt><dd style={{ margin: 0 }}>{TYPE_LABELS[conn.connectionType] || conn.connectionType}</dd></div>
                  <div style={factRow}>
                    <dt style={{ color: 'var(--color-text-muted)' }}>Systems served</dt>
                    <dd style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {servedNames.length > 0
                        ? servedNames.map((n) => <span key={n} style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 12, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600 }}>{n}</span>)
                        : <span style={{ color: 'var(--color-text-muted)' }}>None</span>}
                      {canWrite && <button type="button" onClick={m.enter} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{servedNames.length > 0 ? 'Add' : 'Assign'}</button>}
                    </dd>
                  </div>
                  <div style={factRow}><dt style={{ color: 'var(--color-text-muted)' }}>Last tested</dt><dd style={{ margin: 0 }} title={conn.lastTestedAt ? absoluteTime(conn.lastTestedAt) : undefined}>{conn.lastTestedAt ? relativeTime(conn.lastTestedAt) : 'Never'}</dd></div>
                  <div style={factRow}><dt style={{ color: 'var(--color-text-muted)' }}>Created</dt><dd style={{ margin: 0 }} title={conn.createdAt ? absoluteTime(conn.createdAt) : undefined}>{conn.createdAt ? relativeTime(conn.createdAt) : '—'}</dd></div>
                  <div style={{ ...factRow }}><dt style={{ color: 'var(--color-text-muted)' }}>Updated</dt><dd style={{ margin: 0 }} title={conn.updatedAt ? absoluteTime(conn.updatedAt) : undefined}>{conn.updatedAt ? relativeTime(conn.updatedAt) : '—'}</dd></div>
                </dl>
              </section>
            </aside>
          </div>
        )}
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
