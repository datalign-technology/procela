import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import { openRoadmapWindow } from '../components/navConfig';

// ──────────────────────────────────────────────────────────────────────────
// Help centre (board A6). A searchable landing for everything Procela: a
// getting-started path, a browse-by-area topic grid, and ways to learn. The
// full feature-by-feature reference still lives in one document
// (packages/backend/src/docs/HELP.md, rendered at /api/v1/docs/help.html) —
// the topic cards and the "Full guide" action open it, so the prose stays a
// single source of truth rather than a second copy maintained in React.
// ──────────────────────────────────────────────────────────────────────────

const HELP_DOC_URL = '/api/v1/docs/help.html';
const helpDoc = (anchor?: string) => HELP_DOC_URL + (anchor ? `#${anchor}` : '');

// The getting-started path — there's no separate setup mode; working through
// the menu in this order fills in the dashboard. Each step deep-links to where
// you do it.
const STEPS: { n: number; title: string; desc: string; to: string }[] = [
  { n: 1, title: 'Create your organization', desc: 'Company, division and team tree, plus your people.', to: '/organizations' },
  { n: 2, title: 'Map your processes', desc: 'Value streams down to activities. The spine everything hangs off.', to: '/processes' },
  { n: 3, title: 'Register systems and data', desc: 'Systems, data assets in business terms, and data domains.', to: '/data-assets' },
  { n: 4, title: 'Connect and assign', desc: 'Link assets to activities; give everything an owner.', to: '/processes/data-map' },
  { n: 5, title: 'Define the foundation', desc: 'Scope, principles and operating model. The program is then live.', to: '/governance/foundation' },
];

// Popular jump-links shown under the search box.
const POPULAR: { label: string; anchor: string }[] = [
  { label: 'The Working in picker', anchor: 'navigation' },
  { label: 'Connections vs on-prem connectors', anchor: 'systems' },
  { label: 'Council scorecard', anchor: 'governance' },
  { label: 'Keyboard shortcuts', anchor: 'keyboard-shortcuts' },
];

// Browse-by-area topics. `k` is extra keywords the search also matches.
const TOPICS: { name: string; n: string; desc: string; anchor: string; k: string }[] = [
  { name: 'Navigation', n: '2 sections', desc: 'The menu, search (Ctrl K), the Working in picker and display preferences.', anchor: 'navigation', k: 'menu search working in picker org' },
  { name: 'Dashboard', n: '1 section', desc: 'Your tasks, issues and domains; the governed lens; Focus and Customize.', anchor: 'dashboard', k: 'home tasks issues lens focus' },
  { name: 'Processes', n: '2 sections', desc: 'Process catalog and the process-to-data map.', anchor: 'processes', k: 'process catalog value stream activity map' },
  { name: 'Data', n: '7 sections', desc: 'Assets, orphans, glossary, dictionary, lineage, domains, data quality.', anchor: 'data', k: 'asset glossary lineage domain quality dictionary owner' },
  { name: 'Systems', n: '4 sections', desc: 'Systems, connections, on-prem connectors and which to use.', anchor: 'systems', k: 'system connection connector database' },
  { name: 'Organizations', n: '4 sections', desc: 'Structure, people, AI agents and skills.', anchor: 'organizations', k: 'people agents skills structure owner' },
  { name: 'Governance', n: '14 sections', desc: 'Foundation, groups, roles and RACI, documents, calendar, council and more.', anchor: 'governance', k: 'raci roles policy council calendar exceptions decision' },
  { name: 'Security and account', n: '13 sections', desc: 'Sign-in, single sign-on, security keys and sessions.', anchor: 'security', k: 'sso login security key mfa session' },
  { name: 'Cross-cutting features', n: '9 sections', desc: 'Comments, notifications, saved views, Ask Procela and more.', anchor: 'cross-cutting-features', k: 'export comments views ai ask' },
  { name: 'Key concepts', n: '7 sections', desc: 'Plain definitions: tier, steward, domain, governed scope.', anchor: 'key-concepts', k: 'glossary tier steward domain scope definition' },
  { name: 'Frequently asked questions', n: '27 answers', desc: 'Short answers to common questions.', anchor: 'faq', k: 'faq question' },
  { name: 'Keyboard shortcuts', n: '1 page', desc: 'Every shortcut, including g + letter to jump to a page.', anchor: 'keyboard-shortcuts', k: 'keyboard shortcut keys' },
];

