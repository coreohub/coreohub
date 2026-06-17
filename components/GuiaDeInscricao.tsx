import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Music2, Upload, CreditCard,
  CheckCircle2, ChevronRight, ArrowRight,
  Calendar, Trophy, AlertTriangle, UserCircle, X,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { Profile as UserProfile } from '../types';

interface Props {
  profile: UserProfile;
  config: any;
}

const daysUntil = (dateStr?: string): number | null => {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const DeadlineBadge = ({ label, date }: { label: string; date?: string }) => {
  const days = daysUntil(date);
  if (days === null) return null;
  const expired = days < 0;
  const urgent = !expired && days <= 3;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
      expired ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
      urgent  ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                'bg-slate-200/60 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
    }`}>
      {urgent && <AlertTriangle size={10} />}
      <Calendar size={10} />
      {expired ? 'Encerrado' : days === 0 ? 'Hoje!' : `${label}: ${days}d`}
    </span>
  );
};

/* ── Banner de perfil incompleto — PR-C: vira CTA persistente, não bloqueia ───
 * Padrão Stripe/Linear: "Complete seu perfil" deixa de bloquear o fluxo —
 * vira sugestão visível em cima de tudo enquanto faltar dado. Necessário
 * só pra emissão de certificado (validade pública = nome verificado). */
const PROFILE_BANNER_DISMISS_KEY = 'coreohub_profile_cta_dismissed_at';
const PROFILE_BANNER_TTL_MS = 24 * 60 * 60 * 1000;

const ProfileIncompleteBanner: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const at = Number(localStorage.getItem(PROFILE_BANNER_DISMISS_KEY) ?? 0);
      return Date.now() - at < PROFILE_BANNER_TTL_MS;
    } catch { return false; }
  });

  const complete = !!(profile.full_name && profile.document && profile.whatsapp);
  if (complete || dismissed) return null;

  const missing = [
    !profile.full_name && 'Nome',
    !profile.document  && 'CPF',
    !profile.whatsapp  && 'WhatsApp',
  ].filter(Boolean).join(' · ');

  const handleDismiss = () => {
    try { localStorage.setItem(PROFILE_BANNER_DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3"
    >
      <div className="w-9 h-9 bg-amber-500/15 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
        <UserCircle size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-amber-800 dark:text-amber-200">
          Complete seu perfil pra emitir certificado
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          Faltam: <strong>{missing}</strong>. Você pode se inscrever e pagar normalmente — o perfil só
          é necessário pra receber certificado em PDF depois.
        </p>
        <button
          onClick={() => navigate('/profile')}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
        >
          Completar agora <ArrowRight size={11} />
        </button>
      </div>
      <button
        onClick={handleDismiss}
        className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 shrink-0"
        aria-label="Dispensar por 24h"
        title="Dispensar por 24h"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
};

/* ── Skeleton de carregamento ─────────────────────────────────────────────── */
const GuiaSkeleton = () => (
  <div className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden animate-pulse">
    <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-20 bg-slate-200 dark:bg-white/10 rounded-full" />
        <div className="h-4 w-36 bg-slate-200 dark:bg-white/10 rounded-full" />
      </div>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-1.5 w-5 bg-slate-200 dark:bg-white/10 rounded-full" />
        ))}
      </div>
    </div>
    {[1, 2, 3].map(i => (
      <div key={i} className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-2xl bg-slate-200 dark:bg-white/10 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-16 bg-slate-200 dark:bg-white/10 rounded-full" />
          <div className="h-3.5 w-40 bg-slate-200 dark:bg-white/10 rounded-full" />
          <div className="h-2.5 w-28 bg-slate-200 dark:bg-white/10 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

/* ── Componente principal ─────────────────────────────────────────────────── */
const GuiaDeInscricao: React.FC<Props> = ({ profile, config }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [elencoCount, setElencoCount] = useState(0);
  const [coreografias, setCoreografias] = useState<any[]>([]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const [elencoRes, coreografiasRes] = await Promise.all([
        supabase.from('elenco').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
        // status_pagamento + video_status pra detectar fluxo de seletiva: enquanto
        // o vídeo não foi aprovado, trilha sonora ainda não é cobrada do inscrito
        // (Joinville-style: trilha vai pós-aprovação).
        supabase.from('registrations').select('id, status, trilha_url, status_pagamento, video_status').eq('user_id', profile.id),
      ]);
      setElencoCount(elencoRes.count ?? 0);
      setCoreografias(coreografiasRes.data ?? []);
      setLoading(false);
    };
    fetchData();
  }, [profile.id]);

  const hasElenco      = elencoCount > 0;
  // Coreografias em fluxo de seletiva (AGUARDANDO_VIDEO) ainda não-aprovadas
  // NÃO entram na contagem de trilha pendente — a comissão analisa primeiro.
  const isAwaitingVideo = (c: any) =>
    c.status_pagamento === 'AGUARDANDO_VIDEO' && c.video_status !== 'approved';
  const coreoTrilhaApplicable = coreografias.filter(c => !isAwaitingVideo(c));
  const total          = coreoTrilhaApplicable.length;
  const comTrilha      = coreoTrilhaApplicable.filter(c => c.trilha_url).length;
  const pagas          = coreoTrilhaApplicable.filter(c => c.status === 'PAGO').length;
  // PR-C: perfil deixa de fazer parte do "completo" — fluxo pode terminar
  // sem perfil (só não emite certificado). Banner separado cobra o perfil.
  const allDone        = hasElenco && total > 0 && comTrilha === total && pagas === total;

  // PR-C: passo ativo é o primeiro não-concluído entre os 4. Sem mais "perfil".
  const activeStep =
    !hasElenco         ? 1 :
    total === 0        ? 2 :
    comTrilha < total  ? 3 :
    pagas < total      ? 4 : 5;

  // PR-C: removido 'locked' — todos os passos são acessíveis a qualquer momento.
  // Estados: 'done' (concluído), 'active' (em andamento), 'pending' (não iniciado).
  type StepStatus = 'done' | 'active' | 'pending';
  const getStatus = (id: number): StepStatus => {
    if (activeStep === 5 || id < activeStep) return 'done';
    if (id === activeStep) return 'active';
    return 'pending';
  };

  const steps = [
    {
      id: 1,
      Icon: Users,
      title: 'Cadastre seu elenco',
      subtitle: 'Bailarinos do grupo',
      description: 'Adicione cada bailarino com nome completo, CPF e data de nascimento. Pra solo, adicione apenas o próprio bailarino. (Você também pode cadastrar o elenco direto durante a inscrição.)',
      ctaLabel: hasElenco ? `Ver elenco (${elencoCount})` : 'Adicionar bailarinos',
      ctaAction: () => navigate('/bailarinos'),
      detail: (
        <div className="flex flex-wrap gap-2 items-center">
          {elencoCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-500 uppercase">
              {elencoCount} bailarino{elencoCount !== 1 ? 's' : ''} cadastrado{elencoCount !== 1 ? 's' : ''}
            </span>
          )}
          {config?.registration_deadline && (
            <DeadlineBadge label="Inscrições" date={config.registration_deadline} />
          )}
        </div>
      ),
    },
    {
      id: 2,
      Icon: Music2,
      title: 'Inscreva suas coreografias',
      subtitle: 'Solo, duo, trio ou grupo',
      description: 'Acesse a página do festival e clique direto na modalidade que quer inscrever (SOLO, DUO, TRIO ou GRUPO). O wizard de 4 passos cobre coreografia, elenco, trilha e pagamento de uma vez.',
      ctaLabel: total > 0 ? `Coreografias (${total})` : 'Inscrever agora',
      ctaAction: () => navigate(total > 0 ? '/minhas-coreografias' : '/festivais'),
      detail: (
        <div className="flex flex-wrap gap-2 items-center">
          {total > 0 && (
            <span className="text-[10px] font-bold text-emerald-500 uppercase">
              {total} coreografia{total !== 1 ? 's' : ''} inscrita{total !== 1 ? 's' : ''}
            </span>
          )}
          {config?.registration_deadline && (
            <DeadlineBadge label="Prazo" date={config.registration_deadline} />
          )}
        </div>
      ),
    },
    {
      id: 3,
      Icon: Upload,
      title: 'Envie as trilhas sonoras',
      subtitle: 'Arquivos de música para o evento',
      description: (() => {
        const formats = config?.formato_trilha || 'MP3, WAV ou M4A (máximo 100MB por arquivo)';
        const prazoFormatado = config?.prazo_trilhas
          ? new Date(config.prazo_trilhas + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
          : null;
        const prazoTexto = prazoFormatado
          ? `Envie a trilha sonora de cada coreografia inscrita até ${prazoFormatado}. Organize seus arquivos com antecedência.`
          : 'Envie a trilha sonora de cada coreografia inscrita dentro do prazo da produção.';
        return `${prazoTexto} Formatos aceitos: ${formats}.`;
      })(),
      ctaLabel: total > 0 ? `Trilhas (${comTrilha}/${total})` : 'Enviar trilhas',
      ctaAction: () => navigate('/central-de-midia'),
      detail: (
        <div className="flex flex-wrap gap-2 items-center">
          {total > 0 && comTrilha < total && (
            <span className="text-[10px] font-bold text-amber-500 uppercase">
              {total - comTrilha} trilha{total - comTrilha !== 1 ? 's' : ''} pendente{total - comTrilha !== 1 ? 's' : ''}
            </span>
          )}
          {comTrilha === total && total > 0 && (
            <span className="text-[10px] font-bold text-emerald-500 uppercase">Todas as trilhas enviadas</span>
          )}
          {config?.prazo_trilhas && (
            <DeadlineBadge label="Enviar até" date={config.prazo_trilhas} />
          )}
        </div>
      ),
    },
    {
      id: 4,
      Icon: CreditCard,
      title: 'Efetue o pagamento',
      subtitle: 'Confirme sua vaga no evento',
      description: 'Realize o pagamento das inscrições para garantir sua participação. Pix, boleto ou cartão de crédito. Se preferir, o pagamento pode ser feito presencialmente no credenciamento do evento.',
      ctaLabel: pagas === total && total > 0 ? 'Ver comprovantes' : `Pagar (${total - pagas} pend.)`,
      ctaAction: () => navigate('/pagamento'),
      detail: (
        <div className="flex flex-wrap gap-2 items-center">
          {total > 0 && pagas < total && (
            <span className="text-[10px] font-bold text-amber-500 uppercase">
              {total - pagas} coreografia{total - pagas !== 1 ? 's' : ''} aguardando pagamento
            </span>
          )}
          {config?.data_limite_pagamento && (
            <DeadlineBadge label="Pagar até" date={config.data_limite_pagamento} />
          )}
        </div>
      ),
    },
  ];

  if (loading) return <GuiaSkeleton />;

  if (allDone) {
    return (
      <div className="space-y-3">
        {/* PR-C: banner de perfil ainda aparece se incompleto, mesmo com tudo pago */}
        <ProfileIncompleteBanner profile={profile} />
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-emerald-500/5 rounded-3xl border border-emerald-500/20 p-6 flex items-center gap-5"
        >
          <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
            <Trophy size={28} />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-tighter text-emerald-500">Inscrição Completa!</h3>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
              Todas as etapas concluídas. Boa sorte no {config?.nome_evento || 'festival'}!
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* PR-C: banner de perfil incompleto — não bloqueia, só sugere */}
      <ProfileIncompleteBanner profile={profile} />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden"
      >
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Passo a passo</span>
            <h2 className="text-base font-black uppercase tracking-tighter leading-tight">Guia de Inscrição</h2>
          </div>
          {/* Barra de progresso (4 passos agora — perfil saiu) */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  getStatus(s) === 'done'   ? 'bg-emerald-500 w-7' :
                  getStatus(s) === 'active' ? 'bg-[#ff0068] w-9' :
                                              'bg-slate-300 dark:bg-white/10 w-4'
                }`}
              />
            ))}
            <span className="ml-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {Math.max(0, activeStep - 1)}/4
            </span>
          </div>
        </div>

        {/* Passos — todos clicáveis (PR-C removeu lock) */}
        <div className="divide-y divide-slate-100 dark:divide-white/5">
          {steps.map((step) => {
            const status = getStatus(step.id);
            const isExpanded = expandedStep === step.id || status === 'active';
            const { Icon } = step;

            return (
              <motion.div
                key={step.id}
                layout
                onClick={() => setExpandedStep(isExpanded && status !== 'active' ? null : step.id)}
                className={`px-5 py-4 transition-colors duration-200 cursor-pointer ${
                  status === 'active' ? 'bg-[#ff0068]/5' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                }`}
              >
                {/* Linha principal: ícone + texto + seta */}
                <div className="flex items-center gap-3 sm:gap-4">
                  {/* Ícone / status */}
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
                    status === 'done'    ? 'bg-emerald-500/10 text-emerald-500' :
                    status === 'active'  ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/25' :
                                          'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500'
                  }`}>
                    {status === 'done' ? <CheckCircle2 size={18} /> : <Icon size={18} />}
                  </div>

                  {/* Texto */}
                  <div className="flex-1 min-w-0">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${
                      status === 'done'   ? 'text-emerald-500' :
                      status === 'active' ? 'text-[#ff0068]' :
                                           'text-slate-400'
                    }`}>
                      {status === 'done' ? '✓ Concluído' : status === 'active' ? '● Em andamento' : `Passo ${step.id}`}
                    </span>
                    <h3 className="font-black uppercase tracking-tighter text-sm leading-tight text-slate-900 dark:text-white">
                      {step.title}
                    </h3>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                      {step.subtitle}
                    </p>
                  </div>

                  {/* Chevron pra passos done/pending */}
                  {status !== 'active' && (
                    <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 shrink-0" />
                  )}

                  {/* Botão CTA na linha — apenas desktop (sm+) para o passo ativo */}
                  {status === 'active' && (
                    <div className="shrink-0 hidden sm:block">
                      <button
                        onClick={(e) => { e.stopPropagation(); step.ctaAction(); }}
                        className="flex items-center gap-2 px-4 py-2 bg-[#ff0068] text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#ff0068]/20 whitespace-nowrap"
                      >
                        {step.ctaLabel} <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Botão CTA em largura total — apenas mobile para o passo ativo */}
                {status === 'active' && (
                  <div className="mt-3 ml-13 sm:hidden">
                    <button
                      onClick={(e) => { e.stopPropagation(); step.ctaAction(); }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#ff0068] text-white rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-[#ff0068]/20"
                    >
                      {step.ctaLabel} <ArrowRight size={14} />
                    </button>
                  </div>
                )}

                {/* Conteúdo expandido */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 ml-13 space-y-2.5 pb-1">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
                          {step.description}
                        </p>
                        <div className="flex flex-wrap gap-2 items-center">
                          {step.detail}
                        </div>
                        {status !== 'active' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); step.ctaAction(); }}
                            className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 hover:text-[#ff0068] uppercase tracking-widest transition-colors mt-1"
                          >
                            {step.ctaLabel} <ChevronRight size={11} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default GuiaDeInscricao;
