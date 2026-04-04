import React from 'react';

export default function ProcessCatalogPage() {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
        <button
          style={{
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Add Value Stream
        </button>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '2rem', minHeight: '400px' }}>
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '4rem' }}>
          No value streams defined yet. Create one or generate from an industry template.
        </p>
      </div>
    </div>
  );
}
