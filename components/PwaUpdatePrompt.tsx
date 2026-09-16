import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Banner global — aparece quando o Service Worker baixou uma versão nova do
 * app em background (registerType: 'prompt' em vite.config.ts). Sem isso, a
 * aba aberta continuava rodando o JS velho até fechar/recarregar manualmente
 * — já reverteu fix em produção 2x salvando com aba desatualizada aberta
 * (ver memory/backlog_pwa_update_prompt_forcar_reload.md).
 *
 * Sem timeout automático de reload por decisão: forçar recarregar sozinho
 * no meio de alguém preenchendo formulário seria pior que o problema atual.
 *
 * `useRegisterSW` sozinho só registra o SW e detecta update via checagem
 * nativa do browser (que pode nunca rodar numa SPA com aba parada, sem
 * navegação/full reload) — por isso `onRegisteredSW` força `registration
 * .update()` a cada 3min enquanto a aba fica aberta, senão o banner nunca
 * apareceria pra quem só deixa a tela de Configurações aberta e parada
 * (exatamente o cenário real que motivou essa feature).
 */
const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;

const PwaUpdatePrompt: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  const [updating, setUpdating] = useState(false);

  if (!needRefresh) return null;

  // updateServiceWorker manda o skipWaiting e conta com um listener interno
  // da lib (evento 'controlling') pra recarregar sozinho — em testes com
  // deploys em sequência rápida esse listener às vezes não dispara (worker
  // já tinha mudado de estado). Failsafe: se em 2s não recarregou sozinho,
  // força na mão — a essa altura já sabemos que existe versão nova de verdade.
  const handleUpdate = () => {
    setUpdating(true);
    updateServiceWorker(true);
    setTimeout(() => window.location.reload(), 2000);
  };

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[60] max-w-sm sm:ml-auto">
      <div className="flex items-center gap-3 bg-[#ff0068] text-white rounded-2xl shadow-2xl px-4 py-3">
        <RefreshCw size={18} className={`shrink-0 ${updating ? 'animate-spin' : ''}`} />
        <p className="flex-1 min-w-0 text-sm font-bold">
          Nova versão disponível
        </p>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="shrink-0 px-3 py-1.5 bg-white text-[#ff0068] rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-70 cursor-pointer disabled:cursor-default"
        >
          {updating ? 'Atualizando…' : 'Atualizar'}
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          className="shrink-0 p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
          aria-label="Dispensar por agora"
          title="Dispensar por agora"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default PwaUpdatePrompt;
