import React from 'react';
import { FlaskConical } from 'lucide-react';

/**
 * Faixa fixa para eventos em modo sandbox (events.payment_sandbox = true).
 * Deixa inequívoco que o evento é de teste e que os pagamentos usam dinheiro
 * fictício da Asaas sandbox — ninguém confunde com um evento real.
 */
const SandboxBanner: React.FC = () => (
  <div
    role="status"
    className="sticky top-0 z-[70] flex items-center justify-center gap-2 bg-amber-400 px-4 py-2 text-center text-[11px] font-black uppercase tracking-widest text-amber-950"
  >
    <FlaskConical size={14} aria-hidden="true" />
    Ambiente de teste — pagamentos com dinheiro fictício. Não é um evento real.
  </div>
);

export default SandboxBanner;
