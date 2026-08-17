import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './ErrorBoundary.tsx';
import './index.css';
import './i18n';
import {registerAppServiceWorker} from './lib/pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// After first paint: this only enables install + offline shell, nothing renders on it.
window.addEventListener('load', () => {
  void registerAppServiceWorker();
});
