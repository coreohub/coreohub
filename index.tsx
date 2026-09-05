import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// PWA: o registerSW.js auto-injetado pelo vite-plugin-pwa só chama
// navigator.serviceWorker.register() — não recarrega a aba quando um SW
// novo assume o controle. O sw.js gerado (registerType:'autoUpdate') já
// faz skipWaiting()+clientsClaim(), então o SW novo assume as requisições
// de rede na hora, mas o JS que já está rodando na aba aberta continua
// sendo o antigo até um reload. Sem esse listener, todo deploy exigia F5
// manual pra "voltar ao normal". Guard evita loop se o controllerchange
// disparar mais de uma vez.
if ('serviceWorker' in navigator) {
  let reloadingAfterSwUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingAfterSwUpdate) return;
    reloadingAfterSwUpdate = true;
    window.location.reload();
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
