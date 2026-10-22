import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { applyAppearance } from './lib/colors';
import { initAccount } from './sync/account';
import { useSettings } from './store/settings';
import './styles.css';

// Settings hydrate synchronously from localStorage, so colors are applied before first paint.
applyAppearance(useSettings.getState().appearance);
useSettings.subscribe((s, prev) => {
  if (s.appearance !== prev.appearance) applyAppearance(s.appearance);
});

initAccount();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
