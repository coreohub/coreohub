import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Music2, Upload, CreditCard,
  CheckCircle2, ChevronRight, ArrowRight,
  Calendar, Trophy, AlertTriangle, UserCircle, X,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { isRegistrationPaid } from '../utils/registrationStatus';
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

/* ── Perfil incompleto — PR-D: dobrado pra dentro do card único do Guia ──────
 * Antes era um card cheio próprio (motion.div com padding/borda inteira),
 * empilhado ACIMA do Guia. Consolidação em 1 card fixo (2026-08-08): vira
 * uma tira fina no rodapé do mesmo card, só quando o perfil está incompleto.
 * Padrão Stripe/Linear: "Complete seu perfil" não bloqueia o fluxo — é
 * sugestão persistente, dispensável por 24h, necessária só pra emitir
 * certificado (validade pública = nome verificado). */
const PROFILE_BANNER_DISMISS_KEY = 'coreohub_profile_cta_dismissed_at';
const PROFILE_BANNER_TTL_MS = 24 * 60 * 60 * 1000;

const useProfileIncomplete = (profile: UserProfile) => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      const at = Number(localStorage.getItem(PROFILE_BANNER_DISMISS_KEY) ?? 0);
      return Date.now() - at < PROFILE_BANNER_TTL_MS;
    } catch { return false; }
  });

  const complete = !!(profile.full_name && profile.document && profile.whatsapp);
  const missing = [
    !profile.full_name && 'Nome',
    !profile.document  && 'CPF',
    !profile.whatsapp  && 'WhatsApp',
  ].filter(Boolean).join(' · ');

  const dismiss = () => {
    try { localStorage.setItem(PROFILE_BANNER_DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  return { show: !complete && !dismissed, missing, dismiss };
};

const ProfileIncompleteStrip: React.FC<{ missing: string; onDismiss: () => void }> = ({ missing, onDismiss }) => {
  const navigate = useNavigate();
  return (
    <div className="px-5 py-3 border-t border-amber-500/15 bg-amber-500/5 flex items-center gap-3">
      <div className="w-7 h-7 bg-amber-500/15 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
        <UserCircle size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-amber-800 dark:text-amber-300 truncate">
          Complete seu perfil pra emitir certificado — faltam: <strong>{missing}</strong>
        </p>
      </div>
      <button
        onClick={() => navigate('/profile')}
        className="shrink-0 text-[9px] font-black text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 uppercase tracking-widest flex items-center gap-1"
      >
        Completar <ArrowRight size={10} />
      </button>
      <button
        onClick={onDismiss}
        className="shrink-0 text-amber-600/70 dark:text-amber-500/70 hover:text-amber-900 dark:hover:text-amber-200"
        aria-label="Dispensar por 24h"
        title="Dispensar por 24h"
      >
        <X size={12} />
      </button>
    </div>
  );
};

/* ── Skeleton de carregamento — 1 card único agora, não mais lista de 3 ──── */
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
    <div className="px-5 py-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-2xl bg-slate-200 dark:bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-2.5 w-16 bg-slate-200 dark:bg-white/10 rounded-full" />
        <div className="h-3.5 w-40 bg-slate-200 dark:bg-white/10 rounded-full" />
        <div className="h-2.5 w-28 bg-slate-200 dark:bg-white/10 rounded-full" />
      </div>
    </div>
  </div>
);

/* ── Confetti sutil — burst curto e contido dentro do card (não tela cheia).
 * CSS/framer-motion puro, sem lib nova só pra isso. ───────────────────────── */
const CONFETTI_COLORS = ['#ff0068', '#e3ff0a', '#1de7f2', '#10b981'];

const ConfettiBurst: React.FC = () => {
  const particles = React.useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 220,
    delay: Math.random() * 0.15,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rotate: Math.random() * 360,
  })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {particles.map(p => (
        <motion.span
          key={p.id}
          initial={{ opacity: 1, x: 0, y: -10, rotate: 0 }}
          animate={{ opacity: 0, x: p.x, y: 140, rotate: p.rotate }}
          transition={{ duration: 1.4, delay: p.delay, ease: 'easeOut' }}
          className="absolute left-1/2 top-6 w-1.5 h-3 rounded-sm"
          style={{ backgroundColor: p.color }}
        />
      ))}
    </div>
  );
};

