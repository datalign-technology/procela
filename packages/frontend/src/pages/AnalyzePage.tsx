import { useState } from 'react';
import GapDetectionPage from './GapDetectionPage';
import ScorecardPage from './ScorecardPage';
import RaciMatrixPage from './RaciMatrixPage';
import ExecutiveReportPage from './ExecutiveReportPage';

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

export default function AnalyzePage() {
  const [tab, setTab] = useState<'gaps' | 'scorecard' | 'raci' | 'report'>('gaps');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        <button style={tabStyle(tab === 'gaps')} onClick={() => setTab('gaps')}>Dashboard Gaps</button>
        <button style={tabStyle(tab === 'scorecard')} onClick={() => setTab('scorecard')}>Scorecard</button>
        <button style={tabStyle(tab === 'raci')} onClick={() => setTab('raci')}>RACI Matrix</button>
        <button style={tabStyle(tab === 'report')} onClick={() => setTab('report')}>Executive Report</button>
      </div>
      {tab === 'gaps' && <GapDetectionPage />}
      {tab === 'scorecard' && <ScorecardPage />}
      {tab === 'raci' && <RaciMatrixPage />}
      {tab === 'report' && <ExecutiveReportPage />}
    </div>
  );
}
