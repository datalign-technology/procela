import type { CSSProperties } from 'react';
import Modal from './Modal';
import Button from './Button';
import SectionLabel from './SectionLabel';
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
  onEdit: (conn: ConnectionProfile) => void;
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

export default function ConnectionDetailModal({ conn, systems, canWrite, onClose, onEdit }: Props) {
  const systemNameMap: Record<string, string> = {};
  systems.forEach((s) => { systemNameMap[s.id] = s.name; });
  const servedNames = (conn.systemIds ?? []).map((id) => systemNameMap[id]).filter(Boolean);

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

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      kicker="CONNECTION"
      title={conn.name}
      subtitle={TYPE_LABELS[conn.connectionType] || conn.connectionType}
      ariaLabel={`Connection: ${conn.name}`}
      actions={
        <>
          <span style={badgeStyle(statusBadge)}>{conn.status}</span>
          {canWrite && (
            <Button variant="secondary" size="sm" onClick={() => onEdit(conn)}>Edit</Button>
          )}
        </>
      }
    >
      {/* Overview */}
      <SectionLabel style={{ marginBottom: 10 }}>Overview</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <span style={badgeStyle(typeBadge)}>{TYPE_LABELS[conn.connectionType] || conn.connectionType}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {configSummary(conn)}
        </span>
      </div>

      {/* Systems served */}
      <SectionLabel style={sectionHead}>Systems served</SectionLabel>
      {servedNames.length === 0 ? (
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
    </Modal>
  );
}
