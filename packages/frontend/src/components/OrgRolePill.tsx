import { useState } from 'react';
import { usePermissions } from '@/hooks/usePermissions';

// ──────────────────────────────────────────────────────────────────────────
// OrgRolePill — small inline editor for the per-org role override on
// the Person detail page. Each chip carries either:
//   - the default role from person.role (rendered with a trailing " *"
//     to mark it as inherited), or
//   - the per-org override from person.orgRoles[orgId] (solid pill).
//
// Click to open a select. Choosing "Use default (…)" passes null to
// onChange so the caller clears the orgRoles entry; choosing a
// concrete role passes the role string.
//
// Non-admin viewers see a static pill with no edit affordance — the
// usePermissions hook is the source of truth for the gate.
// ──────────────────────────────────────────────────────────────────────────

export const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ORG_ADMIN', label: 'Org Admin' },
  { value: 'PROCESS_OWNER', label: 'Process Owner' },
  { value: 'DATA_STEWARD', label: 'Data Steward' },
  { value: 'CONTRIBUTOR', label: 'Contributor' },
  { value: 'VIEWER', label: 'Viewer' },
];

interface OrgRolePillProps {
  role: string;
  isOverride: boolean;
  disabled?: boolean;
  onChange: (role: string | null) => void;
}

export default function OrgRolePill({ role, isOverride, disabled, onChange }: OrgRolePillProps) {
  const { isAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const label = ROLE_OPTIONS.find((r) => r.value === role)?.label || role;

  if (!isAdmin) {
    return (
      <span
        data-testid="org-role-pill-readonly"
        style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
          background: '#fff', color: 'var(--color-primary)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}
      >{label}</span>
    );
  }

  if (open) {
    return (
      <select
        autoFocus
        value={isOverride ? role : ''}
        disabled={disabled}
        aria-label={`Set per-org role (currently ${label})`}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v ? v : null);
          setOpen(false);
        }}
        onBlur={() => setOpen(false)}
        style={{
          fontSize: 11, padding: '2px 4px',
          border: '1px solid var(--color-border)', borderRadius: 4,
          background: '#fff', color: 'var(--color-text)',
        }}
      >
        <option value="">Use default ({role})</option>
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      aria-label={isOverride ? `Change per-org role override (${label})` : `Set per-org role override (currently default: ${label})`}
      title={isOverride ? 'Per-org override — click to change' : 'Default role — click to set a per-org override'}
      style={{
        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
        background: isOverride ? 'var(--color-primary)' : '#fff',
        color: isOverride ? '#fff' : 'var(--color-primary)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        border: '1px solid var(--color-primary)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}{isOverride ? '' : ' *'}
    </button>
  );
}
