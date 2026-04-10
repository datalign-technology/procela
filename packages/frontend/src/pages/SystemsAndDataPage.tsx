import { useState } from 'react';
import SystemsPage from './SystemsPage';
import DataAssetsPage from './DataAssetsPage';

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
});

export default function SystemsAndDataPage() {
  const [tab, setTab] = useState<'systems' | 'data-assets'>('systems');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        <button style={tabStyle(tab === 'systems')} onClick={() => setTab('systems')}>Systems</button>
        <button style={tabStyle(tab === 'data-assets')} onClick={() => setTab('data-assets')}>Data Assets</button>
      </div>
      {tab === 'systems' && <SystemsPage />}
      {tab === 'data-assets' && <DataAssetsPage />}
    </div>
  );
}