const WHATS_NEW = [
  'Auto-extracted lineage from Snowflake query history',
  'Governed lens on Dashboard and Council',
  'Governance value on the Council scorecard',
];

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 } as const;
const learnRow = { display: 'flex', gap: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'var(--color-text)', cursor: 'pointer', background: 'transparent', width: '100%', textAlign: 'left' as const };

export default function HelpPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const topics = useMemo(
    () => query ? TOPICS.filter((t) => `${t.name} ${t.desc} ${t.k}`.toLowerCase().includes(query)) : TOPICS,
    [query],
  );

  return (
    <Page width="default">
      <PageHeader
        title="Help"
        subtitle="How each part of Procela works."
        actions={
          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <a href={helpDoc()} target="_blank" rel="noreferrer" style={{ height: 36, padding: '0 14px', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', textDecoration: 'none' }}>Full guide ↗</a>
            <button type="button" onClick={() => navigate('/help/training')} style={{ height: 36, padding: '0 14px', border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Start the training course</button>
          </div>
        }
      />

      {/* Search */}
      <div style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', maxWidth: 720 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <input type="search" aria-label="Search help topics" placeholder="Search help, e.g. lineage, owner, SSO" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ border: 0, outline: 'none', flex: 1, font: 'inherit', fontSize: 15, color: 'var(--color-text)', background: 'transparent', minWidth: 0 }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: 'var(--color-text-muted)', alignItems: 'center' }}>
          Popular:
          {POPULAR.map((p) => (
            <a key={p.label} href={helpDoc(p.anchor)} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>{p.label}</a>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Getting started */}
          {!query && (
            <section style={{ ...card, padding: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Getting started</h2>
              <p style={{ margin: '4px 0 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>There is no separate setup mode. Work through the menu in roughly this order; each step fills in the dashboard.</p>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                {STEPS.map((s) => (
                  <li key={s.n}>
                    <Link to={s.to} style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 14, textDecoration: 'none', color: 'var(--color-text)', height: '100%', boxSizing: 'border-box' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 13, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{s.n}</span>
                      <span style={{ fontWeight: 600 }}>{s.title}</span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{s.desc}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Topics */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{query ? 'Matching topics' : 'Browse by area'}</h2>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{topics.length} topics</span>
            </div>
            {topics.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
                {topics.map((t) => (
                  <a key={t.name} href={helpDoc(t.anchor)} target="_blank" rel="noreferrer" style={{ ...card, textDecoration: 'none', color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.n}</span>
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.desc}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ ...card, padding: 28, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                No topics match “{q}”. <a href={helpDoc()} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Search the full guide</a> instead.
              </div>
            )}
          </section>
        </main>

        <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={{ ...card }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>Other ways to learn</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => navigate('/help/training')} style={learnRow}>
                <span style={{ fontWeight: 600, flex: 1 }}>Training course<span style={{ display: 'block', fontWeight: 400, fontSize: 13, color: 'var(--color-text-muted)' }}>13 hands-on modules, about 90 min</span></span>
              </button>
              <button type="button" onClick={() => window.dispatchEvent(new Event('procela:start-tour'))} style={learnRow}>
                <span style={{ fontWeight: 600, flex: 1 }}>Replay the intro tour<span style={{ display: 'block', fontWeight: 400, fontSize: 13, color: 'var(--color-text-muted)' }}>Define, Connect, Discover in 1 minute</span></span>
              </button>
              <button type="button" onClick={() => window.dispatchEvent(new Event('procela:toggle-chat'))} style={learnRow}>
                <span style={{ fontWeight: 600, flex: 1 }}>Ask Procela<span style={{ display: 'block', fontWeight: 400, fontSize: 13, color: 'var(--color-text-muted)' }}>Questions about your own catalog</span></span>
              </button>
            </div>
          </section>
          <section style={{ ...card }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>What’s new</h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {WHATS_NEW.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <button type="button" onClick={openRoadmapWindow} style={{ marginTop: 10, border: 0, background: 'transparent', padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Status and roadmap →</button>
          </section>
        </aside>
      </div>
    </Page>
  );
}
