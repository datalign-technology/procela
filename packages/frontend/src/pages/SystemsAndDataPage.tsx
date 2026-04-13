import { useSearchParams } from 'react-router-dom';
import SystemsPage from './SystemsPage';
import DataAssetsPage from './DataAssetsPage';
import ConnectionsPage from './ConnectionsPage';

type Tab = 'systems' | 'data-assets' | 'connections';

const VALID_TABS: Tab[] = ['systems', 'data-assets', 'connections'];

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
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const tab: Tab = VALID_TABS.includes(raw as Tab) ? (raw as Tab) : 'systems';

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    // Drop system-scoped params when leaving the Connections tab so they
    // don't leak into Systems/Data Assets filtering.
    if (next !== 'connections') {
      params.delete('systemId');
      params.delete('open');
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        <button style={tabStyle(tab === 'systems')} onClick={() => setTab('systems')}>Systems</button>
        <button style={tabStyle(tab === 'data-assets')} onClick={() => setTab('data-assets')}>Data Assets</button>
        <button style={tabStyle(tab === 'connections')} onClick={() => setTab('connections')}>Connections</button>
      </div>
      {tab === 'systems' && <SystemsPage />}
      {tab === 'data-assets' && <DataAssetsPage />}
      {tab === 'connections' && <ConnectionsPage />}
    </div>
  );
}
