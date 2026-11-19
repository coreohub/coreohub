import { supabase } from '../services/supabase';

/**
 * Vencedores REGISTRADOS (ainda não revelados) vivem em `premios_vencedores`
 * (B1, 2026-11-19): tabela sem acesso anon, leitura só do dono do evento e do
 * super admin. `configuracoes.premios_especiais` é público, então só recebe o
 * vencedor depois da revelação (RPC `update_premios_winners` com
 * `winner_revealed: true`). As telas do produtor mesclam os dois aqui.
 */
export interface PremioVencedorRow {
  award_id: string;
  winner_nome: string | null;
  winner_estudio: string | null;
  winner_items: any[] | null;
}

export const fetchPremiosVencedores = async (eventId: string | null | undefined): Promise<PremioVencedorRow[]> => {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('premios_vencedores')
    .select('award_id, winner_nome, winner_estudio, winner_items')
    .eq('event_id', eventId);
  // Sem checar error, tabela ausente/RLS viraria "ninguém registrado" em silêncio.
  if (error) console.error('fetchPremiosVencedores', error);
  return (data as PremioVencedorRow[] | null) ?? [];
};

/** Sobrepõe o vencedor privado ao que veio de premios_especiais (privado vence). */
export const mergePremiosVencedores = (awards: any[], rows: PremioVencedorRow[]): any[] => {
  if (!Array.isArray(awards) || rows.length === 0) return awards;
  const byId = new Map(rows.map((r) => [String(r.award_id), r]));
  return awards.map((a) => {
    const r = a?.id != null ? byId.get(String(a.id)) : undefined;
    if (!r) return a;
    return { ...a, winner_nome: r.winner_nome, winner_estudio: r.winner_estudio, winner_items: r.winner_items };
  });
};
