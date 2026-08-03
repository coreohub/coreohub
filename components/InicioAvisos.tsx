import React from 'react';
import { motion } from 'framer-motion';
import { Megaphone, ListOrdered, ExternalLink, Clock } from 'lucide-react';
import type { Announcement, OrdemItem } from '../hooks/useInicioAvisos';
import { formatDataBRComDia } from '../utils/lotes';

/** Avisos manuais do produtor. Aparece perto do topo da Início — é
 *  informação operacional urgente (mudança de local, atraso), não onboarding. */
export const AvisosDoProdutor: React.FC<{ announcements: Announcement[] }> = ({ announcements }) => {
  if (announcements.length === 0) return null;
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
    </div>
  );
};

/** Card informativo da posição na fila de apresentação. Baixa urgência —
 *  fica mais abaixo na tela, não compete com Avisos nem com o Guia.
 *  `eventTime` (events.event_time, "HH:MM:SS") é âncora única — mesmo
 *  horário que já aparece no cabeçalho da vitrine pública. Não é por bloco
 *  (cronograma ao vivo atrasa), só dá noção de "a partir de quando". */
export const OrdemApresentacao: React.FC<{ items: OrdemItem[]; eventTime?: string | null }> = ({ items, eventTime }) => {
  if (items.length === 0) return null;
  return (
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
      {eventTime && (
        <div className="flex items-center gap-1.5 mb-3 text-[10px] font-bold text-slate-500 dark:text-slate-400">
          <Clock size={11} className="shrink-0" />
          A mostra começa por volta das {eventTime.slice(0, 5)} — horário pode atrasar.
        </div>
      )}
      <div className="space-y-2">
        {items.map(item => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5"
          >
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{item.nome}</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">
              {item.dia && item.ordemDia != null
                // Evento de vários dias: mostra o dia + número local do dia
                // (reinicia em 1 a cada dia), mais amigável que o número
                // global contínuo — decisão 2026-08-03.
                ? `${formatDataBRComDia(item.dia)} · Nº ${item.ordemDia}`
                : `${item.blocoNome ? `${item.blocoNome} · ` : ''}Nº ${item.ordem}`}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-400 mt-3 leading-relaxed">
        Posição pode mudar até o início do evento. Confirme sempre com a organização no dia.
      </p>
    </motion.div>
  );
};
