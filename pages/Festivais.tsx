import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Search, MapPin, Calendar, ChevronRight, Loader2, Filter, X,
  Sparkles, ArrowRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import BrandIcon from '../components/BrandIcon';
import { Event } from '../types';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT',
  'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO',
  'RR', 'SC', 'SP', 'SE', 'TO',
];

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const Festivais = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('events')
          .select('id, slug, name, description, cover_url, start_date, end_date, address, city, state, formacoes_config, edition_year, is_public')
          .eq('is_public', true)
          .order('start_date', { ascending: false });
        if (error) throw error;
        setEvents((data ?? []) as Event[]);
      } catch (err) {
        console.error('[Festivais] erro ao buscar eventos:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (search && !e.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (stateFilter && e.state !== stateFilter) return false;
      if (monthFilter !== null && e.start_date) {
        const m = new Date(e.start_date).getMonth();
        if (m !== monthFilter) return false;
      }
      return true;
    });
  }, [events, search, stateFilter, monthFilter]);

  const proximos = useMemo(() => {
    return filtered
      .filter(e => !e.start_date || e.start_date >= today)
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
  }, [filtered, today]);

  const passados = useMemo(() => {
    return filtered
      .filter(e => e.start_date && e.start_date < today)
      .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
  }, [filtered, today]);

  const clearFilters = () => {
    setSearch('');
    setStateFilter('');
    setMonthFilter(null);
  };

  const hasActiveFilters = search || stateFilter || monthFilter !== null;

  const minPrice = (e: Event): number | null => {
    if (!e.formacoes_config?.length) return null;
    const fees = e.formacoes_config
      .map((m: any) => Number(m.fee))
      .filter((n: number) => !Number.isNaN(n) && n > 0);
    if (!fees.length) return 0;
    return Math.min(...fees);
  };

  const formatDateRange = (start?: string, end?: string) => {
    if (!start) return 'Em breve';
    const d1 = new Date(start);
    const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
    const left = d1.toLocaleDateString('pt-BR', opts);
    if (!end || end === start) return left;
    const d2 = new Date(end);
    return `${left} – ${d2.toLocaleDateString('pt-BR', opts)}`;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Header simples */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#050505]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <BrandIcon size={32} />
            <span className="text-sm font-black uppercase tracking-tighter italic">
              Coreo<span className="text-[#ff0068]">Hub</span>
            </span>
          </Link>
          <button
            onClick={() => navigate('/login')}
            className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all"
          >
            Entrar
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,#ff0068,transparent)] opacity-10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_30%,#3b0764,transparent)] opacity-30" />
        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-xl mb-8">
              <Sparkles size={12} className="text-[#e3ff0a]" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#e3ff0a]">Vitrine de Festivais</span>
            </div>
            <h1 className="text-5xl lg:text-7xl font-black uppercase tracking-tighter italic leading-[0.9] mb-6">
              Encontre o<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff0068] to-[#e3ff0a]">próximo palco</span>
            </h1>
            <p className="text-slate-400 text-lg max-w-xl leading-relaxed">
              Festivais, mostras e batalhas de dança em todo o Brasil. Filtre por estado e mês, encontre o seu e inscreva-se em segundos.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Search + filtros */}
      <section className="max-w-7xl mx-auto px-6 py-8 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome do festival..."
              className="w-full pl-14 pr-5 py-4 bg-white/5 border border-white/10 rounded-2xl text-white font-medium outline-none focus:ring-2 focus:ring-[#ff0068] transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`px-5 py-4 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 ${
              showFilters || stateFilter || monthFilter !== null
                ? 'bg-[#ff0068]/10 border-[#ff0068] text-[#ff0068]'
                : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/20'
            }`}
          >
            <Filter size={14} /> Filtros
            {(stateFilter ? 1 : 0) + (monthFilter !== null ? 1 : 0) > 0 && (
              <span className="ml-1 w-5 h-5 rounded-full bg-[#ff0068] text-white text-[9px] flex items-center justify-center">
                {(stateFilter ? 1 : 0) + (monthFilter !== null ? 1 : 0)}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-5 py-4 rounded-2xl border border-white/10 bg-white/5 text-slate-400 hover:text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all"
            >
              <X size={14} /> Limpar
            </button>
          )}
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 bg-white/5 border border-white/10 rounded-3xl"
          >
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Estado (UF)</label>
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value)}
                className="w-full p-4 bg-slate-950 border border-white/10 rounded-2xl text-white font-bold outline-none focus:ring-2 focus:ring-[#ff0068]"
              >
                <option value="">Todos</option>
                {UFS.map(uf => (<option key={uf} value={uf}>{uf}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Mês</label>
              <select
                value={monthFilter ?? ''}
                onChange={e => setMonthFilter(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full p-4 bg-slate-950 border border-white/10 rounded-2xl text-white font-bold outline-none focus:ring-2 focus:ring-[#ff0068]"
              >
                <option value="">Qualquer mês</option>
                {MESES.map((m, i) => (<option key={i} value={i}>{m}</option>))}
              </select>
            </div>
          </motion.div>
        )}
      </section>

      {/* Conteudo */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="text-[#ff0068] animate-spin" size={36} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 space-y-4">
            <div className="inline-flex w-16 h-16 rounded-3xl bg-white/5 items-center justify-center">
              <Search size={28} className="text-slate-600" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tighter">Nenhum festival encontrado</h3>
            <p className="text-slate-500 text-sm">
              {hasActiveFilters
                ? 'Tente ajustar os filtros ou limpar a busca.'
                : 'Em breve novos festivais por aqui.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 px-6 py-3 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-16">
            {proximos.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-end justify-between">
                  <h2 className="text-3xl font-black uppercase tracking-tighter">
                    Próximos <span className="text-[#ff0068]">eventos</span>
                  </h2>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{proximos.length} {proximos.length === 1 ? 'festival' : 'festivais'}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {proximos.map(event => (
                    <EventCard key={event.id} event={event} minPrice={minPrice(event)} dateLabel={formatDateRange(event.start_date, event.end_date)} />
                  ))}
                </div>
              </div>
            )}

            {passados.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-end justify-between">
                  <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-400">
                    Edições <span className="text-slate-600">passadas</span>
                  </h2>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{passados.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {passados.map(event => (
                    <EventCard key={event.id} event={event} minPrice={minPrice(event)} dateLabel={formatDateRange(event.start_date, event.end_date)} muted />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* CTA inferior pra produtores */}
      <section className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="bg-gradient-to-r from-[#ff0068]/10 via-transparent to-[#e3ff0a]/5 border border-white/10 rounded-[3rem] p-10 lg:p-14 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
            <div className="max-w-xl">
              <h3 className="text-3xl lg:text-4xl font-black uppercase tracking-tighter italic mb-3">
                Você produz festivais?
              </h3>
              <p className="text-slate-400 leading-relaxed">
                Anuncie seu próximo festival na CoreoHub. Inscrições, pagamentos com split automático, jurados, lives e certificados — tudo num só lugar.
              </p>
            </div>
            <Link
              to="/login"
              className="px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] flex items-center gap-2 hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/30 whitespace-nowrap"
            >
              Cadastrar meu festival <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

const EventCard: React.FC<{
  event: Event;
  minPrice: number | null;
  dateLabel: string;
  muted?: boolean;
}> = ({ event, minPrice, dateLabel, muted }) => {
  const localizacao = [event.city, event.state].filter(Boolean).join(' / ') || event.address;
  const target = `/evento/${event.slug ?? event.id}`;

  return (
    <Link
      to={target}
      className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 hover:border-[#ff0068]/40 transition-all flex flex-col ${muted ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
        {event.cover_url ? (
          <img
            src={event.cover_url}
            alt={event.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#ff0068]/20 via-purple-900/20 to-slate-900 flex items-center justify-center">
            <BrandIcon size={48} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute top-4 left-4 flex gap-2">
          {event.edition_year && (
            <span className="px-3 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-[9px] font-black uppercase tracking-widest">
              Edição {event.edition_year}
            </span>
          )}
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#ff0068]/90 backdrop-blur rounded-full">
            <Calendar size={12} />
            <span className="text-[10px] font-black uppercase tracking-widest">{dateLabel}</span>
          </div>
        </div>
      </div>
      <div className="p-6 flex-1 flex flex-col">
        <h3 className="text-lg font-black uppercase tracking-tighter line-clamp-2 mb-2 group-hover:text-[#ff0068] transition-colors">
          {event.name}
        </h3>
        {localizacao && (
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-4">
            <MapPin size={12} className="text-[#ff0068] shrink-0" />
            <span className="truncate">{localizacao}</span>
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            {minPrice === null
              ? 'Inscrições em breve'
              : minPrice === 0
              ? 'Inscrição gratuita'
              : `A partir de R$ ${minPrice.toFixed(2)}`}
          </span>
          <ChevronRight size={16} className="text-[#ff0068] group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
};

export default Festivais;
