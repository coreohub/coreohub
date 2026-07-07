import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, ListOrdered, ExternalLink } from 'lucide-react';
import { supabase } from '../services/supabase';

interface Props {
  eventId?: string | null;
  userId: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  expires_at: string | null;
}

interface OrdemItem {
  id: string;
  nome: string;
  ordem: number | null;
  blocoNome: string | null;
}

/**
 * Seção "Avisos + Ordem de apresentação" da Início do inscrito.
 * Puramente informativa — carrega 1x no mount, sem realtime (decisão
 * 2026-07-07: ordem de apresentação não precisa refletir mudança ao vivo,
 * o Cronograma/Terminal do dia é quem serve isso em tempo real).
 */
const InicioAvisos: React.FC<Props> = ({ eventId, userId }) => {
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
          .select('id, nome_coreografia, ordem_apresentacao, bloco_id')
          .eq('event_id', eventId)
          .eq('user_id', userId)
          .not('ordem_apresentacao', 'is', null)
          .order('ordem_apresentacao', { ascending: true }),
      ]);

      setAnnouncements((avisos ?? []).filter(a => !a.expires_at || a.expires_at >= nowIso));

      if (regs && regs.length > 0) {
        const blocoIds = [...new Set(regs.map(r => r.bloco_id).filter(Boolean))] as string[];
        let blocosMap: Record<string, string> = {};
        if (blocoIds.length > 0) {
          const { data: blocos } = await supabase.from('cronograma_blocos').select('id, name').in('id', blocoIds);
          blocosMap = Object.fromEntries((blocos ?? []).map(b => [b.id, b.name]));
        }
        setOrdemItems(regs.map(r => ({
          id: r.id,
          nome: r.nome_coreografia,
          ordem: r.ordem_apresentacao,
          blocoNome: r.bloco_id ? blocosMap[r.bloco_id] ?? null : null,
        })));
      } else {
        setOrdemItems([]);
      }
      setLoading(false);
    })();
  }, [eventId, userId]);

  if (loading || (announcements.length === 0 && ordemItems.length === 0)) return null;

  return (
    <div className="space-y-3">
      {announcements.map(a => (
        <motion.div
          key={a.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl p-4 flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-xl bg-[#ff0068]/15 text-[#ff0068] flex items-center justify-center shrink-0">
            <Megaphone size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Aviso do produtor</p>
            <h3 className="font-black text-sm text-slate-900 dark:text-white mt-0.5">{a.title}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{a.body}</p>
            {a.cta_label && a.cta_url && (
              <a
                href={a.cta_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-[10px] font-black text-[#ff0068] uppercase tracking-widest hover:underline"
              >
                {a.cta_label} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </motion.div>
      ))}

      {ordemItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5 p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 flex items-center justify-center shrink-0">
              <ListOrdered size={16} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Informativo</p>
              <h3 className="font-black text-sm text-slate-900 dark:text-white">Ordem de apresentação</h3>
            </div>
          </div>
          <div className="space-y-2">
            {ordemItems.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5"
              >
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{item.nome}</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">
                  {item.blocoNome ? `${item.blocoNome} · ` : ''}Nº {item.ordem}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-400 mt-3 leading-relaxed">
            Posição pode mudar até o início do evento. Confirme sempre com a organização no dia.
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default InicioAvisos;
