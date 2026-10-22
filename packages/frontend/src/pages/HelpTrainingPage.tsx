import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import { TRAINING_MODULES, TRAINING_META, type TrainingLesson } from './trainingData';

// ──────────────────────────────────────────────────────────────────────────
// Training course (board A7). An interactive course shell over the content in
// trainingData.ts (the structured form of docs/TRAINING.md): a sticky TOC with
// per-module accordions and lesson checkboxes, a progress bar, and per-lesson
// "Do this" / "What you should see" panels with Previous / Mark-done-and-
// continue navigation. Progress is a per-viewer convenience kept in
// localStorage; the full guide link opens the prose source of truth.
// ──────────────────────────────────────────────────────────────────────────

// The training guide has no rendered-HTML endpoint, only raw markdown
// (/docs/training) and a generated PDF — link the PDF, which doubles as the
// board's "Print or save PDF" affordance.
const TRAINING_DOC_URL = '/api/v1/docs/training.pdf';
const DONE_KEY = 'procela:training-done';
const CUR_KEY = 'procela:training-cur';

interface FlatLesson { lesson: TrainingLesson; moduleNum: number; moduleTitle: string; index: number; }
const FLAT: FlatLesson[] = (() => {
  const out: FlatLesson[] = [];
  TRAINING_MODULES.forEach((m) => m.lessons.forEach((l) => out.push({ lesson: l, moduleNum: m.num, moduleTitle: m.title, index: out.length })));
  return out;
})();

function loadDone(): Set<string> {
  try { const raw = localStorage.getItem(DONE_KEY); return raw ? new Set(JSON.parse(raw) as string[]) : new Set(); } catch { return new Set(); }
}
function saveDone(d: Set<string>) { try { localStorage.setItem(DONE_KEY, JSON.stringify([...d])); } catch { /* */ } }
function loadCur(): string { try { return localStorage.getItem(CUR_KEY) || '1.1'; } catch { return '1.1'; } }
function saveCur(id: string) { try { localStorage.setItem(CUR_KEY, id); } catch { /* */ } }

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' } as const;

