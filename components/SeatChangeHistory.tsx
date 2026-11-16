/**
 * SeatChangeHistory — histórico de trocas de lugar de um ingresso (tabela ticket_seat_changes).
 * Leitura só para dono do evento e super admin (RLS). Para quem não pode ler (equipe), a
 * lista vem vazia: mostra o texto "Nenhuma troca registrada" sem esconder o bloco.
 */

import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../services/supabase';
import { seatLabel } from '../utils/seatSwap';

interface Change {
  id: string;
  old_seat_id: string;
  new_seat_id: string;
  reason: string | null;
  released_old: boolean;
  actor_role: string | null;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = { owner: 'dono', super_admin: 'super admin', team: 'equipe' };

const SeatChangeHistory: React.FC<{ ticketId: string; refreshKey?: string | number }> = ({ ticketId, refreshKey }) => {
  const [items, setItems] = useState<Change[] | null>(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    (async () => {
      const { data, error } = await supabase
        .from('ticket_seat_changes')
        .select('id, old_seat_id, new_seat_id, reason, released_old, actor_role, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) console.error('[SeatChangeHistory]', error.code, error.message);
      if (alive) setItems((data as Change[] | null) ?? []);
    })();
    return () => { alive = false; };
  }, [ticketId, refreshKey]);

  return (
    <div>
      <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Trocas de lugar</h4>
      <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-200 dark:divide-white/10">
        {items === null && <p className="px-3 py-2 text-xs text-slate-500">Carregando...</p>}
        {items?.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">Nenhuma troca registrada.</p>}
        {items?.map(c => (
          <div key={c.id} className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
            <p className="font-black flex items-center gap-1.5 flex-wrap">
              {seatLabel(c.old_seat_id)} <ArrowRight size={11} /> {seatLabel(c.new_seat_id)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {new Date(c.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              {c.actor_role ? ` · por ${ROLE_LABEL[c.actor_role] ?? c.actor_role}` : ''}
              {c.released_old ? '' : ' · lugar antigo bloqueado'}
              {c.reason ? ` · ${c.reason}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SeatChangeHistory;
