/**
 * Meia-entrada nos pontos de venda de ingresso (Lei 12.933/2013 + Decreto
 * 8.537/2015 art. 11 + Decreto 13.108/2026 art. 10-11).
 *
 * - Classifica cada tipo de ingresso em meia / promocional / comum. Promocional
 *   (cupom, convênio, solidário, cortesia ou marcado pelo produtor) é política
 *   comercial e NÃO conta na cota da meia (Decreto 13.108 art. 10).
 * - Resume os totais que TODO ponto de venda virtual deve mostrar: número total
 *   de ingressos, quantos são de meia e o aviso de esgotamento. Sem essas
 *   informações a meia passa a valer acima dos 40% (Decreto 8.537 art. 11, p.ú.).
 *
 * Módulo puro (sem React/Supabase) pra ser testado no Vitest.
 */

import { precoVigente, type Lote } from './lotes';

export type TicketCategory = 'meia' | 'promocional' | 'comum';

export interface TicketTypeLike {
  nome?: unknown;
  kind?: unknown;
  promocional?: unknown;
  preco?: number | null;
  lotes?: Lote[] | null;
  quantidade_total?: number | null;
}

export function ticketCategory(t: TicketTypeLike | null | undefined): TicketCategory {
  if (t?.promocional === true) return 'promocional';
  const kind = String(t?.kind ?? '').toLowerCase();
  const nome = String(t?.nome ?? '').toLowerCase();
  if (kind === 'meia' || nome.includes('meia')) return 'meia';
  if (kind === 'solidaria' || kind === 'cortesia' || /solid[aá]ri|cortes/.test(nome)) return 'promocional';
  return 'comum';
}

export interface StockLike { remaining: number | null; sold_out: boolean }

export interface MeiaRow {
  idx: number;
  nome: string;
  category: TicketCategory;
  /** null = sem limite de estoque configurado. */
  total: number | null;
  remaining: number | null;
  esgotado: boolean;
}

export interface MeiaSummary {
  rows: MeiaRow[];
  /** Todos os tipos têm estoque limitado, então o total é conhecido. */
  totalKnown: boolean;
  total: number;
  hasMeia: boolean;
  meiaTotal: number;
  meiaRemaining: number;
  /** Existe tipo de meia e todos estão esgotados. */
  meiaExhausted: boolean;
  /** 40% do total de ingressos ao público em geral (promocionais fora), arredondado pra cima. */
  cotaMinima: number | null;
  /** Oferta de meia abaixo dos 40% (só quando o total é conhecido). */
  abaixoDaCota: boolean | null;
}

/** Lei 12.933 art. 1º §10: meia = 40% do total de ingressos disponíveis. */
export const COTA_MEIA = 0.4;

export function summarizeMeia(
  ingressos: TicketTypeLike[] | null | undefined,
  stockByIdx: Record<string, StockLike | undefined> = {},
): MeiaSummary {
  const rows: MeiaRow[] = [];
  (Array.isArray(ingressos) ? ingressos : []).forEach((t, idx) => {
    if (!t?.nome || precoVigente(t as any) <= 0) return; // só o que está à venda
    const total = t.quantidade_total != null && Number(t.quantidade_total) > 0 ? Number(t.quantidade_total) : null;
    const stock = stockByIdx[String(idx)];
    const remaining = total == null ? null : (stock?.remaining ?? total);
    rows.push({
      idx,
      nome: String(t.nome),
      category: ticketCategory(t),
      total,
      remaining,
      esgotado: total != null && (stock?.sold_out === true || remaining === 0),
    });
  });

  const totalKnown = rows.length > 0 && rows.every(r => r.total != null);
  const total = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const meia = rows.filter(r => r.category === 'meia');
  const meiaTotal = meia.reduce((s, r) => s + (r.total ?? 0), 0);
  const meiaRemaining = meia.reduce((s, r) => s + (r.remaining ?? 0), 0);
  const publicoGeral = rows.filter(r => r.category !== 'promocional').reduce((s, r) => s + (r.total ?? 0), 0);
  const cotaMinima = totalKnown ? Math.ceil(publicoGeral * COTA_MEIA) : null;

  return {
    rows,
    totalKnown,
    total,
    hasMeia: meia.length > 0,
    meiaTotal,
    meiaRemaining,
    meiaExhausted: meia.length > 0 && meia.every(r => r.esgotado),
    cotaMinima,
    abaixoDaCota: cotaMinima == null ? null : meiaTotal < cotaMinima,
  };
}

