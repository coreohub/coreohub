import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { Trophy, Medal, Search, RefreshCw, Loader2, Star } from 'lucide-react';
import { motion } from 'motion/react';
import BrandIcon from '../components/BrandIcon';

interface LeaderboardEntry {
  registration_id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  average_score: number;
  evaluations_count: number;
  rank: number;
}

const MedalIcon = ({ rank }: { rank: number }) => {
  if (rank === 1) return <Trophy size={20} className="text-yellow-400" />;
  if (rank === 2) return <Medal size={20} className="text-slate-300" />;
  if (rank === 3) return <Medal size={20} className="text-amber-600" />;
  return <span className="text-sm font-black text-slate-500 w-5 text-center">{rank}</span>;
};

const Leaderboard = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [filtered, setFiltered] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [eventName, setEventName] = useState('');

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      // Busca avaliações com média por inscrição
      const { data: evals, error } = await supabase
        .from('evaluations')
        .select(`
          registration_id,
          final_weighted_average,
          registrations!inner(
            nome_coreografia,
            estudio,
            estilo_danca,
            categoria,
            status,
            event_id
          )
        `)
        .not('registrations.event_id', 'is', null);

      if (error) throw error;

      // Filtra pelo evento se tiver ID
      const relevantEvals = eventId
        ? (evals || []).filter((e: any) => e.registrations?.event_id === eventId)
        : (evals || []);

      // Agrega médias por registration_id
      const grouped: Record<string, any> = {};
      relevantEvals.forEach((e: any) => {
        const rid = e.registration_id;
        if (!grouped[rid]) {
          grouped[rid] = {
            registration_id: rid,
            nome_coreografia: e.registrations?.nome_coreografia || '—',
            estudio: e.registrations?.estudio || '—',
            estilo_danca: e.registrations?.estilo_danca || '—',
            categoria: e.registrations?.categoria || '—',
            scores: [],
          };
        }
        if (e.final_weighted_average != null) {
          grouped[rid].scores.push(Number(e.final_weighted_average));
        }
      });

      const result: LeaderboardEntry[] = Object.values(grouped)
        .map((g: any) => ({
          ...g,
          average_score: g.scores.length > 0
            ? g.scores.reduce((a: number, b: number) => a + b, 0) / g.scores.length
            : 0,
          evaluations_count: g.scores.length,
        }))
        .sort((a, b) => b.average_score - a.average_score)
        .map((e, i) => ({ ...e, rank: i + 1 }));

      setEntries(result);
      setFiltered(result);

      const cats = [...new Set(result.map(r => r.categoria))].filter(Boolean);
      const sts = [...new Set(result.map(r => r.estilo_danca))].filter(Boolean);
      setCategories(cats);
      setStyles(sts);

      // Nome do evento
      if (eventId) {
        const { data: ev } = await supabase.from('events').select('name').eq('id', eventId).single();
        if (ev) setEventName(ev.name);
      }
    } catch (err) {
      console.error('Leaderboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeaderboard(); }, [eventId]);

  useEffect(() => {
    let result = entries;
    if (search) result = result.filter(e =>
      e.nome_coreografia.toLowerCase().includes(search.toLowerCase()) ||
      e.estudio.toLowerCase().includes(search.toLowerCase())
    );
    if (filterCategory) result = result.filter(e => e.categoria === filterCategory);
    if (filterStyle) result = result.filter(e => e.estilo_danca === filterStyle);
    setFiltered(result);
  }, [search, filterCategory, filterStyle, entries]);

  const scoreColor = (score: number) => {
    if (score >= 9) return 'text-emerald-400';
    if (score >= 7) return 'text-yellow-400';
    if (score >= 5) return 'text-amber-500';
    return 'text-rose-500';
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-black/40 backdrop-blur-xl p-6 lg:p-8 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <BrandIcon size={28} />
            <div>
              <p className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.4em]">Resultados Oficiais</p>
              <h1 className="text-2xl font-black uppercase tracking-tighter italic">
                {eventName || 'CoreoHub'}
              </h1>
            </div>
          </div>
          <button onClick={fetchLeaderboard} className="p-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-all">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              placeholder="Buscar coreografia ou estúdio..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-[#ff0068]/50"
            />
          </div>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none"
          >
            <option value="">Todas as Categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterStyle}
            onChange={e => setFilterStyle(e.target.value)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none"
          >
            <option value="">Todos os Estilos</option>
            {styles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Podium Top 3 */}
        {!loading && filtered.length >= 3 && (
          <div className="grid grid-cols-3 gap-4">
            {[filtered[1], filtered[0], filtered[2]].map((entry, i) => {
              const podiumRank = [2, 1, 3][i];
              const heights = ['h-28', 'h-40', 'h-24'];
              const colors = ['bg-slate-600', 'bg-yellow-500', 'bg-amber-700'];
              return (
                <motion.div
                  key={entry.registration_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex flex-col items-center gap-3 text-center"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
                    <MedalIcon rank={podiumRank} />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-tight leading-tight">{entry.nome_coreografia}</p>
                    <p className="text-[9px] text-slate-500 uppercase">{entry.estudio}</p>
                    <p className={`text-2xl font-black italic mt-1 ${scoreColor(entry.average_score)}`}>
                      {entry.average_score.toFixed(2)}
                    </p>
                  </div>
                  <div className={`w-full ${heights[i]} ${colors[i]} rounded-t-2xl opacity-30`} />
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Full Table */}
        <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-white/10 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Classificação Completa
            </span>
            <span className="text-[10px] font-black text-[#ff0068] uppercase">{filtered.length} inscrições</span>
          </div>

          {loading ? (
            <div className="p-16 flex flex-col items-center gap-4">
              <Loader2 size={40} className="text-[#ff0068] animate-spin" />
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Calculando ranking...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <Star size={40} className="text-slate-700 mx-auto mb-4" />
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nenhuma avaliação registrada</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((entry, idx) => (
                <motion.div
                  key={entry.registration_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors"
                >
                  <div className="w-8 flex justify-center">
                    <MedalIcon rank={entry.rank} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase tracking-tight truncate">{entry.nome_coreografia}</p>
                    <p className="text-[9px] text-slate-500 uppercase font-bold">{entry.estudio}</p>
                  </div>
                  <div className="hidden md:flex gap-3">
                    <span className="px-2 py-1 bg-white/5 rounded-lg text-[8px] font-black uppercase text-slate-400">{entry.categoria}</span>
                    <span className="px-2 py-1 bg-white/5 rounded-lg text-[8px] font-black uppercase text-slate-400">{entry.estilo_danca}</span>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-black italic tracking-tighter ${scoreColor(entry.average_score)}`}>
                      {entry.average_score.toFixed(2)}
                    </p>
                    <p className="text-[8px] font-black text-slate-600 uppercase">{entry.evaluations_count} jurados</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;
