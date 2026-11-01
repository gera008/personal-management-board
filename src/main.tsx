import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './lib/i18n';
import './index.css';
import { App } from './app/App';
import { applyTheme } from './lib/profile';

// Apply the last theme before the profile loads to avoid a flash.
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') applyTheme(t);
} catch {
  /* storage unavailable */
}

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