/**
 * Texto do art. 1º da Lei 12.933/2013 (Planalto, dispositivos em vigor; §§ 3º e 7º
 * vetados). O Decreto 8.537 art. 11, I, a exige a transcrição em todo ponto de venda.
 */
export const LEI_12933_ART1: string[] = [
  'Art. 1º É assegurado aos estudantes o acesso a salas de cinema, cineclubes, teatros, espetáculos musicais e circenses e eventos educativos, esportivos, de lazer e de entretenimento, em todo o território nacional, promovidos por quaisquer entidades e realizados em estabelecimentos públicos ou particulares, mediante pagamento da metade do preço do ingresso efetivamente cobrado do público em geral.',
  '§ 1º O benefício previsto no caput não será cumulativo com quaisquer outras promoções e convênios e, também, não se aplica ao valor dos serviços adicionais eventualmente oferecidos em camarotes, áreas e cadeiras especiais.',
  '§ 2º Terão direito ao benefício os estudantes regularmente matriculados nos níveis e modalidades de educação e ensino previstos no Título V da Lei nº 9.394, de 20 de dezembro de 1996, que comprovem sua condição de discente, mediante a apresentação, no momento da aquisição do ingresso e na portaria do local de realização do evento, da Carteira de Identificação Estudantil (CIE), emitida pela Associação Nacional de Pós-Graduandos (ANPG), pela União Nacional dos Estudantes (UNE), pela União Brasileira dos Estudantes Secundaristas (Ubes), pelas entidades estaduais e municipais filiadas àquelas, pelos Diretórios Centrais dos Estudantes (DCEs) e pelos Centros e Diretórios Acadêmicos, com prazo de validade renovável a cada ano, conforme modelo único nacionalmente padronizado e publicamente disponibilizado pelas entidades nacionais antes referidas e pelo Instituto Nacional de Tecnologia da Informação (ITI), com certificação digital deste, podendo a carteira de identificação estudantil ter 50% (cinquenta por cento) de características locais.',
  '§ 4º A Associação Nacional de Pós-Graduandos, a União Nacional dos Estudantes, a União Brasileira dos Estudantes Secundaristas e as entidades estudantis estaduais e municipais filiadas àquelas deverão disponibilizar um banco de dados contendo o nome e o número de registro dos estudantes portadores da Carteira de Identificação Estudantil (CIE), expedida nos termos desta Lei, aos estabelecimentos referidos no caput deste artigo e ao Poder Público.',
  '§ 5º A representação estudantil é obrigada a manter o documento comprobatório do vínculo do aluno com o estabelecimento escolar, pelo mesmo prazo de validade da respectiva Carteira de Identificação Estudantil (CIE).',
  '§ 6º A Carteira de Identificação Estudantil (CIE) será válida da data de sua expedição até o dia 31 de março do ano subsequente.',
  '§ 8º Também farão jus ao benefício da meia-entrada as pessoas com deficiência, inclusive seu acompanhante quando necessário, sendo que este terá idêntico benefício no evento em que comprove estar nesta condição, na forma do regulamento.',
  '§ 9º Também farão jus ao benefício da meia-entrada os jovens de 15 a 29 anos de idade de baixa renda, inscritos no Cadastro Único para Programas Sociais do Governo Federal (CadÚnico) e cuja renda familiar mensal seja de até 2 (dois) salários mínimos, na forma do regulamento.',
  '§ 10. A concessão do direito ao benefício da meia-entrada é assegurada em 40% (quarenta por cento) do total dos ingressos disponíveis para cada evento.',
  '§ 11. As normas desta Lei não se aplicam aos eventos Copa do Mundo FIFA de 2014 e Olimpíadas do Rio de Janeiro de 2016.',
];

/**
 * Órgãos de fiscalização (Decreto 8.537 art. 11, I, b). Os canais abaixo são os
 * confirmados em fonte oficial (consumidor.gov.br, Procon); o telefone 151 é o do
 * Procon-SP e de outros estados — CONFIRMAR o número do Procon do estado de cada
 * local antes de tratar como definitivo.
 */
export const FISCALIZACAO_MEIA = {
  texto: 'Procon do seu estado ou município (telefone 151, onde o serviço estiver disponível) e Senacon/Ministério da Justiça e Segurança Pública.',
  linkLabel: 'consumidor.gov.br',
  linkHref: 'https://www.consumidor.gov.br',
};
