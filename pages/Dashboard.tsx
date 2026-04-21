import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Music2, Plus, CreditCard, ChevronRight,
  MapPin, Calendar, Clock, Clapperboard, AlertTriangle,
  CheckCircle2, Upload,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Profile as UserProfile, UserRole } from '../types';
import { supabase } from '../services/supabase';
import GuiaDeInscricao from '../components/GuiaDeInscricao';

const INSCRITO_ROLES = new Set([
  UserRole.STUDIO_DIRECTOR,
  UserRole.CHOREOGRAPHER,
  UserRole.INDEPENDENT,
  UserRole.USER,
  UserRole.SPECTATOR,
]);

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) => {
  if (!d) return null;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const daysUntil = (d?: string): number | null => {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  RASCUNHO:             { label: 'Rascunho',          color: 'bg-slate-100 dark:bg-white/10 text-slate-500' },
  AGUARDANDO_PAGAMENTO: { label: 'Ag. Pagamento',      color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  INSCRITA:             { label: 'Inscrita',           color: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
  PAGO:                 { label: 'Pago',               color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  CANCELADA:            { label: 'Cancelada',          color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400' },
};

// ── Componente principal ──────────────────────────────────────────────────────
const Dashboard = ({ profile, config, activeRole }: { profile: UserProfile; config: any; activeRole: UserRole }) => {
  const navigate = useNavigate();
  const [coreografias, setCoreografias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const isInscrito = INSCRITO_ROLES.has(activeRole);

  useEffect(() => {
    const fetchCoreografias = async () => {
      const { data } = await supabase
        .from('coreografias')
        .select('id, nome, status, trilha_url, modalidade, categoria_nome, estilo_nome')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      if (data) setCoreografias(data);
      setLoading(false);
    };
    fetchCoreografias();
  }, [profile.id]);

  // ── Métricas reais ────────────────────────────────────────────────────────
  const total      = coreografias.length;
  const comTrilha  = coreografias.filter(c => c.trilha_url).length;
  const pagas      = coreografias.filter(c => c.status === 'PAGO').length;
  const pendentes  = coreografias.filter(c => c.status === 'AGUARDANDO_PAGAMENTO').length;

  const statusGeral = total === 0
    ? { label: 'Sem inscrições', color: 'text-slate-400' }
    : pendentes > 0
      ? { label: 'Pendências', color: 'text-amber-500' }
      : pagas === total
        ? { label: 'Em dia', color: 'text-emerald-500' }
        : { label: 'Em andamento', color: 'text-[#ff0068]' };

  // ── Prazo de inscrição ────────────────────────────────────────────────────
  const deadlineDays = daysUntil(config?.registration_deadline);

  return (
    <div className="space-y-5 animate-in fade-in duration-700">

      {/* ── Cabeçalho ── */}
      <div className="flex justify-between items-center">
        <div>
          <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">
            {config?.nome_evento || 'Festival Ativo'}
          </span>
          <h1 className="text-2xl font-black tracking-tighter uppercase">
            Olá, {profile.full_name?.split(' ')[0]}
          </h1>
        </div>
        <button
          onClick={() => navigate('/minhas-coreografias')}
          className="bg-[#ff0068] text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 hover:scale-105 transition-all flex items-center gap-2"
        >
          <Plus size={14} /> Nova Inscrição
        </button>
      </div>

      {/* ── Guia de Inscrição (apenas inscritos) ── */}
      {isInscrito && (
        <GuiaDeInscricao profile={profile} config={config} />
      )}

      {/* ── Card do Evento ── */}
      {(config?.nome_evento || config?.data_evento || config?.endereco) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden"
        >
          <div className="flex flex-col md:flex-row">
            {/* Capa do evento */}
            {config?.cover_url && (
              <div className="w-full md:w-48 h-28 md:h-auto shrink-0 overflow-hidden">
                <img
                  src={config.cover_url}
                  alt={config.nome_evento}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="p-5 flex flex-col justify-center gap-3 flex-1">
              <div>
                <span className="text-[8px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Evento Ativo</span>
                <h2 className="text-base font-black uppercase tracking-tighter text-slate-900 dark:text-white leading-tight">
                  {config.nome_evento}
                </h2>
              </div>
              <div className="flex flex-wrap gap-4">
                {config?.data_evento && (
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    <Calendar size={12} className="text-[#ff0068]" />
                    {fmtDate(config.data_evento)}
                  </span>
                )}
                {config?.endereco && (
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    <MapPin size={12} className="text-[#ff0068]" />
                    {config.endereco}
                  </span>
                )}
                {deadlineDays !== null && (
                  <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${
                    deadlineDays < 0  ? 'text-slate-400' :
                    deadlineDays <= 3 ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    <Clock size={12} className={deadlineDays <= 3 && deadlineDays >= 0 ? 'text-amber-500' : 'text-[#ff0068]'} />
                    {deadlineDays < 0
                      ? 'Inscrições encerradas'
                      : deadlineDays === 0
                        ? 'Último dia de inscrição!'
                        : `Inscrições: ${deadlineDays}d restantes`}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 3 Cards de resumo ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Coreografias */}
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-white dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-white/5 cursor-pointer hover:border-[#ff0068]/30 transition-all group"
          onClick={() => navigate('/minhas-coreografias')}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl">
              <Clapperboard size={18} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest">Coreografias</h3>
          </div>
          <p className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{total}</p>
          <span className="text-[8px] font-bold text-slate-400 uppercase">
            {total === 0 ? 'Nenhuma inscrita' : `${pendentes > 0 ? `${pendentes} ag. pagamento` : 'Todas em dia'}`}
          </span>
        </motion.div>

        {/* Trilhas */}
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-white dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-white/5 cursor-pointer hover:border-[#ff0068]/30 transition-all group"
          onClick={() => navigate('/central-de-midia')}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-violet-500/10 text-violet-500 rounded-xl">
              <Upload size={18} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest">Trilhas</h3>
          </div>
          <p className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">
            {comTrilha}<span className="text-slate-300 dark:text-slate-600">/{total}</span>
          </p>
          <span className="text-[8px] font-bold text-slate-400 uppercase">
            {total === 0 ? 'Sem coreografias' : comTrilha === total ? 'Todas enviadas' : `${total - comTrilha} pendente${total - comTrilha !== 1 ? 's' : ''}`}
          </span>
        </motion.div>

        {/* Status geral */}
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-white dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-white/5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <Trophy size={18} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest">Status</h3>
          </div>
          <p className={`text-2xl font-black tracking-tighter ${statusGeral.color}`}>
            {statusGeral.label}
          </p>
          <span className="text-[8px] font-bold text-slate-400 uppercase">
            {total === 0 ? 'Inscreva sua primeira coreografia' : `${pagas}/${total} confirmada${pagas !== 1 ? 's' : ''}`}
          </span>
        </motion.div>
      </div>

      {/* ── Lista de Coreografias (dados reais) ── */}
      <div className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex justify-between items-center">
          <h2 className="text-sm font-black uppercase tracking-widest">Minhas Coreografias</h2>
          <button
            onClick={() => navigate('/minhas-coreografias')}
            className="text-[9px] font-black text-[#ff0068] uppercase tracking-widest hover:underline"
          >
            Ver Todas
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-slate-100 dark:divide-white/5 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-6 py-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-white/10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-40 bg-slate-200 dark:bg-white/10 rounded-full" />
                  <div className="h-2.5 w-28 bg-slate-200 dark:bg-white/10 rounded-full" />
                </div>
                <div className="h-5 w-16 bg-slate-200 dark:bg-white/10 rounded-full" />
              </div>
            ))}
          </div>
        ) : coreografias.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
              <Clapperboard size={22} className="text-slate-400" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Nenhuma coreografia inscrita</p>
              <p className="text-[9px] font-bold text-slate-400 mt-1">Use o guia acima para começar</p>
            </div>
            <button
              onClick={() => navigate('/minhas-coreografias')}
              className="mt-1 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-[#ff0068]/20 hover:scale-105 transition-all"
            >
              <Plus size={13} className="inline mr-1.5" /> Inscrever Coreografia
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {coreografias.slice(0, 5).map((coreo) => {
              const st = STATUS_LABEL[coreo.status] || STATUS_LABEL.RASCUNHO;
              return (
                <div
                  key={coreo.id}
                  onClick={() => navigate('/minhas-coreografias')}
                  className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center shrink-0">
                      <Music2 size={14} className="text-[#ff0068]" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black uppercase tracking-tight text-sm text-slate-900 dark:text-white truncate">
                        {coreo.nome}
                      </p>
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest truncate">
                        {[coreo.modalidade, coreo.categoria_nome, coreo.estilo_nome].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Badge trilha */}
                    <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest ${
                      coreo.trilha_url
                        ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    }`}>
                      {coreo.trilha_url ? <CheckCircle2 size={8} className="inline mr-1" /> : <AlertTriangle size={8} className="inline mr-1" />}
                      {coreo.trilha_url ? 'Áudio OK' : 'Sem Áudio'}
                    </span>
                    {/* Badge status */}
                    <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest ${st.color}`}>
                      {st.label}
                    </span>
                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
                  </div>
                </div>
              );
            })}
            {coreografias.length > 5 && (
              <div
                onClick={() => navigate('/minhas-coreografias')}
                className="px-6 py-3 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] cursor-pointer transition-colors"
              >
                + {coreografias.length - 5} mais coreografia{coreografias.length - 5 !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
