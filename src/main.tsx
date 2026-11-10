import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { syncStore } from '@/app/repo';
import './index.css';

registerSW({ immediate: true });
syncStore.start(); // push sync edits made offline once the device is online

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
