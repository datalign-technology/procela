import { useState } from 'react';
import GovernanceGroupsPage from './GovernanceGroupsPage';
import DataDomainsPage from './DataDomainsPage';
import DamaRolesPage from './DamaRolesPage';

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

export default function GovernancePage() {
  const [tab, setTab] = useState<'groups' | 'domains' | 'roles'>('groups');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        <button style={tabStyle(tab === 'groups')} onClick={() => setTab('groups')}>Groups</button>
        <button style={tabStyle(tab === 'domains')} onClick={() => setTab('domains')}>Domains</button>
        <button style={tabStyle(tab === 'roles')} onClick={() => setTab('roles')}>Roles</button>
      </div>
      {tab === 'groups' && <GovernanceGroupsPage />}
      {tab === 'domains' && <DataDomainsPage />}
      {tab === 'roles' && <DamaRolesPage />}
    </div>
  );
}
