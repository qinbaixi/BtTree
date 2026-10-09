import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyStoredTheme } from './lib/theme';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

applyStoredTheme();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
