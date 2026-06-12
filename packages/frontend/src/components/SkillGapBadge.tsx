export interface PersonSkillGap {
  unqualifiedCount: number;
  /** Up to 3 sample activity names, used to populate the hover tooltip. */
  sample: string[];
}

interface SkillGapBadgeProps {
  gap?: PersonSkillGap | null;
}

/**
 * Per-person skill-gap badge used in the People table "Skill gaps"
 * column. Renders an em-dash placeholder when the person is fully
 * qualified (zero unqualified activities) so column rows stay
 * visually aligned, and an amber chip with activity count + tooltip
 * sample otherwise.
 */
export default function SkillGapBadge({ gap }: SkillGapBadgeProps) {
  if (!gap || gap.unqualifiedCount === 0) {
    return <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>—</span>;
  }
  const more = gap.unqualifiedCount > gap.sample.length
    ? ` (+${gap.unqualifiedCount - gap.sample.length} more)` : '';
  return (
    <span
      title={`Activities lacking required skills:\n  ${gap.sample.join('\n  ')}${more}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 600,
        padding: '2px 8px', borderRadius: 4,
        background: '#fef3c7', color: '#92400e',
        border: '1px solid #fde68a',
      }}
    >
      <span aria-hidden="true">⚠</span>
      {gap.unqualifiedCount} {gap.unqualifiedCount === 1 ? 'activity' : 'activities'}
    </span>
  );
}
