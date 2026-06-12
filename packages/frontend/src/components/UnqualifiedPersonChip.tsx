interface UnqualifiedPersonChipProps {
  /** Names of the required skills the Responsible person doesn't hold.
   *  Pass an empty list to render nothing. */
  missingSkillNames: string[];
}

/**
 * Amber chip shown next to the Required Skills picker on a process
 * activity when its Responsible person lacks one or more of those
 * skills. Hidden when there are no missing skills, so callers can
 * mount it unconditionally and let the chip decide.
 */
export default function UnqualifiedPersonChip({ missingSkillNames }: UnqualifiedPersonChipProps) {
  if (!missingSkillNames || missingSkillNames.length === 0) return null;
  const n = missingSkillNames.length;
  return (
    <div
      title={`Responsible person is missing: ${missingSkillNames.join(', ')}`}
      role="status"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        marginTop: 6, padding: '4px 10px', borderRadius: 4,
        background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 500,
        border: '1px solid #fde68a',
      }}
    >
      <span aria-hidden="true">⚠</span>
      Responsible person lacks {n} required {n === 1 ? 'skill' : 'skills'}
    </div>
  );
}
