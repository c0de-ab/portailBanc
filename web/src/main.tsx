import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/hanken-grotesk';
import './styles.css';

const racine = document.getElementById('racine');
if (!racine) {
  throw new Error('Élément #racine introuvable dans index.html');
}

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
