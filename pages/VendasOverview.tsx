/**
 * VendasOverview — tab "Visão Geral" do hub de Vendas.
 *
 * Resumo de receita agregada das 4 fontes que geram dinheiro no evento
 * (Inscrições, Ingressos, Workshops, Seletiva de vídeo) + total geral.
 * Padrão Stripe Dashboard / Sympla Painel de Vendas: 1 tela de cards no
 * topo do hub, cada card aponta pra aba detalhada correspondente.
 *
 * Cálculo client-side (datasets pequenos, mesmo padrão da Análise
 * Financeira em Registrations.tsx). RLS já filtra por dono do evento.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Ticket, GraduationCap, Video, Loader2, ArrowRight, TrendingUp } from 'lucide-react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import { isRegistrationPaid } from '../utils/registrationStatus';
import VendasTabs from '../components/VendasTabs';

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);

interface SourceMetric {
  key: string;
  label: string;
  path: string;
  icon: React.ElementType;
  receita: number;
  count: number;
  countLabel: string;
}

const VendasOverview: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [eventName, setEventName] = useState('');
  const [metrics, setMetrics] = useState<SourceMetric[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const eventId = await resolveActiveEventId();
        if (!eventId) { if (active) { setErr('Nenhum evento ativo encontrado.'); setLoading(false); } return; }

        const [
          { data: ev },
          { data: regs },
          { data: tickets },
          { data: workshops },
        ] = await Promise.all([
          supabase.from('events').select('name, video_selection_fee').eq('id', eventId).maybeSingle(),
          supabase.from('registrations')
            .select('valor_pago, valor_total, charged_amount, mod_fee, status_pagamento, video_fee_status')
            .eq('event_id', eventId),
          supabase.from('audience_tickets').select('preco, status_pagamento').eq('event_id', eventId),
          supabase.from('workshops').select('id').eq('event_id', eventId),
        ]);

        const workshopIds = (workshops ?? []).map(w => w.id);
        const { data: workshopRegs } = workshopIds.length > 0
          ? await supabase.from('workshop_registrations')
              .select('preco_pago, status_pagamento')
              .in('workshop_id', workshopIds)
          : { data: [] as any[] };

        const valorDe = (r: any) => Number(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? r.mod_fee ?? 0) || 0;

        const regsPagas = (regs ?? []).filter(r => isRegistrationPaid(r.status_pagamento));
        const inscricoesReceita = regsPagas.reduce((s, r) => s + valorDe(r), 0);

        const ticketsAprovados = (tickets ?? []).filter(t => t.status_pagamento === 'APROVADO');
        const ingressosReceita = ticketsAprovados.reduce((s, t) => s + Number(t.preco ?? 0), 0);

        const workshopRegsAprovados = (workshopRegs ?? []).filter((w: any) => w.status_pagamento === 'APROVADO');
        const workshopsReceita = workshopRegsAprovados.reduce((s: number, w: any) => s + Number(w.preco_pago ?? 0), 0);

        const seletivaCount = (regs ?? []).filter(r => r.video_fee_status === 'paid').length;
        const seletivaReceita = seletivaCount * Number(ev?.video_selection_fee ?? 0);

        if (!active) return;
        setEventName(ev?.name ?? '');
        setMetrics([
          { key: 'inscricoes', label: 'Inscrições', path: '/registrations',       icon: ClipboardList, receita: inscricoesReceita, count: regsPagas.length,            countLabel: 'inscrições pagas' },
          { key: 'ingressos',  label: 'Ingressos',  path: '/vendas-ingressos',    icon: Ticket,        receita: ingressosReceita,  count: ticketsAprovados.length,     countLabel: 'ingressos vendidos' },
          { key: 'workshops',  label: 'Workshops',  path: '/workshops-do-evento', icon: GraduationCap, receita: workshopsReceita,  count: workshopRegsAprovados.length, countLabel: 'vagas vendidas' },
          { key: 'seletiva',   label: 'Seletiva',   path: '/seletiva-video',      icon: Video,         receita: seletivaReceita,   count: seletivaCount,                countLabel: 'taxas pagas' },
        ]);
      } catch (e: any) {
        if (active) setErr(e.message ?? String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const totalGeral = useMemo(
    () => (metrics ?? []).reduce((s, m) => s + m.receita, 0),
    [metrics]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-700 pb-20">
      <VendasTabs />
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Visão Geral</h1>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
          {eventName ? `Receita consolidada · ${eventName}` : 'Receita consolidada de todas as fontes'}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : err ? (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-2xl p-4 text-sm font-bold">
          {err}
        </div>
      ) : (
        <>
          {/* Card de total geral */}
          <div className="bg-slate-900 dark:bg-white/5 border border-slate-800 dark:border-white/10 rounded-3xl p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full animate-pulse shadow-[0_0_8px_#ff0068]" />
                <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Total geral</span>
              </div>
              <div className="text-3xl md:text-4xl font-black text-white tracking-tighter">{formatBRL(totalGeral)}</div>
              <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Soma de todas as fontes de receita</p>
            </div>
            <TrendingUp size={40} className="text-[#ff0068]/40" />
          </div>

          {/* Cards por fonte */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(metrics ?? []).map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => navigate(m.path)}
                  className="text-left bg-slate-100 dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-white/5 hover:border-[#ff0068]/30 transition-all group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 rounded-xl border bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/20">
                      <Icon size={18} />
                    </div>
                    <ArrowRight size={14} className="text-slate-400 group-hover:text-[#ff0068] group-hover:translate-x-0.5 transition-all mt-1" />
                  </div>
                  <h3 className="text-slate-500 text-[8px] font-black uppercase tracking-[0.2em]">{m.label}</h3>
                  <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">{formatBRL(m.receita)}</div>
                  <p className="text-[9px] text-slate-500 font-medium">{m.count} {m.countLabel}</p>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default VendasOverview;