/* ── Componente principal ─────────────────────────────────────────────────── */
const GuiaDeInscricao: React.FC<Props> = ({ profile, config }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [elencoCount, setElencoCount] = useState(0);
  const [coreografias, setCoreografias] = useState<any[]>([]);
  // Passo que o card está exibindo no momento — default é o passo ATIVO
  // (null = "segue o ativo automaticamente"). Clicar num pontinho de
  // progresso fixa a preview naquele passo até o user clicar em outro.
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const { show: showProfileStrip, missing: profileMissing, dismiss: dismissProfile } = useProfileIncomplete(profile);

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
  const comTrilha       = coreoTrilhaApplicable.filter(c => c.trilha_url).length;
  const pagas           = coreoTrilhaApplicable.filter(c => isRegistrationPaid(c.status_pagamento)).length;
  // PR-C: perfil deixa de fazer parte do "completo" — fluxo pode terminar
  // sem perfil (só não emite certificado). Tira separada cobra o perfil.
  const allDone        = hasElenco && total > 0 && comTrilha === total && pagas === total;

  // Confetti sutil só na 1ª vez que o card "Inscrição Completa!" aparece —
  // chave em localStorage por user+evento evita repetir a cada revisita
  // (padrão Duolingo/Notion: celebra o momento, não incomoda depois).
  const [showConfetti, setShowConfetti] = useState(false);
  useEffect(() => {
    if (!allDone) return;
    try {
      const key = `coreohub_confetti_shown_${profile.id}_${config?.event_id ?? 'default'}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 1600);
      return () => clearTimeout(t);
    } catch { /* localStorage indisponível — sem confetti, sem crash */ }
  }, [allDone]);

  // PR-C: passo ativo é o primeiro não-concluído entre os 4.
  const activeStep =
    !hasElenco         ? 1 :
    total === 0        ? 2 :
    comTrilha < total  ? 3 :
    pagas < total      ? 4 : 5;

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
      // Copy neutra de propósito — este passo não sabe se a formação
      // escolhida é paga ou gratuita (isso depende de formacoes_config do
      // evento, que o Guia não consulta). "Pagamento" seria enganoso pra
      // eventos 100% gratuitos (contrato fechado, governo, etc).
      title: 'Finalize sua inscrição',
      subtitle: 'Confirme sua vaga no evento',
      description: 'Garanta sua participação. Se o evento cobrar inscrição, pague via Pix, boleto, cartão ou presencialmente no credenciamento. Se for gratuito, é só confirmar — sem cobrança nenhuma.',
      ctaLabel: pagas === total && total > 0 ? 'Ver comprovantes' : `Finalizar (${total - pagas} pend.)`,
      ctaAction: () => navigate('/minhas-coreografias'),
      detail: (
        <div className="flex flex-wrap gap-2 items-center">
          {total > 0 && pagas < total && (
            <span className="text-[10px] font-bold text-amber-500 uppercase">
              {total - pagas} coreografia{total - pagas !== 1 ? 's' : ''} aguardando confirmação
            </span>
          )}
          {config?.data_limite_pagamento && (
            <DeadlineBadge label="Prazo" date={config.data_limite_pagamento} />
          )}
        </div>
      ),
    },
  ];

  if (loading) return <GuiaSkeleton />;

  if (allDone) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-emerald-500/5 rounded-3xl border border-emerald-500/20 overflow-hidden"
      >
        {showConfetti && <ConfettiBurst />}
        <div className="p-6 flex items-center gap-5">
          <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
            <Trophy size={28} />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-tighter text-emerald-500">Inscrição Completa!</h3>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
              Todas as etapas concluídas. Boa sorte no {config?.nome_evento || 'festival'}!
            </p>
          </div>
        </div>
        {/* Perfil ainda pode estar incompleto mesmo com tudo pago/enviado */}
        {showProfileStrip && (
          <ProfileIncompleteStrip missing={profileMissing} onDismiss={dismissProfile} />
        )}
      </motion.div>
    );
  }

  const displayStepId = previewStep ?? activeStep;
  const displayStep = steps.find(s => s.id === displayStepId) ?? steps[0];
  const displayStatus = getStatus(displayStep.id);
  const { Icon } = displayStep;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden"
    >
      {/* Cabeçalho */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Passo a passo</span>
          <h2 className="text-base font-black uppercase tracking-tighter leading-tight">Guia de Inscrição</h2>
        </div>
        {/* Pontinhos de progresso — clicáveis, trocam a preview do card sem
            navegar (padrão "step indicator" de carrossel, não decorativo). */}
        <div className="flex items-center gap-1.5 shrink-0">
          {[1, 2, 3, 4].map(s => (
            <button
              key={s}
              onClick={() => setPreviewStep(s === displayStepId ? null : s)}
              aria-label={`Ver passo ${s} de 4`}
              aria-current={displayStepId === s ? 'step' : undefined}
              title={steps[s - 1].title}
              className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${
                getStatus(s) === 'done'   ? 'bg-emerald-500' :
                getStatus(s) === 'active' ? 'bg-[#ff0068]' :
                                            'bg-slate-300 dark:bg-white/10'
              } ${displayStepId === s ? 'w-9' : 'w-4 hover:opacity-70'}`}
            />
          ))}
          <span className="ml-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {Math.max(0, activeStep - 1)}/4
          </span>
        </div>
      </div>

      {/* Corpo — só o passo em preview (default = ativo), não a lista inteira */}
      <AnimatePresence mode="wait">
        <motion.div
          key={displayStep.id}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.15 }}
          className="px-5 py-5"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
              displayStatus === 'done'    ? 'bg-emerald-500/10 text-emerald-500' :
              displayStatus === 'active'  ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/25' :
                                            'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500'
            }`}>
              {displayStatus === 'done' ? <CheckCircle2 size={18} /> : <Icon size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-[10px] font-black uppercase tracking-widest ${
                displayStatus === 'done'   ? 'text-emerald-500' :
                displayStatus === 'active' ? 'text-[#ff0068]' :
                                             'text-slate-400'
              }`}>
                {displayStatus === 'done' ? '✓ Concluído' : displayStatus === 'active' ? '● Em andamento' : `Passo ${displayStep.id}`}
              </span>
              <h3 className="font-black uppercase tracking-tighter text-sm leading-tight text-slate-900 dark:text-white">
                {displayStep.title}
              </h3>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                {displayStep.subtitle}
              </p>
            </div>
            {displayStepId !== activeStep && (
              <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 shrink-0" />
            )}
          </div>

          <div className="mt-3 space-y-2.5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
              {displayStep.description}
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              {displayStep.detail}
            </div>
          </div>

          <button
            onClick={() => displayStep.ctaAction()}
            className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-[#ff0068]/20"
          >
            {displayStep.ctaLabel} <ArrowRight size={13} />
          </button>
        </motion.div>
      </AnimatePresence>

      {/* Perfil incompleto — tira fina no rodapé do mesmo card */}
      {showProfileStrip && (
        <ProfileIncompleteStrip missing={profileMissing} onDismiss={dismissProfile} />
      )}
    </motion.div>
  );
};

export default GuiaDeInscricao;
