import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './lib/i18n';
import './index.css';
import { App } from './app/App';
import { applyAccent } from './lib/profile';
import { keepAppUpdated } from './lib/swUpdate';

// Apply the last accent before the profile loads to avoid a flash.
try {
  const a = localStorage.getItem('accent');
  if (a === 'orange' || a === 'ice' || a === 'mint') applyAccent(a);
} catch {
  /* storage unavailable */
}

keepAppUpdated();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
