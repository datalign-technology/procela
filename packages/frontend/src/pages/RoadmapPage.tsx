import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import {
  ROADMAP_LAST_RECONCILED, ROADMAP_SNAPSHOT, ROADMAP_TRACKS, ROADMAP_OPEN_WORK,
  ROADMAP_CHECKLIST, type RoadmapState, type Priority,
} from './roadmapData';

// ──────────────────────────────────────────────────────────────────────────
// Status & Roadmap — the interactive dashboard (board A8). Tabs across
// Overview / Open work / Go-live checklist / Reference, driven by the
// structured content in roadmapData.ts (the typed form of docs/STATUS.md).
// The Reference tab still links through to the full rendered STATUS.md so the
// prose single-source-of-truth stays one click away.
// ──────────────────────────────────────────────────────────────────────────

const ROADMAP_DOC_URL = '/api/v1/docs/roadmap.html';

// Status-pill palette. Paired {bg,fg} hexes (a semantic-badge palette), kept
// literal per the design conventions so a retuned token can't drift one half.
const STATE_PILL: Record<RoadmapState, { bg: string; fg: string }> = {
  Shipped:       { bg: '#DCEFE5', fg: '#17604B' },
  Done:          { bg: '#DCEFE5', fg: '#17604B' },
  'In progress': { bg: '#E6EEF9', fg: '#24508F' },
  Partial:       { bg: '#E6EEF9', fg: '#24508F' },
  Designed:      { bg: '#E5ECF3', fg: '#364A5E' },
  'Not started': { bg: '#FBE9D9', fg: '#9A4A0E' },
  Open:          { bg: '#FBE9D9', fg: '#9A4A0E' },
};

function StatePill({ state }: { state: RoadmapState }) {
  const c = STATE_PILL[state] || STATE_PILL.Open;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: c.fg }} />{state}
    </span>
  );
}

const TABS = ['Overview', 'Open work', 'Go-live checklist', 'Reference'] as const;
type Tab = typeof TABS[number];

const PRIORITY_INFO: Record<Priority, string> = {
  P0: 'Required for a credible production v1',
  P1: 'Important, not blocking',
  P2: 'Differentiator or nice to have',
  P3: 'Long-term parity, not pursued now',
};

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 } as const;

