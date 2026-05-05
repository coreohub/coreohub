/**
 * Selo "Serviços Financeiros Asaas" — exigência regulatória do BaaS Asaas.
 *
 * Conforme Playbook de uso da marca Asaas (Resolução Conjunta nº 16/2025
 * do Banco Central), o selo é OBRIGATÓRIO em todos os pontos de contato
 * que envolvem operações financeiras de pagamentos:
 *  - Telas de cadastro/login
 *  - Criação de subconta
 *  - Listagem de cobrança / extratos
 *  - Comprovantes de pagamento
 *  - Documentações legais (termos, contratos)
 *  - E-mails (boas-vindas, cobrança, finalização)
 *  - Fluxos externos (link de cobrança, checkout, assinatura)
 *
 * Asaas reprovou a primeira tentativa porque era apenas menção textual.
 * Esta versão renderiza o SELO VISUAL oficial conforme playbook (img tag
 * apontando pra CDN privada da Asaas — URL fornecida no onboarding).
 *
 * IMPORTANTE: O ID na URL é placeholder até a Asaas enviar o ID oficial.
 * Quando chegar, basta atualizar a constante ASAAS_BADGE_ID abaixo — todas
 * as ocorrências no app passam a apontar pro selo correto automaticamente.
 *
 * Tema (cor de fundo do contexto):
 *  - 'positive' (default) — fundo claro/colorido
 *  - 'mono'              — monocromático escuro sobre fundo branco
 *  - 'negative'          — fundo escuro/dark mode
 *
 * Variantes de layout (retrocompat com chamadas existentes):
 *  - 'compact' (default) — só o selo, sem texto adicional
 *  - 'inline'            — selo + linha curta de contexto ao lado
 *  - 'card'              — selo dentro de card com explicação completa
 *
 * O selo NÃO PODE ser alterado, distorcido ou adaptado conforme playbook.
 * Sempre redireciona pra https://asaas.com (target=_blank + rel=noopener).
 */

import React, { useState } from 'react';

// ID oficial fornecido pela Asaas durante a homologação BaaS (2026-05-04).
// Versionado aqui pra fácil rotacionamento se a Asaas mudar a integração.
const ASAAS_BADGE_ID = 'd58edae9-a53c-4ab3-9e71-a4e04d8a8b15';
const ASAAS_BADGE_BASE = 'https://baas.asaas.com/selos';
const ASAAS_HOME = 'https://asaas.com';

const URL_BY_THEME = {
  positive: `${ASAAS_BADGE_BASE}/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=${ASAAS_BADGE_ID}`,
  mono:     `${ASAAS_BADGE_BASE}/Servicos_financeiros_Asaas-Reduzida-Negativo-Preto.svg?id=${ASAAS_BADGE_ID}`,
  negative: `${ASAAS_BADGE_BASE}/Servicos_financeiros_Asaas-Reduzida-Negativo-Branco.svg?id=${ASAAS_BADGE_ID}`,
} as const;

type AsaasBadgeTheme = keyof typeof URL_BY_THEME;
type AsaasBadgeVariant = 'compact' | 'inline' | 'card';

interface AsaasBadgeProps {
  /** Layout — retrocompat com chamadas antigas. Default 'compact'. */
  variant?: AsaasBadgeVariant;
  /** Tema visual (fundo onde o selo aparece). Default 'positive'. */
  theme?: AsaasBadgeTheme;
  /** Largura em px. Default 160 (recomendado pelo Playbook). */
  width?: number;
  /** Altura em px. Default 48 (recomendado pelo Playbook). */
  height?: number;
  /** Classes adicionais aplicadas no wrapper externo. */
  className?: string;
}

/**
 * Fallback textual mínimo enquanto a URL oficial não responde (ID placeholder
 * ou rede falha). NÃO é adaptação do selo — é nota neutra que cumpre a função
 * de identificar o Asaas como prestador, sem usar o logo da marca.
 */
const TextFallback: React.FC<{ theme: AsaasBadgeTheme }> = ({ theme }) => {
  const isDark = theme === 'negative';
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[10px] font-bold leading-tight whitespace-nowrap ${
        isDark
          ? 'bg-slate-900 border-white/20 text-white'
          : 'bg-white border-slate-300 text-slate-700'
      }`}
    >
      <span className="font-black tracking-wider">Serviços financeiros</span>
      <span className="font-black tracking-widest">ASAAS</span>
    </span>
  );
};

const SealImage: React.FC<{
  theme: AsaasBadgeTheme;
  width: number;
  height: number;
}> = ({ theme, width, height }) => {
  const [errored, setErrored] = useState(false);
  if (errored) return <TextFallback theme={theme} />;
  return (
    <img
      src={URL_BY_THEME[theme]}
      alt="Selo Serviços Financeiros Asaas — instituição responsável pelo processamento dos pagamentos"
      width={width}
      height={height}
      style={{ display: 'inline-block' }}
      onError={() => setErrored(true)}
    />
  );
};

const AsaasBadge: React.FC<AsaasBadgeProps> = ({
  variant = 'compact',
  theme = 'positive',
  width = 160,
  height = 48,
  className = '',
}) => {
  const seal = (
    <a
      href={ASAAS_HOME}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Asaas — Serviços financeiros (abre em nova aba)"
      className="inline-block"
    >
      <SealImage theme={theme} width={width} height={height} />
    </a>
  );

  if (variant === 'compact') {
    return <div className={`inline-flex ${className}`}>{seal}</div>;
  }

  if (variant === 'inline') {
    const isDark = theme === 'negative';
    return (
      <div className={`flex items-center gap-3 flex-wrap ${className}`}>
        {seal}
        <span className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          Serviços financeiros prestados pelo Asaas, instituição autorizada pelo Banco Central do Brasil.
        </span>
      </div>
    );
  }

  // card
  const isDark = theme === 'negative';
  return (
    <div
      className={`p-4 rounded-2xl border ${
        isDark
          ? 'bg-slate-900 border-white/10'
          : 'bg-slate-50 border-slate-200'
      } ${className}`}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0">{seal}</div>
        <div className="min-w-0 space-y-1.5">
          <p className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
            Serviços financeiros Asaas
          </p>
          <p className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Os serviços financeiros desta plataforma — incluindo abertura de conta de pagamento,
            processamento de transações, emissão de cobranças, transferências e demais movimentações —
            são prestados pelo <strong>ASAAS GESTÃO FINANCEIRA S.A.</strong>, instituição de pagamento
            autorizada a funcionar pelo Banco Central do Brasil.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AsaasBadge;
export { ASAAS_BADGE_ID, ASAAS_BADGE_BASE, URL_BY_THEME };
