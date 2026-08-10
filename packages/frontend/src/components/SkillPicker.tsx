import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';

// ──────────────────────────────────────────────────────────────────────────
// SkillPicker — reusable multi-select skill tagging component.
// Fetches skills from the API, groups them by category, and renders
// checkboxes. Used by PersonDetailPage, AgentsPage, and ProcessCatalogPage.
// ──────────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  orgId: string;
  name: string;
  category: string;
  description: string;
}

const CATEGORY_BADGES: Record<string, { bg: string; color: string }> = {
  DATA_QUALITY:  { bg: '#d1fae5', color: '#065f46' },
  METADATA:      { bg: '#dbeafe', color: '#1e40af' },
  ARCHITECTURE:  { bg: '#ede9fe', color: '#5b21b6' },
  SECURITY:      { bg: '#fce7f3', color: '#9d174d' },
  INTEGRATION:   { bg: '#fef3c7', color: '#92400e' },
  ANALYTICS:     { bg: '#cffafe', color: '#155e75' },
  GOVERNANCE:    { bg: '#e0e7ff', color: '#3730a3' },
  COMMUNICATION: { bg: '#f1f5f9', color: '#64748b' },
};

function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ');
}

interface SkillPickerProps {
  /** The org to fetch skills for. If empty, fetches all. */
  orgId?: string;
  /** Currently selected skill IDs */
  selectedSkillIds: string[];
  /** Called when the selection changes */
  onChange: (skillIds: string[]) => void;
  /** Whether the picker is disabled (read-only) */
  disabled?: boolean;
  /** Max height of the scrollable container */
  maxHeight?: number;
  /** Label to show above the picker */
  label?: string;
  /** Compact mode — uses inline doc-field style instead of card */
  compact?: boolean;
}

export default function SkillPicker({
  orgId,
  selectedSkillIds,
  onChange,
  disabled = false,
  maxHeight = 200,
  label = 'Skills',
  compact = false,
}: SkillPickerProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Skill[] }>(
        orgId ? `/skills?orgId=${orgId}` : '/skills',
      );
      setSkills(res.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Group skills by category
  const grouped = skills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const cat = skill.category || 'OTHER';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  const toggle = (skillId: string) => {
    if (disabled) return;
    const next = selectedSkillIds.includes(skillId)
      ? selectedSkillIds.filter((id) => id !== skillId)
      : [...selectedSkillIds, skillId];
    onChange(next);
  };

  // In compact mode the loaded picker is a two-column "Label: value" row
  // (matching the sibling Systems/Inputs rows). The loading and empty
  // states must use that SAME row layout, else the message renders
  // full-width with no label column and breaks the row rhythm.
  const compactRow = (content: JSX.Element | string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 2 }}>{label}:</span>
      <div style={{ flex: 1, color: 'var(--color-text-muted)', paddingTop: 2 }}>{content}</div>
    </div>
  );

  if (loading) {
    if (compact) return compactRow('Loading skills...');
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0' }}>
        Loading skills...
      </div>
    );
  }

  if (skills.length === 0) {
    const body = (
      <>
        No skills defined. Go to{' '}
        <Link to="/skills" style={{ color: 'var(--color-primary)', textDecoration: 'underline', fontWeight: 500 }}>
          Admin &gt; Skills
        </Link>{' '}
        to create them.
      </>
    );
    if (compact) return compactRow(body);
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0' }}>
        {body}
      </div>
    );
  }

  // Compact mode — inline style matching DocMultiSelect
  if (compact) {
    const selectedSkills = skills.filter((s) => selectedSkillIds.includes(s.id));
    const availableSkills = skills.filter((s) => !selectedSkillIds.includes(s.id));
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11 }}>
        <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 100, flexShrink: 0, paddingTop: 2 }}>{label}:</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', flex: 1 }}>
          {selectedSkills.map((s) => {
            const cb = CATEGORY_BADGES[s.category] || CATEGORY_BADGES.GOVERNANCE;
            return (
              <span key={s.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                background: cb.bg, color: cb.color, border: `1px solid ${cb.color}33`,
              }}>
                {s.name}
                {!disabled && (
                  <button onClick={() => toggle(s.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: cb.color, padding: 0, lineHeight: 1 }}>&times;</button>
                )}
              </span>
            );
          })}
          {!disabled && availableSkills.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) toggle(e.target.value); }}
              style={{
                fontSize: 10, border: '1px solid var(--color-border)', borderRadius: 4,
                background: 'var(--color-surface)', cursor: 'pointer',
                color: 'var(--color-text-muted)', padding: '2px 6px',
              }}
            >
              <option value="">{selectedSkills.length === 0 ? 'Select skills...' : '+ Add...'}</option>
              {Object.entries(grouped).map(([cat, catSkills]) => {
                const available = catSkills.filter((s) => !selectedSkillIds.includes(s.id));
                if (available.length === 0) return null;
                return (
                  <optgroup key={cat} label={formatCategory(cat)}>
                    {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          )}
          {!disabled && availableSkills.length === 0 && selectedSkills.length === 0 && (
            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 10 }}>No skills available</span>
          )}
          {selectedSkills.length === 0 && disabled && (
            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', opacity: 0.6 }}>No skills assigned</span>
          )}
        </div>
      </div>
    );
  }

  // Full mode — card with checkboxes grouped by category
  const categories = Object.keys(grouped).sort();

  return (
    <div>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          {label} ({selectedSkillIds.length} selected)
        </div>
      )}
      <div style={{
        maxHeight,
        overflowY: 'auto',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        padding: 8,
        background: 'var(--color-bg)',
      }}>
        {categories.map((cat) => {
          const cb = CATEGORY_BADGES[cat] || CATEGORY_BADGES.GOVERNANCE;
          return (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div style={{
                display: 'inline-block',
                padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                background: cb.bg, color: cb.color,
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                {formatCategory(cat)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {grouped[cat].map((skill) => (
                  <label
                    key={skill.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, cursor: disabled ? 'default' : 'pointer',
                      padding: '2px 4px', borderRadius: 3,
                      background: selectedSkillIds.includes(skill.id) ? `${cb.bg}88` : 'transparent',
                    }}
                    title={skill.description || skill.name}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.includes(skill.id)}
                      disabled={disabled}
                      onChange={() => toggle(skill.id)}
                    />
                    <span style={{ fontWeight: selectedSkillIds.includes(skill.id) ? 500 : 400 }}>{skill.name}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
