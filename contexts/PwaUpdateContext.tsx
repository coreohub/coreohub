import React, { createContext, useContext } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Único lugar do código inteiro que chama `useRegisterSW`. Esse hook registra
 * um Service Worker NOVO com seus próprios listeners toda vez que é invocado,
 * sem proteção contra chamada duplicada — se `PwaUpdatePrompt` (ou qualquer
 * tela do "Grupo B", ver abaixo) chamasse de novo, teríamos DOIS registros de
 * SW simultâneos na mesma aba (risco real de listener duplicado / reload em
 * loop). Por isso o registro mora aqui, num Provider montado uma única vez em
 * App.tsx, e todo o resto do app consome via `usePwaUpdate()`.
 *
 * Mesma lógica de "força `registration.update()` a cada 3min" que antes vivia
 * dentro de `PwaUpdatePrompt.tsx` — migrada pra cá porque agora é
 * responsabilidade do registro em si, não do banner (que virou só uma UI
 * possível entre várias que reagem a `needRefresh`).
 *
 * Banner global de "Nova versão disponível" (`components/PwaUpdatePrompt.tsx`)
 * aparece pra qualquer tela do produtor — EXCETO um "Grupo B" de telas
 * operadas por jurado leigo ou por quem está no meio de um formulário/wizard
 * sob pressão de tempo (Terminal do Júri, telas de entrada do jurado,
 * Wizard de inscrição, Checkout, Perfil, Minhas Coreografias). Essas telas
 * escondem o banner mas continuam aplicando o update sozinhas, só que só no
 * "momento seguro" de cada uma (nunca no meio de um formulário sendo
 * preenchido) — cada uma consome `needRefresh`/`updateServiceWorker` direto
 * daqui. Motivo: banner "Atualizar" confundiu um produtor real operando o
 * Terminal do Júri ao vivo.
 */
const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;

interface PwaUpdateContextValue {
  /** true quando o SW já baixou uma versão nova e está esperando pra assumir. */
  needRefresh: boolean;
  /** Manda o skipWaiting; com reloadPage=true também recarrega a aba. */
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  /** Equivalente ao antigo "Dispensar por agora" do banner (setNeedRefresh(false)). */
  dismiss: () => void;
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | undefined>(undefined);

export const PwaUpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

  const value: PwaUpdateContextValue = {
    needRefresh,
    updateServiceWorker,
    dismiss: () => setNeedRefresh(false),
  };

  return (
    <PwaUpdateContext.Provider value={value}>
      {children}
    </PwaUpdateContext.Provider>
  );
};

/** Hook de consumo — usar em qualquer tela que precise saber/aplicar update
 *  do PWA. NUNCA chamar `useRegisterSW` fora do Provider acima. */
export function usePwaUpdate(): PwaUpdateContextValue {
  const ctx = useContext(PwaUpdateContext);
  if (!ctx) {
    throw new Error('usePwaUpdate() precisa estar dentro de <PwaUpdateProvider>.');
  }
  return ctx;
}
