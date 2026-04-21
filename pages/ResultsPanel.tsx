import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import {
  BarChart3, Download, RefreshCw, Loader2, Search,
  ChevronDown, ChevronUp, Trophy, CheckCircle2, AlertCircle,
  Volume2, FileText, AlertTriangle,
} from 'lucide-react';

/* ── Types ── */
interface ScoreDetail {
  judge: string;
  judge_id: string;
  scores: Record<string, number>;
  final: number | null;
  audio_url: string | null;
  submitted_at: string;
  audit_log: any;
}

interface GroupedResult {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  tipo_apresentacao: string;
  status: string;
  average_score: number;
  evaluations_count: number;
  scores_detail: ScoreDetail[];
  has_outlier: boolean;
}

interface MedalThresholds { gold: number; silver: number; bronze: number; }

const DEFAULT_THRESHOLDS: MedalThresholds = { gold: 9.0, silver: 8.0, bronze: 7.0 };

/* ── Helpers ── */
const getMedal = (score: number, t: MedalThresholds) => {
  if (score >= t.gold)   return { label: 'Ouro',        color: 'text-yellow-500',  bg: 'bg-yellow-50 dark:bg-yellow-500/10',  border: 'border-yellow-200 dark:border-yellow-500/30' };
  if (score >= t.silver) return { label: 'Prata',       color: 'text-slate-400',   bg: 'bg-slate-50 dark:bg-slate-800',       border: 'border-slate-300 dark:border-slate-600'      };
  if (score >= t.bronze) return { label: 'Bronze',      color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-500/10',    border: 'border-amber-200 dark:border-amber-500/30'   };
  return                        { label: 'Participação', color: 'text-slate-500',   bg: 'bg-slate-50 dark:bg-white/5',         border: 'border-slate-200 dark:border-white/10'       };
};

const scoreColor = (score: number, t: MedalThresholds) => {
  if (score >= t.gold)   return 'text-yellow-500 dark:text-yellow-400';
  if (score >= t.silver) return 'text-emerald-500 dark:text-emerald-400';
  if (score >= t.bronze) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-500 dark:text-rose-400';
};

/* ── Component ── */
const ResultsPanel = () => {
  const [allResults, setAllResults] = useState<GroupedResult[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<'competitiva' | 'avaliada'>('competitiva');
  const [filterGenre,    setFilterGenre]    = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [thresholds, setThresholds] = useState<MedalThresholds>(DEFAULT_THRESHOLDS);

  /* ── Fetch ── */
  const fetchResults = async () => {
    setLoading(true);
    try {
      const { data: cfg } = await supabase
        .from('configuracoes').select('medal_thresholds').eq('id', 1).single();
      setThresholds(cfg?.medal_thresholds ?? DEFAULT_THRESHOLDS);

      const { data: evals, error } = await supabase
        .from('evaluations')
        .select(`
          id,
          registration_id,
          final_weighted_average,
          scores,
          audio_url,
          submitted_at,
          audit_log,
          judge_id,
          judges(name),
          registrations!inner(
            id, nome_coreografia, estudio,
            estilo_danca, categoria, tipo_apresentacao, status
          )
        `)
        .order('submitted_at', { ascending: true });

      if (error) throw error;

      const grouped: Record<string, any> = {};
      (evals || []).forEach((e: any) => {
        const rid = e.registration_id;
        const reg = e.registrations;
        if (!grouped[rid]) {
          grouped[rid] = {
            id: rid,
            nome_coreografia: reg?.nome_coreografia ?? '—',
            estudio:          reg?.estudio          ?? '—',
            estilo_danca:     reg?.estilo_danca      ?? '—',
            categoria:        reg?.categoria         ?? '—',
            tipo_apresentacao: reg?.tipo_apresentacao ?? 'Competitiva',
            status:           reg?.status            ?? '—',
            scores_all:    [],
            scores_detail: [],
          };
        }
        if (e.final_weighted_average != null) {
          grouped[rid].scores_all.push(Number(e.final_weighted_average));
        }
        grouped[rid].scores_detail.push({
          judge:       e.judges?.name || e.judge_id,
          judge_id:    e.judge_id,
          scores:      e.scores || {},
          final:       e.final_weighted_average,
          audio_url:   e.audio_url,
          submitted_at: e.submitted_at,
          audit_log:   e.audit_log,
        });
      });

      const built: GroupedResult[] = Object.values(grouped).map((g: any) => {
        const avg = g.scores_all.length
          ? g.scores_all.reduce((a: number, b: number) => a + b, 0) / g.scores_all.length
          : 0;
        const hasOutlier = g.scores_all.length >= 2 &&
          (Math.max(...g.scores_all) - Math.min(...g.scores_all)) >= 2.0;
        return { ...g, average_score: avg, evaluations_count: g.scores_all.length, has_outlier: hasOutlier };
      }).sort((a: any, b: any) => b.average_score - a.average_score);

      setAllResults(built);
    } catch (err) {
      console.error('ResultsPanel error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchResults(); }, []);

  /* ── Derived lists ── */
  const competitiva = useMemo(() => allResults.filter(r => r.tipo_apresentacao !== 'Avaliada'), [allResults]);
  const avaliada    = useMemo(() => allResults.filter(r => r.tipo_apresentacao === 'Avaliada'),  [allResults]);
  const activeList  = activeTab === 'competitiva' ? competitiva : avaliada;

  const filtered = useMemo(() => {
    let res = activeList;
    if (search)         res = res.filter(r => r.nome_coreografia.toLowerCase().includes(search.toLowerCase()) || r.estudio.toLowerCase().includes(search.toLowerCase()));
    if (filterGenre)    res = res.filter(r => r.estilo_danca === filterGenre);
    if (filterCategory) res = res.filter(r => r.categoria   === filterCategory);
    return res;
  }, [activeList, search, filterGenre, filterCategory]);

  /* Competitiva grouped by genre + category (each group has its own ranking) */
  const groupedByGenreCat = useMemo(() => {
    const groups: Record<string, GroupedResult[]> = {};
    filtered.forEach(r => {
      const key = `${r.estilo_danca}|${r.categoria}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => b.average_score - a.average_score));
    return groups;
  }, [filtered]);

  const genres     = useMemo(() => [...new Set(activeList.map(r => r.estilo_danca))].filter(Boolean).sort(), [activeList]);
  const categories = useMemo(() => [...new Set(activeList.map(r => r.categoria))].filter(Boolean).sort(),   [activeList]);

  /* ── Publish: rank per genre+category ── */
  const handlePublish = async () => {
    setPublishing(true);
    try {
      for (const entries of Object.values(groupedByGenreCat)) {
        for (let i = 0; i < entries.length; i++) {
          await supabase.from('registrations').update({
            classificacao_final: i + 1,
            media_final:         entries[i].average_score,
            resultado_publicado: true,
          }).eq('id', entries[i].id);
        }
      }
      for (const r of avaliada) {
        await supabase.from('registrations').update({
          media_final: null, resultado_publicado: true,
        }).eq('id', r.id);
      }
      alert('Resultados publicados com sucesso!');
    } catch (err) {
      console.error(err);
      alert('Erro ao publicar resultados.');
    } finally {
      setPublishing(false);
    }
  };

  /* ── CSV Export ── */
  const exportCSV = () => {
    const rows: (string | number)[][] = [
      ['Posição', 'Coreografia', 'Estúdio', 'Gênero', 'Categoria', 'Tipo', 'Média', 'Nº Jurados', 'Medalha'],
    ];
    Object.entries(groupedByGenreCat).forEach(([, entries]) => {
      entries.forEach((r, i) => {
        const medal = getMedal(r.average_score, thresholds);
        rows.push([`${i + 1}°`, r.nome_coreografia, r.estudio, r.estilo_danca, r.categoria, r.tipo_apresentacao, r.average_score.toFixed(2), r.evaluations_count, medal.label]);
      });
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `resultados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  /* ── Stats ── */
  const outlierCount = competitiva.filter(r => r.has_outlier).length;
  const pendingCount = allResults.filter(r => r.evaluations_count === 0).length;
  const bestScore    = competitiva.length ? Math.max(...competitiva.map(r => r.average_score)) : 0;

  return (
    <div className="space-y-6 pb-20">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Apuração <span className="text-[#ff0068]">Final</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Ranking por gênero e categoria · Feedbacks da Mostra Avaliada
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={fetchResults} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all" title="Recarregar">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={exportCSV}
            disabled={competitiva.length === 0}
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-all disabled:opacity-40 flex items-center gap-2"
          >
            <Download size={14} /> Exportar CSV
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing || allResults.length === 0}
            className="px-5 py-3 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#d4005a] transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 flex items-center gap-2"
          >
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Publicar Resultados
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <BarChart3 size={18} className="text-[#ff0068]" />, label: 'Total Avaliadas',  value: allResults.length,              valueColor: 'text-slate-900 dark:text-white' },
          { icon: <Trophy    size={18} className="text-yellow-500" />, label: 'Melhor Média',    value: bestScore > 0 ? bestScore.toFixed(2) : '—', valueColor: 'text-yellow-500' },
          { icon: <AlertTriangle size={18} className="text-amber-500" />, label: 'Outliers',     value: outlierCount, valueColor: outlierCount > 0 ? 'text-amber-500' : 'text-slate-400' },
          { icon: <AlertCircle   size={18} className="text-rose-500"  />, label: 'Sem Avaliação', value: pendingCount, valueColor: pendingCount  > 0 ? 'text-rose-500'  : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center shadow-sm">
            <div className="flex justify-center mb-1.5">{s.icon}</div>
            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
            <p className={`text-xl font-black mt-0.5 ${s.valueColor}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Outlier global warning */}
      {outlierCount > 0 && (
        <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
            <strong>{outlierCount} coreografia{outlierCount > 1 ? 's' : ''}</strong> com divergência alta entre jurados (≥ 2,0 pontos de diferença). Verifique antes de publicar — estão marcadas com <span className="italic">Outlier</span>.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-white/10">
        {([
          { id: 'competitiva', label: `Mostra Competitiva (${competitiva.length})` },
          { id: 'avaliada',    label: `Mostra Avaliada — Feedbacks (${avaliada.length})` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setFilterGenre(''); setFilterCategory(''); setSearch(''); }}
            className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-[#ff0068] text-[#ff0068]'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
          <input
            type="text" placeholder="Buscar coreografia ou estúdio..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none focus:border-[#ff0068]/50"
          />
        </div>
        <select value={filterGenre} onChange={e => setFilterGenre(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none">
          <option value="">Todos os Gêneros</option>
          {genres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none">
          <option value="">Todas as Categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="p-16 flex flex-col items-center gap-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl">
          <Loader2 size={36} className="text-[#ff0068] animate-spin" />
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Apurando...</p>
        </div>

      ) : activeTab === 'competitiva' ? (

        /* ══ COMPETITIVA: grouped ranking per genre + category ══ */
        <div className="space-y-6">
          {Object.entries(groupedByGenreCat).length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl">
              <Trophy size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-black uppercase tracking-widest text-slate-400">Nenhum resultado encontrado</p>
            </div>
          ) : (
            Object.entries(groupedByGenreCat).map(([key, entries]) => {
              const [genre, category] = key.split('|');
              return (
                <div key={key} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-3 px-5 py-3.5 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-100 dark:border-white/10">
                    <Trophy size={14} className="text-[#ff0068] shrink-0" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
                      {genre} · {category}
                    </span>
                    <span className="ml-auto text-[8px] font-black text-slate-400 uppercase tracking-widest">
                      {entries.length} coreografia{entries.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {entries.map((entry, idx) => {
                      const medal  = getMedal(entry.average_score, thresholds);
                      const isOpen = expandedId === entry.id;
                      return (
                        <div key={entry.id}>
                          <div
                            className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                            onClick={() => setExpandedId(isOpen ? null : entry.id)}
                          >
                            {/* Position badge */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                              idx === 0 ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                              idx === 1 ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300' :
                              idx === 2 ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-500' :
                              'bg-slate-50 dark:bg-white/5 text-slate-400'
                            }`}>
                              {idx + 1}°
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                                  {entry.nome_coreografia}
                                </p>
                                {entry.has_outlier && (
                                  <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full text-[7px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                                    <AlertTriangle size={8} /> Outlier
                                  </span>
                                )}
                              </div>
                              <p className="text-[9px] text-slate-500 uppercase font-bold">
                                {entry.estudio} · {entry.evaluations_count} jurado{entry.evaluations_count !== 1 ? 's' : ''}
                              </p>
                            </div>

                            {/* Medal + Score */}
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${medal.bg} ${medal.color} ${medal.border}`}>
                                {medal.label}
                              </span>
                              <p className={`text-xl font-black italic tabular-nums ${scoreColor(entry.average_score, thresholds)}`}>
                                {entry.average_score.toFixed(2)}
                              </p>
                              {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </div>

                          {/* Expanded: scores + audit per judge */}
                          {isOpen && (
                            <div className="px-5 pb-5 pt-2 space-y-2 bg-slate-50 dark:bg-white/[0.02]">
                              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                Notas por jurado · Trilha de auditoria
                              </p>
                              {entry.scores_detail.map((sd, i) => (
                                <div key={i} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{sd.judge}</p>
                                      <p className="text-[8px] text-slate-400">
                                        {sd.submitted_at ? new Date(sd.submitted_at).toLocaleString('pt-BR') : '—'}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {sd.audio_url && (
                                        <button
                                          onClick={e => { e.stopPropagation(); new Audio(sd.audio_url!).play(); }}
                                          className="p-1.5 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 rounded-lg text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-all"
                                          title="Ouvir áudio do jurado"
                                        >
                                          <Volume2 size={12} />
                                        </button>
                                      )}
                                      <span className={`text-base font-black italic tabular-nums ${scoreColor(sd.final ?? 0, thresholds)}`}>
                                        {sd.final != null ? Number(sd.final).toFixed(2) : '—'}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Per-criterion scores */}
                                  {Object.keys(sd.scores).length > 0 && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                      {Object.entries(sd.scores).map(([k, v]) => (
                                        <span key={k} className="text-[9px] text-slate-500 dark:text-slate-400">
                                          <span className="font-bold text-slate-700 dark:text-slate-300">{k}</span>: {Number(v).toFixed(1)}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {/* Outlier alert */}
                              {entry.has_outlier && (
                                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                                  <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                  <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400">
                                    Divergência alta entre jurados (diferença ≥ 2,0 pontos). Verifique antes de publicar.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

      ) : (

        /* ══ AVALIADA: feedback list ══ */
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <FileText size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-black uppercase tracking-widest text-slate-400">Nenhum feedback registrado</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(entry => {
                const isOpen = expandedId === entry.id;
                return (
                  <div key={entry.id}>
                    <div
                      className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isOpen ? null : entry.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{entry.nome_coreografia}</p>
                        <p className="text-[9px] text-slate-500 uppercase font-bold">{entry.estudio} · {entry.categoria} · {entry.estilo_danca}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-1 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20 rounded-full text-[8px] font-black uppercase tracking-widest">
                          {entry.evaluations_count} feedback{entry.evaluations_count !== 1 ? 's' : ''}
                        </span>
                        {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="px-5 pb-5 pt-2 space-y-3 bg-slate-50 dark:bg-white/[0.02]">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-2">Feedbacks dos jurados</p>
                        {entry.scores_detail.map((sd, i) => {
                          const feedbackNote = sd.audit_log?.feedback_text;
                          return (
                            <div key={i} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{sd.judge}</p>
                                  <p className="text-[8px] text-slate-400">
                                    {sd.submitted_at ? new Date(sd.submitted_at).toLocaleString('pt-BR') : '—'}
                                  </p>
                                </div>
                                {sd.audio_url && (
                                  <button
                                    onClick={e => { e.stopPropagation(); new Audio(sd.audio_url!).play(); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 rounded-xl text-[9px] font-black text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-all"
                                  >
                                    <Volume2 size={11} /> Ouvir Áudio
                                  </button>
                                )}
                              </div>
                              {feedbackNote && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                                  {feedbackNote}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResultsPanel;