export default function RoadmapPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [priority, setPriority] = useState<Priority | 'all'>('all');

  const cap = ROADMAP_SNAPSHOT.capabilities;
  const chk = ROADMAP_SNAPSHOT.checklist;

  const priorityCounts = useMemo(() => {
    const c: Record<string, number> = { all: ROADMAP_OPEN_WORK.length, P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const r of ROADMAP_OPEN_WORK) c[r.priority] = (c[r.priority] || 0) + 1;
    return c;
  }, []);
  const openRows = useMemo(
    () => priority === 'all' ? ROADMAP_OPEN_WORK : ROADMAP_OPEN_WORK.filter((r) => r.priority === priority),
    [priority],
  );

  return (
    <Page width="default">
      <PageHeader
        title="Status & Roadmap"
        subtitle={`Where Procela stands and what's left. Last reconciled ${ROADMAP_LAST_RECONCILED}.`}
        actions={
          <a href={ROADMAP_DOC_URL} target="_blank" rel="noreferrer" style={{ height: 36, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', textDecoration: 'none' }}>
            Full register →
          </a>
        }
      />

      {/* Tab nav */}
      <nav aria-label="Roadmap sections" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)', marginBottom: 20 }}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button key={t} type="button" onClick={() => setTab(t)} aria-current={on ? 'page' : undefined}
              style={{ padding: '10px 14px', fontSize: 14, border: 0, background: 'transparent', cursor: 'pointer', color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: on ? 600 : 500, borderBottom: `2px solid ${on ? 'var(--color-primary)' : 'transparent'}`, marginBottom: -1 }}>
              {t}
            </button>
          );
        })}
      </nav>

      {tab === 'Overview' && (
        <>
          {/* Snapshot */}
          <section aria-label="Snapshot" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div style={{ ...card, gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>Capabilities built</span>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{cap.total} tracked</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 600, fontVariantNumeric: 'tabular-nums', margin: '4px 0 10px' }}>
                {cap.built} <span style={{ fontSize: 15, color: 'var(--color-text-muted)', fontWeight: 500 }}>of {cap.total}</span>
              </div>
              <div role="img" aria-label={`${cap.built} built, ${cap.partial} partial, ${cap.designed} designed, ${cap.notStarted} not started`} style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                <span style={{ flex: cap.built, background: '#17604B' }} />
                <span style={{ flex: cap.partial, background: '#24508F' }} />
                <span style={{ flex: cap.designed, background: '#364A5E' }} />
                <span style={{ flex: cap.notStarted, background: '#9A4A0E' }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 13 }}>
                {[['Built', cap.built, '#17604B'], ['Partial', cap.partial, '#24508F'], ['Designed', cap.designed, '#364A5E'], ['Not started', cap.notStarted, '#9A4A0E']].map(([l, n, c]) => (
                  <span key={l as string} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: c as string }} />{l} {n}</span>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => setTab('Go-live checklist')} style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Go-live checklist</span>
              <span style={{ fontSize: 32, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{chk.done} <span style={{ fontSize: 15, color: 'var(--color-text-muted)', fontWeight: 500 }}>of {chk.total} done</span></span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{chk.partial} partial · {chk.open} open</span>
            </button>
            <button type="button" onClick={() => { setTab('Open work'); setPriority('P0'); }} style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>Open P0 items</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 11, background: '#FBE4E4', color: '#A4262C', fontSize: 12, fontWeight: 600 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: '#A4262C' }} />P0</span>
              </span>
              <span style={{ fontSize: 32, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{ROADMAP_SNAPSHOT.openP0.count}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{ROADMAP_SNAPSHOT.openP0.summary}</span>
            </button>
          </section>

          {/* Tracks + priority key */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 24, alignItems: 'flex-start' }}>
            <main style={{ flex: '999 1 560px', minWidth: 0 }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600 }}>Roadmap tracks</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                {ROADMAP_TRACKS.map((tr) => (
                  <article key={tr.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--color-bg)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{tr.id}</span>
                      <span style={{ fontWeight: 600, flex: 1 }}>{tr.name}</span>
                    </div>
                    <span style={{ alignSelf: 'flex-start' }}><StatePill state={tr.state} /></span>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>{tr.note}</p>
                  </article>
                ))}
              </div>
            </main>
            <aside style={{ ...card, flex: '1 1 300px', minWidth: 0 }}>
              <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>How to read priorities</h2>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: 13 }}>
                {(Object.keys(PRIORITY_INFO) as Priority[]).map((p) => (
                  <div key={p} style={{ display: 'contents' }}>
                    <dt style={{ fontWeight: 700 }}>{p}</dt>
                    <dd style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{PRIORITY_INFO[p]}</dd>
                  </div>
                ))}
              </dl>
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>#N numbers are stable backlog ticket IDs.</p>
            </aside>
          </div>
        </>
      )}

      {tab === 'Open work' && (
        <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontWeight: 600, marginRight: 6 }}>Priority</span>
            {(['all', 'P0', 'P1', 'P2'] as const).map((p) => {
              const on = priority === p;
              return (
                <button key={p} type="button" onClick={() => setPriority(p)} aria-pressed={on}
                  style={{ height: 32, padding: '0 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`, background: on ? 'var(--color-primary-light)' : 'var(--color-surface)', color: on ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: on ? 600 : 500 }}>
                  {p === 'all' ? 'All' : p} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{priorityCounts[p]}</span>
                </button>
              );
            })}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Item</th>
                  <th style={{ padding: 12, fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Priority</th>
                  <th style={{ padding: 12, fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>State</th>
                  <th style={{ padding: '12px 16px 12px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Next step</th>
                </tr>
              </thead>
              <tbody>
                {openRows.map((r) => (
                  <tr key={r.name} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{r.name}<span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>{r.track}</span></td>
                    <td style={{ padding: 12, fontWeight: 600 }}>{r.priority}</td>
                    <td style={{ padding: 12 }}><StatePill state={r.state} /></td>
                    <td style={{ padding: '12px 16px 12px 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'Go-live checklist' && (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            {ROADMAP_CHECKLIST.map((g) => {
              const done = g.items.filter((i) => i.state === 'Done').length;
              return (
                <div key={g.name} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{g.name}</h3>
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{done} of {g.items.length} done</span>
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {g.items.map((i) => (
                      <li key={i.n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--color-text-muted)', width: 22, flex: 'none' }}>{i.n}</span>
                        <span style={{ flex: 1 }}>{i.text}{i.pilot && <span style={{ fontSize: 11, fontWeight: 600, color: '#24508F', background: '#E6EEF9', borderRadius: 8, padding: '1px 6px', marginLeft: 6 }}>Pilot</span>}</span>
                        <StatePill state={i.state} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>“Pilot” marks the minimum set needed to run one pilot customer.</p>
        </>
      )}

      {tab === 'Reference' && (
        <section style={{ ...card }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Full status document</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 680 }}>
            This dashboard is the structured view of <strong>docs/STATUS.md</strong>, the engineering single source of truth, last reconciled {ROADMAP_LAST_RECONCILED}. The full prose — rationale, deployment notes and the complete register — lives in that document.
          </p>
          <a href={ROADMAP_DOC_URL} target="_blank" rel="noreferrer" style={{ height: 40, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Open the full STATUS.md →
          </a>
          <h3 style={{ margin: '20px 0 8px', fontSize: 14, fontWeight: 600 }}>Priority scale</h3>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: 13, maxWidth: 560 }}>
            {(Object.keys(PRIORITY_INFO) as Priority[]).map((p) => (
              <div key={p} style={{ display: 'contents' }}>
                <dt style={{ fontWeight: 700 }}>{p}</dt>
                <dd style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{PRIORITY_INFO[p]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </Page>
  );
}
