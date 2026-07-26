import { initTheme } from './shared/theme.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { I18nextProvider } from 'react-i18next';
import { queryClient } from './shared/api/queryClient.js';
import { i18n } from './shared/i18n/index.js';
import './shared/i18n/zod-errors.js';
import { router } from './app/router.js';
import './styles/app.css';

// Set data-theme before first paint (stored choice or OS preference).
initTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
