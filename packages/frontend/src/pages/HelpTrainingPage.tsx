import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { renderMarkdown } from '../lib/markdown';

// ──────────────────────────────────────────────────────────────────────────
// HelpTrainingPage — Tidewater Utilities training walkthrough rendered
// in a chrome-free reading window.
//
// Mounted *outside* the main Layout wrapper in App.tsx, so this page
// owns its own top-level styling: no left nav, no Working In picker,
// no app menus — just a thin Procela bar, the title, and the content.
// Opened via target="_blank" from the Help page so the in-app session
// stays put while the user reads.
// ──────────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-sans, system-ui, sans-serif)',
};

const barStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 24px',
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-sm)',
};

const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'baseline', gap: 8,
  fontSize: 14, fontWeight: 700,
};

const contentStyle: React.CSSProperties = {
  maxWidth: 820, margin: '0 auto',
  padding: '32px 24px 64px',
};

const titleStyle: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, margin: '0 0 6px',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 32px',
};

const printBtnStyle: React.CSSProperties = {
  fontSize: 12, padding: '6px 12px',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-primary)',
  borderRadius: 4, cursor: 'pointer',
};

export default function HelpTrainingPage() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Procela — Training Guide';
    apiClient
      .get<{ success: boolean; data: { markdown: string; sourcePath: string; bytes: number } }>('/docs/training')
      .then((res) => setMarkdown(res.data.markdown))
      .catch((err) => setError(err?.body?.error || err?.message || 'Failed to load training guide.'));
  }, []);

  return (
    <div style={pageStyle}>
      <div style={barStyle}>
        <span style={brandStyle}>
          <span style={{ color: 'var(--color-primary)' }}>Procela</span>
          <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: 12 }}>
            Training Guide
          </span>
        </span>
        <button
          onClick={() => window.print()}
          style={printBtnStyle}
          title="Print or save as PDF"
        >
          Print / Save PDF
        </button>
      </div>

      <div style={contentStyle}>
        <h1 style={titleStyle}>Training Guide</h1>
        <p style={subtitleStyle}>
          A 90-minute click-by-click walkthrough of Procela using the Tidewater Utilities fixture data.
        </p>

        {error && (
          <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
            <strong>Couldn't load the training guide.</strong>
            <div style={{ marginTop: 6 }}>{error}</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              The guide lives at <code>test-data/utility/TRAINING.md</code> in the repo and is served by
              <code> GET /api/v1/docs/training</code>. Check that the backend is running and that the
              <code>test-data</code> directory is accessible from its working directory.
            </div>
          </div>
        )}

        {!error && markdown === null && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
        )}

        {markdown !== null && <div>{renderMarkdown(markdown)}</div>}
      </div>
    </div>
  );
}
