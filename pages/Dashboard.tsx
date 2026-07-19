import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Music2, Plus, CreditCard, ChevronRight,
  MapPin, Calendar, Clock, Clapperboard, AlertTriangle,
  CheckCircle2, Upload, Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Profile as UserProfile, UserRole } from '../types';
import { supabase } from '../services/supabase';
import GuiaDeInscricao from '../components/GuiaDeInscricao';
import { AvisosDoProdutor, OrdemApresentacao } from '../components/InicioAvisos';
import { useInicioAvisos } from '../hooks/useInicioAvisos';
import {
  hasIncompleteBailarinos,
  collectAllBailarinosIds,
  type ElencoById,
  type ElencoRow,
} from '../utils/bailarinos';
import {
  isRegistrationPaid,
  isRegistrationPending,
  registrationDisplayKey,
} from '../utils/registrationStatus';
import { isEquipeOperacional, isEquipeAtiva, resolveFirstEquipeRoute, resolveEquipeMenuItems } from '../utils/permMenu';

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
// Keyed pela chave derivada de status_pagamento (registrationDisplayKey).
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDENTE:         { label: 'Ag. Pagamento', color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  PAGO:             { label: 'Pago',          color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  VENCIDO:          { label: 'Vencida',       color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  ESTORNADO:        { label: 'Estornada',     color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  AGUARDANDO_VIDEO: { label: 'Em análise',    color: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
};

// ── Componente principal ──────────────────────────────────────────────────────
const Dashboard = ({ profile, config, activeRole }: { profile: UserProfile; config: any; activeRole: UserRole }) => {
  const navigate = useNavigate();
  const [coreografias, setCoreografias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // UX#12: erro silencioso virou erro visível.
  const [error, setError] = useState<string | null>(null);
  // Map de rows da tabela `elenco` referenciadas pelas inscrições do inscrito.
  // RLS `inscrito_own_elenco` (user_id = auth.uid) cobre — sem migration extra.
  const [elencoById, setElencoById] = useState<ElencoById>({});
  const isInscrito = INSCRITO_ROLES.has(activeRole);

  useEffect(() => {
    const fetchCoreografias = async () => {
      setError(null);
      const { data, error: err } = await supabase
        .from('registrations')
        .select('id, event_id, status, status_pagamento, trilha_url, nome:nome_coreografia, formacao:formato_participacao, formato_participacao, categoria_nome:categoria, estilo_nome:estilo_danca, bailarinos_detalhes')
        .eq('user_id', profile.id)
        .order('criado_em', { ascending: false });
      if (err) setError('Não foi possível carregar suas inscrições. Recarregue a página em instantes.');
      if (data) {
        setCoreografias(data);
        // Hidrata elenco em batch. Fonte de verdade dos dados pessoais
        // (CPF/data/nome) — o JSONB `bailarinos_detalhes` só tem id+nome+@.
        const allIds = collectAllBailarinosIds(data);
        if (allIds.length > 0) {
          const { data: elenco } = await supabase
            .from('elenco')
            .select('id, nome, cpf, data_nascimento')
            .in('id', allIds);
          const map: ElencoById = Object.fromEntries(
            (elenco ?? []).map((e: ElencoRow) => [e.id, e])
          );
          setElencoById(map);
        }
      }
      setLoading(false);
    };
    fetchCoreografias();
  }, [profile.id]);

  // Evento ativo do inscrito: deriva das próprias inscrições (fonte confiável),
  // não da `config` global — essa cai na row legacy `id='1'` pra quem não é
  // produtor, e o `event_id` dessa row não necessariamente bate com o evento
  // real da inscrição do usuário (achado durante QA de 2026-07-07). Fallback
  // pra config.event_id só serve quem ainda não tem nenhuma inscrição.
  // Só resolve depois que `coreografias` terminou de carregar — evita disparar
  // a busca de avisos/ordem com o fallback legacy (config.event_id, não
  // confiável) enquanto o fetch real ainda está em andamento, e depois
  // re-disparar de novo com o evento certo (race visível em QA 2026-07-07).
  const inscritoEventId = loading ? null : (coreografias[0]?.event_id ?? config?.event_id ?? null);
  const { announcements, ordemItems, eventTime } = useInicioAvisos(inscritoEventId, profile.id);

  // ── Métricas reais ────────────────────────────────────────────────────────
  const total      = coreografias.length;
  const comTrilha  = coreografias.filter(c => c.trilha_url).length;
  const pagas      = coreografias.filter(c => isRegistrationPaid(c.status_pagamento)).length;
  const pendentes  = coreografias.filter(c => isRegistrationPending(c.status_pagamento)).length;

  // A3 (2026-05-22 reabilitado em 2026-06-01): banner "dados pendentes" no
  // topo. Conta inscrições pagas (APROVADO/CONFIRMADO) com bailarinos cuja
  // row em `elenco` está sem CPF/nome/data_nascimento. Não detecta inscrições
  // pendentes — produtor avisa via outro canal antes de pagar. Helper
  // compartilhado em utils/bailarinos.ts faz JOIN via bailarinos_detalhes[].id.
  const dadosPendentes = coreografias.filter(c =>
    (c.status_pagamento === 'APROVADO' || c.status_pagamento === 'CONFIRMADO') &&
    hasIncompleteBailarinos(c, elencoById)
  ).length;

  const statusGeral = total === 0
    ? { label: 'Sem inscrições', color: 'text-slate-400' }
    : pendentes > 0
      ? { label: 'Pendências', color: 'text-amber-500' }
      : pagas === total
        ? { label: 'Em dia', color: 'text-emerald-500' }
        : { label: 'Em andamento', color: 'text-[#ff0068]' };

  // ── Prazo de inscrição ────────────────────────────────────────────────────
  const deadlineDays = daysUntil(config?.registration_deadline);

  // ── Home adaptativa (equipe ↔ inscrito) ─────────────────────────────────────
  // "Ser equipe" e "ser inscrito" não são exclusivos (mesmo princípio já usado
  // na Sidebar) — mas antes disso o Dashboard só sabia mostrar um dos dois
  // lados. `isEquipeAtiva` cobre cargo operacional real (COORDENADOR/...) E o
  // caso onde só `permissoes_custom` está populado (perfil promovido na mão,
  // sem role operacional — ver auditoria 2026-07-19). `showInscritoContent`
  // generaliza `isInscrito`: também é inscrito de fato quem TEM inscrição,
  // mesmo com role de equipe (coordenador que também dança).
  const isEquipeAtivaFlag = isEquipeAtiva(activeRole, profile.permissoes_custom);
  const showInscritoContent = isInscrito || total > 0;
  const isHybrid = !loading && isEquipeAtivaFlag && showInscritoContent;
  const equipeMenuItems = isEquipeAtivaFlag ? resolveEquipeMenuItems(profile.permissoes_custom) : [];
  const equipeRoute = isEquipeAtivaFlag ? resolveFirstEquipeRoute(profile.permissoes_custom) : null;
  // Quem tem os dois papéis vê primeiro o que usa mais — cargo operacional
  // real é o sinal mais forte de "essa pessoa está aqui pra trabalhar",
  // então equipe entra em foco por padrão; só permissoes_custom solto (sem
  // cargo) prioriza o lado inscrito.
  const [activeTab, setActiveTab] = useState<'equipe' | 'inscrito'>(
    isEquipeOperacional(activeRole) ? 'equipe' : 'inscrito'
  );
  const showEquipeBlock = isEquipeAtivaFlag && (!isHybrid || activeTab === 'equipe');
  const showInscritoBlock = showInscritoContent && (!isHybrid || activeTab === 'inscrito');

  return (
    <div className="space-y-5 animate-in fade-in duration-700">

      {/* ── Cabeçalho ── */}
      <div className="flex justify-between items-center">
        <div>
          <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">
            {config?.nome_evento || 'Festival Ativo'}
          </span>
          <h1 className="text-2xl font-black tracking-tighter uppercase">
            Olá, {profile.full_name?.split(' ')[0] || profile.email?.split('@')[0] || 'pessoa'}
          </h1>
        </div>
        {showInscritoBlock && (
          <button
            onClick={() => navigate('/minhas-coreografias')}
            className="bg-[#ff0068] text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 hover:scale-105 transition-all flex items-center gap-2"
          >
            <Plus size={14} /> Nova Inscrição
          </button>
        )}
      </div>

      {/* UX#12: erro silencioso virou visível pra usuário não ficar com tela em branco. */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* ── Abas leves equipe ↔ inscrito ── só aparece pra quem tem os dois
          papéis de fato (cargo operacional/permissão ATIVA + inscrição
          própria). Não é um account switcher (não recarrega Sidebar/sessão),
          só troca qual bloco de conteúdo abaixo fica visível — igual o
          padrão já usado em VendasTabs.tsx. */}
      {isHybrid && (
        <nav aria-label="Contexto" className="flex gap-2">
          {(['equipe', 'inscrito'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab
                  ? 'bg-[#ff0068] text-white shadow-md shadow-[#ff0068]/20'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {tab === 'equipe' ? 'Meu evento' : 'Minhas inscrições'}
            </button>
          ))}
        </nav>
      )}

      {/* ── A3 banner "dados pendentes" — fica fora das abas de propósito:
          é alerta acionável (bloqueia certificado), não conteúdo de um lado
          só, então continua visível independente da aba ativa. ── */}
      {dadosPendentes > 0 && (
        <button
          onClick={() => navigate('/minhas-coreografias')}
          className="w-full flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl text-left hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-all"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">
              Dados pendentes
            </p>
            <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">
              {dadosPendentes === 1
                ? 'Você tem 1 coreografia com bailarinos sem CPF, nome ou data de nascimento'
                : `Você tem ${dadosPendentes} coreografias com bailarinos sem CPF, nome ou data de nascimento`}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              Sem esses dados, certificado não emite e bailarinos podem ficar fora da triagem etária.
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 shrink-0 self-center">
            Completar
            <ChevronRight size={12} />
          </div>
        </button>
      )}

      {/* ── Resumo de equipe ── card único: cargo + ferramentas ativas (via
          permissoes_custom) + atalho pra primeira rota liberada. Substitui o
          empty state genérico que existia antes (2026-07-18) — em vez de só
          "você é equipe, veja o menu lateral", já lista o que a pessoa pode
          abrir daqui mesmo. ── */}
      {showEquipeBlock && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 p-6 space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/10 text-sky-500 flex items-center justify-center shrink-0">
              <Users size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 truncate">
                Equipe · {config?.nome_evento || 'Evento ativo'}
              </p>
              <p className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                {profile.cargo || 'Acesso de equipe'}
              </p>
            </div>
          </div>

          {equipeMenuItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {equipeMenuItems.map(item => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-[#ff0068]/10 hover:text-[#ff0068] text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  <item.icon size={12} /> {item.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] font-bold text-slate-400">
              Seu acesso ainda não foi configurado — fale com o produtor.
            </p>
          )}

          {equipeRoute && (
            <button
              onClick={() => navigate(equipeRoute)}
              className="px-5 py-2.5 bg-sky-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-sky-500/20 hover:scale-105 transition-all"
            >
              Ir pro meu painel →
            </button>
          )}
        </motion.div>
      )}

      {showInscritoBlock && (
      <>

      {/* ── Avisos do produtor ──
          Fica logo no topo do bloco de inscrito — é informação operacional
          urgente (mudança de local, atraso), diferente de onboarding.
          Padrão Stripe/Slack: banner de aviso > checklist. */}
      {isInscrito && <AvisosDoProdutor announcements={announcements} />}

      {/* ── Guia de Inscrição (apenas inscritos) ── */}
      {isInscrito && (
        <GuiaDeInscricao profile={profile} config={config} />
      )}

      {/* ── Ordem de apresentação (apenas inscritos) — baixa urgência, fica
          depois do Guia, não compete com Avisos que já está no topo. ── */}
      {isInscrito && <OrdemApresentacao items={ordemItems} eventTime={eventTime} />}

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
              const st = STATUS_LABEL[registrationDisplayKey(coreo.status_pagamento)] || STATUS_LABEL.PENDENTE;
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
                        {[coreo.formacao, coreo.categoria_nome, coreo.estilo_nome].filter(Boolean).join(' · ')}
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

      </>
      )}
    </div>
  );
};

export default Dashboard;
