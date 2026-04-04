const cards = [
  { title: 'Process Coverage', value: '--', description: 'Value streams documented' },
  { title: 'Data Health', value: '--', description: 'Average health score' },
  { title: 'Governance Overview', value: '--', description: 'Assets by governance tier' },
  { title: 'Recent Activity', value: '--', description: 'Changes in the last 7 days' },
];

export default function DashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {cards.map((card) => (
          <div
            key={card.title}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              {card.title}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{card.value}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {card.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
