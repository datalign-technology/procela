// SearchInput — the shared free-text filter box used across the Data Assets
// hub tabs (Registry / Quality / Rules) so they look and behave identically.
// A plain controlled text input styled from tokens, with a clear (×) button
// that appears once there's a value. Filtering stays the caller's job — this
// only owns the input affordance.
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
  width = 200,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  width?: number | string;
}) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width }}>
      <input
        type="text"
        aria-label={ariaLabel || placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: '1px solid var(--color-border)', borderRadius: 4,
          padding: '5px 26px 5px 10px', fontSize: 12,
          background: 'var(--color-surface)', color: 'var(--color-text)',
          width: '100%',
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', fontSize: 15, lineHeight: 1, padding: '0 4px',
          }}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
