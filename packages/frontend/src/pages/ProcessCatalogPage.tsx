import { useNavigate } from 'react-router-dom';

export default function ProcessCatalogPage() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/processes/wizard')}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Generate from Template
          </button>
          <button
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Add Value Stream
          </button>
        </div>
      </div>
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '2rem', minHeight: '400px' }}>
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '4rem' }}>
          No value streams defined yet. Create one or generate from an industry template.
        </p>
      </div>
    </div>
  );
}