export default function HelpTrainingPage() {
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [curId, setCurId] = useState<string>(() => {
    const c = loadCur();
    return FLAT.some((f) => f.lesson.id === c) ? c : '1.1';
  });
  const [openModules, setOpenModules] = useState<Set<number>>(() => {
    const cur = FLAT.find((f) => f.lesson.id === loadCur());
    return new Set([cur ? cur.moduleNum : 1]);
  });

  const curIndex = useMemo(() => FLAT.findIndex((f) => f.lesson.id === curId), [curId]);
  const cur = FLAT[curIndex] ?? FLAT[0];

  const setCur = (id: string) => {
    setCurId(id); saveCur(id);
    const f = FLAT.find((x) => x.lesson.id === id);
    if (f) setOpenModules((prev) => new Set(prev).add(f.moduleNum));
  };
  const markDoneAndNext = () => {
    const next = new Set(done); next.add(cur.lesson.id); setDone(next); saveDone(next);
    const target = FLAT[Math.min(FLAT.length - 1, curIndex + 1)];
    setCur(target.lesson.id);
  };
  const toggleModule = (n: number) => setOpenModules((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  const doneCount = done.size;
  const pct = Math.round((doneCount / FLAT.length) * 100);

  return (
    <Page width="default">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        <Link to="/help" style={{ textDecoration: 'none', fontWeight: 500, color: 'var(--color-primary)' }}>Help</Link> <span aria-hidden="true">/</span> <span style={{ color: 'var(--color-text)' }}>Training course</span>
      </nav>
      <PageHeader
        title="Procela training course"
        subtitle={`${TRAINING_META.moduleCount} modules · about ${TRAINING_META.estimatedMinutes} minutes · uses the Tidewater Utilities demo data`}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{doneCount} of {FLAT.length} lessons done</span>
              <span aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: 6, width: `${pct}%`, background: 'var(--color-primary)' }} />
              </span>
            </div>
            <a href={TRAINING_DOC_URL} target="_blank" rel="noreferrer" style={{ height: 36, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', textDecoration: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" /><rect x="7" y="14" width="10" height="6" /></svg>
              Print or save PDF
            </a>
          </div>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        {/* TOC */}
        <nav aria-label="Course contents" style={{ ...card, flex: '1 1 280px', maxWidth: 340, padding: 8, boxSizing: 'border-box', position: 'sticky', top: 16 }}>
          {TRAINING_MODULES.map((m) => {
            const open = openModules.has(m.num);
            const d = m.lessons.filter((l) => done.has(l.id)).length;
            const all = d === m.lessons.length;
            const active = cur.moduleNum === m.num;
            return (
              <div key={m.num} style={{ borderTop: m.num === 1 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                <button type="button" onClick={() => toggleModule(m.num)} aria-expanded={open}
                  style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 24, height: 24, flex: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: all ? 'var(--color-primary)' : active ? 'var(--color-primary-light)' : 'var(--color-bg)', color: all ? '#fff' : active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{m.num}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-text)' }}>{m.title}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{m.minutes} min · {all ? 'complete' : `${d} of ${m.lessons.length} done`}</span>
                  </span>
                  <span aria-hidden="true" style={{ marginTop: 5, color: 'var(--color-text-secondary)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
                </button>
                {open && (
                  <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
                    {m.lessons.map((l) => {
                      const here = l.id === cur.lesson.id;
                      const dn = done.has(l.id);
                      return (
                        <li key={l.id}>
                          <button type="button" onClick={() => setCur(l.id)} aria-current={here ? 'step' : undefined}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 7px 44px', border: 0, borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontSize: 13, background: here ? 'var(--color-primary-light)' : 'transparent', color: here ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: here ? 600 : 400 }}>
                            <span aria-hidden="true" style={{ width: 14, height: 14, flex: 'none', borderRadius: 7, border: `1.5px solid ${dn ? 'var(--color-primary)' : 'var(--color-border)'}`, background: dn ? 'var(--color-primary)' : 'transparent', boxSizing: 'border-box' }} />
                            <span style={{ flex: 1 }}>{l.id} {l.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Lesson */}
        <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <article style={{ ...card, padding: '28px 32px', maxWidth: 860, boxSizing: 'border-box' }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Module {cur.moduleNum} · {cur.moduleTitle}</div>
            <h2 style={{ margin: '6px 0 4px', fontSize: 24, fontWeight: 600 }}>{cur.lesson.id} {cur.lesson.title}</h2>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>Lesson {curIndex + 1} of {FLAT.length}</div>

            {cur.lesson.intro && <p style={{ margin: '0 0 16px', fontSize: 15, color: 'var(--color-text-secondary)', maxWidth: 680 }}>{cur.lesson.intro}</p>}

            {cur.lesson.steps.length > 0 && (
              <>
                <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>Do this</h3>
                <ol style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cur.lesson.steps.map((st, i) => (
                    <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ width: 24, height: 24, flex: 'none', borderRadius: 12, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                      <span style={{ fontSize: 14 }}>{st}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {cur.lesson.result && (
              <>
                <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>What you should see</h3>
                <div style={{ borderLeft: '3px solid var(--color-primary)', background: 'var(--color-primary-light)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '14px 16px', fontSize: 14, color: 'var(--color-text)' }}>{cur.lesson.result}</div>
              </>
            )}
            {!cur.lesson.steps.length && !cur.lesson.result && !cur.lesson.intro && (
              <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>This lesson is a short read in the training guide — open the full guide for its detail.</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <button type="button" onClick={() => setCur(FLAT[Math.max(0, curIndex - 1)].lesson.id)} disabled={curIndex === 0}
                style={{ height: 40, padding: '0 14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--color-text)', cursor: curIndex === 0 ? 'default' : 'pointer', opacity: curIndex === 0 ? 0.5 : 1 }}>‹ Previous</button>
              <button type="button" onClick={markDoneAndNext}
                style={{ height: 40, padding: '0 16px', border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {curIndex === FLAT.length - 1 ? 'Mark done' : 'Mark done and continue ›'}
              </button>
            </div>
          </article>

          <aside style={{ ...card, maxWidth: 860, padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start', boxSizing: 'border-box' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></svg>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}><strong style={{ color: 'var(--color-text)' }}>Using your own organization?</strong> Every lesson works the same way — swap the Tidewater names for yours. You need admin rights to import and create.</div>
          </aside>
        </main>
      </div>
    </Page>
  );
}
