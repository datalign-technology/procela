import { useOrgContext, VALUE_STREAM_LEVELS } from '../stores/orgContext';

// Shown on the Processes / Data Assets / Systems pages when the current
// organization scope can't own new items — i.e. the "(all)" rollup scope or a
// department/team. The old copy led with "X is a company. Pick a company or
// division…", which read as a contradiction to newcomers. This leads with the
// action and offers an inline switcher so the user doesn't have to hunt for the
// org picker at the top. Styled as a neutral info notice (not amber) so it
// doesn't stack two yellow banners with the bulk-select hint.
export default function CreateScopeNotice({ noun }: { noun: string }) {
  const { activeOrgName, orgs, setActiveOrg } = useOrgContext();
  // Only companies and divisions can own items — those are the switch targets.
  const creatable = orgs.filter((o) => VALUE_STREAM_LEVELS.includes(o.type));

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--color-primary-light)',
        border: '1px solid var(--color-primary)',
        borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16,
        fontSize: 13, color: 'var(--color-text)',
      }}
    >
      <span style={{ flex: '1 1 320px' }}>
        <strong>{noun.charAt(0).toUpperCase() + noun.slice(1)} are added at the company or division
        level.</strong>{' '}
        You&rsquo;re viewing <strong>{activeOrgName}</strong>, which combines several organizations —
        switch to a specific one to add or edit here.
      </span>
      {creatable.length > 0 && (
        <select
          aria-label="Switch to a company or division"
          defaultValue=""
          onChange={(e) => {
            const o = creatable.find((c) => c.id === e.target.value);
            if (o) setActiveOrg(o.id, o.name, o.type);
          }}
          style={{
            padding: '6px 10px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-primary)', background: 'var(--color-surface)',
            color: 'var(--color-text)', fontSize: 13, cursor: 'pointer',
          }}
        >
          <option value="" disabled>Switch organization…</option>
          {creatable.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.type === 'division' ? ' (division)' : ''}</option>
          ))}
        </select>
      )}
    </div>
  );
}
