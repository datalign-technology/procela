import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
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
