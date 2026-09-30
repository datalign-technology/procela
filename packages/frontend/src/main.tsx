import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
// Self-hosted IBM Plex (Latin subset, weights 400/500/600) to match the
// "Process Catalog — Enhanced" mock-ups. Bundled via @fontsource so there's no
// runtime dependency on an external font CDN (on-prem / air-gapped friendly).
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@/styles/global.css';
import { useBrandingStore } from '@/stores/brandingStore';

// Fetch branding before any React rendering happens so the login screen
// and shell paint with the customer's colors on first draw. This is
// fire-and-forget — the store also falls back to defaults on failure.
useBrandingStore.getState().fetch();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
