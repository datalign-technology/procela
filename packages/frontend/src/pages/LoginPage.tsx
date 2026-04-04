export default function LoginPage() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', padding: '3rem', background: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', maxWidth: '400px', width: '100%' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#1a1f36' }}>Clarity360</h1>
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>Sign in with your enterprise credentials</p>
        <button
          style={{
            width: '100%',
            padding: '0.75rem 1.5rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Sign in with SSO
        </button>
      </div>
    </div>
  );
}
