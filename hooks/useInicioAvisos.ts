import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { SCHEDULABLE_REGISTRATIONS_OR_FILTER } from '../utils/registrationStatus';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  expires_at: string | null;
}

export interface OrdemItem {
  id: string;
  nome: string;
  ordem: number | null;
  blocoNome: string | null;
}

/**
 * Avisos do produtor + ordem de apresentação da Início do inscrito.
 * Puramente informativo — carrega 1x no mount, sem realtime (decisão
 * 2026-07-07: ordem de apresentação não precisa refletir mudança ao vivo,
 * o Cronograma/Terminal do dia é quem serve isso em tempo real).
 *
 * Lê `ordem_apresentacao_publicado`/`bloco_id_publicado` (snapshot
 * congelado quando o produtor clica "Publicar pros inscritos" no
 * Cronograma) — NÃO as colunas live `ordem_apresentacao`/`bloco_id`, que o
 * produtor pode estar reorganizando à vontade sem que isso vaze aqui antes
 * da hora (Fase 2 do plano draft→publish, 2026-07-08).
 */
export const useInicioAvisos = (eventId: string | null | undefined, userId: string) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ordemItems, setOrdemItems] = useState<OrdemItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    (async () => {
      const nowIso = new Date().toISOString();
      const [{ data: avisos }, { data: regs }] = await Promise.all([
        supabase.from('event_announcements')
          .select('id, title, body, cta_label, cta_url, expires_at')
          .eq('event_id', eventId)
          .eq('active', true)
          .order('created_at', { ascending: false }),
        supabase.from('registrations')
          .select('id, nome_coreografia, ordem_apresentacao_publicado, bloco_id_publicado')
          .eq('event_id', eventId)
          .eq('user_id', userId)
          .not('ordem_apresentacao_publicado', 'is', null)
          .eq('excluded_from_schedule', false)
          // Blinda contra coreografia que foi paga, ganhou posição no
          // Cronograma, e depois foi estornada — ordem_apresentacao antigo
          // ficaria órfão sem esse filtro (mesma regra do Cronograma real).
          .or(SCHEDULABLE_REGISTRATIONS_OR_FILTER)
          .order('ordem_apresentacao_publicado', { ascending: true }),
      ]);

      setAnnouncements((avisos ?? []).filter(a => !a.expires_at || a.expires_at >= nowIso));

      if (regs && regs.length > 0) {
        const blocoIds = [...new Set(regs.map(r => r.bloco_id_publicado).filter(Boolean))] as string[];
        let blocosMap: Record<string, string> = {};
        if (blocoIds.length > 0) {
          const { data: blocos } = await supabase.from('cronograma_blocos').select('id, name').in('id', blocoIds);
          blocosMap = Object.fromEntries((blocos ?? []).map(b => [b.id, b.name]));
        }
        setOrdemItems(regs.map(r => ({
          id: r.id,
          nome: r.nome_coreografia,
          ordem: r.ordem_apresentacao_publicado,
          blocoNome: r.bloco_id_publicado ? blocosMap[r.bloco_id_publicado] ?? null : null,
        })));
      } else {
        setOrdemItems([]);
      }
      setLoading(false);
    })();
  }, [eventId, userId]);

  return { announcements, ordemItems, loading };
};
