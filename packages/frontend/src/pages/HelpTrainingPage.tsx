import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { renderMarkdown } from '../lib/markdown';

// ──────────────────────────────────────────────────────────────────────────
// HelpTrainingPage — renders the Tidewater Utilities training guide
// inside the app. Single source of truth: pulls TRAINING.md from the
// backend's /docs/training endpoint and renders it with the in-house
// markdown library. So updates to the .md flow through here without
// a build.
// ──────────────────────────────────────────────────────────────────────────

export default function HelpTrainingPage() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ success: boolean; data: { markdown: string; sourcePath: string; bytes: number } }>('/docs/training')
      .then((res) => setMarkdown(res.data.markdown))
      .catch((err) => setError(err?.body?.error || err?.message || 'Failed to load training guide.'));
  }, []);

  return (
    <Page width="narrow">
      <PageHeader
        title="Training Guide"
        subtitle="A 90-minute click-by-click walkthrough of Procela using the Tidewater Utilities fixture data."
        actions={
          <Link to="/help" style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none' }}>
            ← Back to Help
          </Link>
        }
      />
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
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}>Loading…</div>
      )}
      {markdown !== null && (
        <div>{renderMarkdown(markdown)}</div>
      )}
    </Page>
  );
}
