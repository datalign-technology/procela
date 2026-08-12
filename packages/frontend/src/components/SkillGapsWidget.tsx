import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import Card from './Card';
import { useOrgContext } from '../stores/orgContext';

export interface SkillGapRow {
  skillId: string;
  skillName: string;
  category: string;
  requiredByActivities: number;
  heldByPeople: number;
  gapScore: number;
}

/**
 * Dashboard widget: top under-staffed skills across this org.
 * Required-by vs held-by per skill, with a "no coverage" red flag
 * when zero people hold a required skill.
 */
export default function SkillGapsWidget() {
  const { activeOrgId } = useOrgContext();
  const [rows, setRows] = useState<SkillGapRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!activeOrgId) { setRows([]); setLoaded(false); return; }
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: SkillGapRow[] }>(`/skills/gap-report?orgId=${activeOrgId}`);
        setRows(res.data || []);
      } catch { setRows([]); }
      finally { setLoaded(true); }
    })();
  }, [activeOrgId]);

  if (!loaded) return null;
  const top = rows.filter((r) => r.requiredByActivities > 0).slice(0, 5);
  if (top.length === 0) return null;

  const maxRequired = Math.max(...top.map((r) => r.requiredByActivities), 1);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Skill Gaps</h2>
        <Link to="/people" style={{ fontSize: 12, color: 'var(--color-primary)' }}>Find people by skill →</Link>
      </div>
      <Card padding="12px 16px">
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Skills most under-staffed across this org — required by activities vs held by people.
        </div>
        {top.map((r) => {
          const reqPct = (r.requiredByActivities / maxRequired) * 100;
          const heldPct = (r.heldByPeople / maxRequired) * 100;
          const critical = r.heldByPeople === 0;
          const tight = r.heldByPeople > 0 && r.gapScore >= 2;
          const color = critical ? 'var(--color-error)' : tight ? 'var(--color-warning)' : 'var(--color-success)';
          return (
            <div key={r.skillId} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{r.skillName}</span>
                <span style={{ fontSize: 11, color }}>
                  {r.requiredByActivities} required · {r.heldByPeople} held
                  {critical ? ' · no coverage' : ''}
                </span>
              </div>
              <div style={{ position: 'relative', height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${reqPct}%`, background: '#e5e7eb' }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${heldPct}%`, background: color, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
