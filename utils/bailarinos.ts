/**
 * Helpers compartilhados pra checar "dados pendentes" dos bailarinos.
 *
 * Topologia:
 *   - `registrations.bailarinos_detalhes` (JSONB) = referência leve por inscrição:
 *       Array<{ id: string, nome: string, instagram_handle: string | null }>
 *   - `elenco` (tabela) = fonte de verdade dos dados pessoais:
 *       { id, user_id, nome, cpf, data_nascimento }
 *   - JOIN via `bailarinos_detalhes[].id = elenco.id`
 *
 * Histórico do bug (2026-05-22): helper antigo lia `b.cpf` direto do JSONB
 * — mas o JSONB nunca teve esse campo. Resultado: 100% das inscrições
 * marcadas como incompletas. Feature shipou, cron disparou notif falsa,
 * banner em todos dashboards. Disable em commit `4602573`, refator em
 * `20260601_producer_reads_event_elenco.sql` + este arquivo.
 *
 * **Sempre** carregar `elencoById` via batch fetch antes de usar
 * `hasIncompleteBailarinos`. Sem o mapa, helper trata tudo como incompleto
 * (preserva o "sinal" de inconsistência: id no JSONB sem row em elenco =
 * problema real, não falso positivo).
 */

export interface ElencoRow {
  id: string;
  nome?: string | null;
  cpf?: string | null;
  data_nascimento?: string | null;
}

export interface BailarinoRef {
  id?: string | null;
  nome?: string | null;
  instagram_handle?: string | null;
}

export type ElencoById = Record<string, ElencoRow>;

interface RegistrationLike {
  bailarinos_detalhes?: BailarinoRef[] | null;
  formato_participacao?: string | null;
}

/** True se uma row de `elenco` está sem CPF, sem data_nascimento ou sem nome. */
export const isElencoIncompleto = (e: ElencoRow | null | undefined): boolean => {
  if (!e) return true;
  return (
    !String(e.cpf ?? '').trim() ||
    !String(e.data_nascimento ?? '').trim() ||
    !String(e.nome ?? '').trim()
  );
};

/** Extrai os ids de bailarinos referenciados pela inscrição (filtra nulos). */
export const extractBailarinosIds = (reg: RegistrationLike): string[] => {
  const arr = Array.isArray(reg?.bailarinos_detalhes) ? reg.bailarinos_detalhes : [];
  return arr.map(b => b?.id).filter((id): id is string => Boolean(id));
};

/**
 * True se a inscrição tem ≥1 bailarino com dados pendentes (CPF/data/nome
 * vazios na `elenco`) — OU se é zumbi (modalidade declarada mas array vazio).
 *
 * Casos:
 * - Array vazio + modalidade declarada (`formato_participacao` truthy) →
 *   incompleto. Inscrição zumbi (PWA cache antigo, caso Grazieli "Entre
 *   cordas e sonhos").
 * - Array com ids mas row da `elenco` ausente (id órfão) → incompleto.
 *   Significa inscrição apontando pra bailarino deletado.
 * - Row presente mas com algum campo vazio → incompleto.
 */
export const hasIncompleteBailarinos = (
  reg: RegistrationLike,
  elencoById: ElencoById,
): boolean => {
  const ids = extractBailarinosIds(reg);
  if (ids.length === 0) {
    return Boolean(reg.formato_participacao);
  }
  return ids.some(id => isElencoIncompleto(elencoById[id]));
};

/**
 * Conta bailarinos incompletos numa inscrição. Pra texto informativo tipo
 * "2 de 5 bailarinos com dados pendentes".
 */
export const countIncompleteBailarinos = (
  reg: RegistrationLike,
  elencoById: ElencoById,
): { incompletos: number; total: number } => {
  const ids = extractBailarinosIds(reg);
  const total = ids.length;
  const incompletos = ids.filter(id => isElencoIncompleto(elencoById[id])).length;
  return { incompletos, total };
};

/** Coleta ids únicos de bailarinos referenciados por TODAS as inscrições. */
export const collectAllBailarinosIds = (regs: RegistrationLike[]): string[] => {
  const set = new Set<string>();
  for (const reg of regs ?? []) {
    for (const id of extractBailarinosIds(reg)) set.add(id);
  }
  return [...set];
};
