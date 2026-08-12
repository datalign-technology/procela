import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { renderMarkdown } from '../lib/markdown';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';

// ──────────────────────────────────────────────────────────────────────────
// HelpTrainingPage — Tidewater Utilities training walkthrough.
//
// Mounted at /help/training inside the Layout wrapper. Layout detects
// the path and renders a chrome-free reading view with just the
// standard Procela top bar + Close button — matching the Help guide
// pattern exactly. This component owns only the content.
//
// Opened via openTrainingWindow() (popup window, 1100×900). The same
// route also works as a direct deep link in any tab; the close-button
// fallback in Layout handles both cases.
// ──────────────────────────────────────────────────────────────────────────

// Retired — replaced by <Page width="narrow" padding="8px 0 32px">
// which supplies the same maxWidth:820 + centred margin from the
// shared width preset.

const printBarStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', marginBottom: 12,
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
    <Page width="narrow" padding="8px 0 32px">
      <PageHeader
        title="Training Guide"
        subtitle="A 90-minute click-by-click walkthrough of Procela using the Tidewater Utilities fixture data."
      />

      <div style={printBarStyle}>
        <button
          onClick={() => window.print()}
          style={printBtnStyle}
          title="Print or save the guide as a PDF for offline reading"
        >
          Print / Save PDF
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
          <strong>Couldn't load the training guide.</strong>
          <div style={{ marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 10, fontSize: 12 }}>
            The guide lives at <code>docs/TRAINING.md</code> in the repo and is served by
            <code> GET /api/v1/docs/training</code>. Check that the backend is running and that the
            <code>docs</code> directory is accessible from its working directory.
          </div>
        </div>
      )}

      {!error && markdown === null && (
        <Spinner label="Loading…" />
      )}

      {markdown !== null && <div>{renderMarkdown(markdown)}</div>}
    </Page>
  );
}
