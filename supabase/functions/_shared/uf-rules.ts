// Regras estaduais sobre taxa de venda online de ingresso (pesquisa 2026-10-02,
// docs/pesquisa-processamento-taxas-meia.md §6). Módulo puro, números em
// UF_RULES (único lugar). A UF vem de events.state (2 letras).
//
//   AC, RR  proíbem taxa de venda online: nada de linha nem comissão repassada
//           ao comprador (forceAbsorb) — o produtor/CoreoHub absorvem.
//   ES      exige canal sem taxa (dispensado até 200 pessoas): só avisa, não bloqueia.
//   AL, RJ  teto de 10% do valor de face somando comissão repassada + linha.
//           (AL vale acima de 500 pessoas, RJ acima de 1.000; aplicamos sempre
//           por falta do dado de lotação aqui: mais conservador.)
//   PR      teto de 20% (mesma soma).
//   Fortaleza (município): só pendência, sem tratamento aqui.
//
// Qual UF vale (do evento ou do comprador) é decisão em aberto: usamos a do evento.

export interface UfRule {
  /** Proíbe taxa online: linha e comissão repassada saem do comprador. */
  forceAbsorb?: boolean;
  /** Teto (% do valor de face) para comissão repassada + linha. */
  maxTotalFeePercent?: number;
  /** Só registrar aviso (não bloqueia). */
  warn?: string;
}

export const UF_RULES: Record<string, UfRule> = {
  AC: { forceAbsorb: true },
  RR: { forceAbsorb: true },
  ES: { warn: 'ES exige canal de venda sem taxa (dispensado até 200 pessoas)' },
  AL: { maxTotalFeePercent: 10 },
  RJ: { maxTotalFeePercent: 10 },
  PR: { maxTotalFeePercent: 20 },
};

export const normalizeUf = (uf: string | null | undefined): string | null => {
  const u = (uf ?? '').trim().toUpperCase();
  return u.length === 2 ? u : null;
};

export function getUfRule(uf: string | null | undefined, rules: Record<string, UfRule> = UF_RULES): UfRule | null {
  const u = normalizeUf(uf);
  return u ? (rules[u] ?? null) : null;
}

export interface UfAdjustInput {
  uf: string | null | undefined;
  /** Valor de face (preço sem comissão e sem linha). */
  face: number;
  /** Comissão repassada ao comprador (0 em 'absorver'). */
  commissionRepassed: number;
  /** Linha de processamento calculada pela fórmula. */
  fee: number;
  rules?: Record<string, UfRule>;
}

export interface UfAdjustResult {
  fee: number;
  commissionRepassed: number;
  /** true se o produtor/CoreoHub precisam absorver comissão e linha. */
  forcedAbsorb: boolean;
  /** true se a linha foi reduzida por teto estadual. */
  capped: boolean;
  warnings: string[];
}

const r2 = (n: number) => parseFloat(n.toFixed(2));

export function applyUfRules(input: UfAdjustInput): UfAdjustResult {
  const rule = getUfRule(input.uf, input.rules);
  const out: UfAdjustResult = {
    fee: input.fee,
    commissionRepassed: input.commissionRepassed,
    forcedAbsorb: false,
    capped: false,
    warnings: [],
  };
  if (!rule) return out;

  if (rule.warn) out.warnings.push(rule.warn);

  if (rule.forceAbsorb) {
    out.fee = 0;
    out.commissionRepassed = 0;
    out.forcedAbsorb = true;
    return out;
  }

  if (rule.maxTotalFeePercent != null && input.face > 0) {
    const maxTotal = Math.floor(input.face * rule.maxTotalFeePercent + 1e-7) / 100;
    const room = Math.max(0, r2(maxTotal - input.commissionRepassed));
    if (input.fee > room) {
      out.fee = room;
      out.capped = true;
    }
  }
  return out;
}
