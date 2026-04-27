/**
 * AsaasBadge — divulgação obrigatória da Asaas como instituição financeira.
 *
 * Exigência regulatória do modelo BaaS (Banking as a Service):
 *   - Resoluções Conjuntas BACEN n.º 16 e 17
 *   - Asaas é a instituição financeira responsável; a CoreoHub apenas integra
 *
 * Variantes:
 *   - "compact":  badge enxuto pra rodapé/canto (1 linha)
 *   - "card":     bloco com mais contexto pra páginas de pagamento
 *   - "inline":   uma linha legível dentro de fluxos (ex: criação de subconta)
 */

import React from 'react';
import { ShieldCheck, ExternalLink } from 'lucide-react';

interface AsaasBadgeProps {
  variant?: 'compact' | 'card' | 'inline';
  className?: string;
}

const ASAAS_CNPJ = '19.540.550/0001-21';
const ASAAS_TERMS_URL = 'https://www.asaas.com/termos-de-uso';

const AsaasBadge: React.FC<AsaasBadgeProps> = ({ variant = 'compact', className = '' }) => {
  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-full ${className}`}>
        <ShieldCheck size={12} className="text-blue-500" />
        <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400">
          Pagamento processado por <span className="font-black">Asaas</span>
        </span>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <p className={`text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed ${className}`}>
        <ShieldCheck size={10} className="inline mr-1 text-blue-500" />
        Os serviços financeiros desta plataforma — incluindo abertura de conta digital,
        recebimento e repasses — são prestados pela <strong>Asaas</strong> (CNPJ {ASAAS_CNPJ}),
        instituição autorizada pelo Banco Central do Brasil.
        {' '}
        <a
          href={ASAAS_TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
        >
          Termos <ExternalLink size={9} />
        </a>
      </p>
    );
  }

  // card
  return (
    <div className={`p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl ${className}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-500/10 rounded-xl text-blue-500 shrink-0">
          <ShieldCheck size={16} />
        </div>
        <div className="space-y-1.5 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-400">
            Serviços financeiros prestados por Asaas
          </p>
          <p className="text-[11px] text-blue-600 dark:text-blue-300 leading-relaxed">
            CoreoHub utiliza a infraestrutura de Banking as a Service (BaaS) da{' '}
            <strong>Asaas</strong> (CNPJ {ASAAS_CNPJ}), instituição autorizada pelo BACEN
            e responsável legal por contas digitais, cobranças, pagamentos e repasses
            desta plataforma.
          </p>
          <a
            href={ASAAS_TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-500 hover:text-blue-600 hover:underline"
          >
            Ver termos da Asaas <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
};

export default AsaasBadge;
