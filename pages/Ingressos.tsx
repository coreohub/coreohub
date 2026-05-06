import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Calendar, MapPin, ChevronRight, Loader2, Search, ExternalLink, Info } from 'lucide-react';
import { supabase } from '../services/supabase';

interface EventSummary {
  id: string;
  name: string;
  start_date?: string | null;
  location?: string | null;
  url_ingressos?: string | null;
  politica_ingressos?: 'NAO_DEFINIDO' | 'GRATUITO' | 'INTERNO' | 'EXTERNO' | null;
  audience_sales_enabled?: boolean | null;
}

const formatDateBR = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })}`;
};

const Ingressos: React.FC = () => {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Q12 fix: descopular de registrations. Antes, lista só vinha pra quem
        // já era inscrito como competidor — SPECTATOR nunca via nada.
        // Agora: lista TODOS eventos com venda aberta (INTERNO ou EXTERNO),
        // independente do user ter coreografia inscrita.
        const [{ data: evs, error: evErr }, { data: cfgs }] = await Promise.all([
          supabase
            .from('events')
            .select('id,name,start_date,location,politica_ingressos,audience_sales_enabled')
            .in('politica_ingressos', ['INTERNO', 'EXTERNO'])
            .order('start_date', { ascending: true }),
          supabase.from('configuracoes').select('event_id,url_ingressos'),
        ]);
        if (evErr) throw evErr;

        const cfgByEvent = new Map((cfgs ?? []).map((c: any) => [c.event_id, c]));
        const merged: EventSummary[] = (evs ?? [])
          .map((e: any) => ({
            ...e,
            url_ingressos: cfgByEvent.get(e.id)?.url_ingressos ?? null,
          }))
          // Filtra: INTERNO precisa de audience_sales_enabled OU EXTERNO precisa de url_ingressos
          .filter((e: EventSummary) => {
            if (e.politica_ingressos === 'INTERNO') return e.audience_sales_enabled === true;
            if (e.politica_ingressos === 'EXTERNO') return !!e.url_ingressos;
            return false;
          });

        setEvents(merged);
      } catch (e: any) {
        setError(e.message ?? 'Erro ao carregar eventos.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[#ff0068] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center space-y-2">
        <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
          Comprar <span className="text-[#ff0068]">Ingresso</span>
        </h1>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
          Festivais com vendas abertas pra plateia
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-10 text-center space-y-5">
          <div className="w-16 h-16 mx-auto bg-[#ff0068]/10 rounded-2xl flex items-center justify-center text-[#ff0068]">
            <Ticket size={32} strokeWidth={1.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
              Nenhum festival com ingressos abertos
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              Quando algum festival abrir vendas de ingresso pra plateia, ele vai aparecer aqui.
            </p>
          </div>
          <Link
            to="/festivais"
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all"
          >
            <Search size={14} /> Ver todos os festivais
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => {
            const dateLabel = formatDateBR(ev.start_date);
            const internalSale = ev.politica_ingressos === 'INTERNO' && ev.audience_sales_enabled === true;
            const externalSale = ev.politica_ingressos === 'EXTERNO' && !!ev.url_ingressos;
            return (
              <div
                key={ev.id}
                className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 hover:border-[#ff0068]/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{ev.name}</h3>
                    {dateLabel && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                        <Calendar size={12} /> {dateLabel}
                      </p>
                    )}
                    {ev.location && (
                      <p className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
                        <MapPin size={12} /> {ev.location}
                      </p>
                    )}
                  </div>
                  {internalSale ? (
                    <Link
                      to={`/festival/${ev.id}`}
                      className="shrink-0 inline-flex items-center gap-1 px-4 py-2.5 bg-[#ff0068] text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all"
                    >
                      Comprar <ChevronRight size={14} />
                    </Link>
                  ) : externalSale ? (
                    <a
                      href={ev.url_ingressos!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 px-4 py-2.5 border border-slate-300 dark:border-white/20 text-slate-700 dark:text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
                    >
                      Comprar <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="shrink-0 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 border border-dashed border-slate-300 dark:border-white/10 rounded-xl">
                      Em breve
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 mt-4">
            <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-widest leading-relaxed">
              Crianças até 5 anos não pagam. Estudantes e idosos têm direito a meia-entrada
              mediante apresentação de documento.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Ingressos;
