import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCircle, CreditCard, Calendar,
  CheckCircle2, ChevronRight, Lock, ArrowRight, Trophy, X,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { Profile as UserProfile } from '../types';

interface Props {
  profile: UserProfile;
}

const GuiaSkeleton = () => (
  <div className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden animate-pulse">
    <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-20 bg-slate-200 dark:bg-white/10 rounded-full" />
        <div className="h-4 w-36 bg-slate-200 dark:bg-white/10 rounded-full" />
      </div>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map(i => <div key={i} className="h-1.5 w-5 bg-slate-200 dark:bg-white/10 rounded-full" />)}
      </div>
    </div>
    {[1, 2, 3].map(i => (
      <div key={i} className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-2xl bg-slate-200 dark:bg-white/10 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-16 bg-slate-200 dark:bg-white/10 rounded-full" />
          <div className="h-3.5 w-40 bg-slate-200 dark:bg-white/10 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

const GuiaDoProdutor: React.FC<Props> = ({ profile }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [asaasConnected, setAsaasConnected] = useState(false);
  const [eventsCount, setEventsCount] = useState(0);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const [asaasRes, eventsRes] = await Promise.all([
        supabase.from('profiles').select('asaas_subconta_id, onboarding_dismissed_at').eq('id', profile.id).maybeSingle(),
        supabase.from('events').select('id').eq('created_by', profile.id).limit(1),
      ]);
      setAsaasConnected(!!asaasRes.data?.asaas_subconta_id);
      setDismissedAt((asaasRes.data as any)?.onboarding_dismissed_at ?? null);
      setEventsCount((eventsRes.data ?? []).length);
      setLoading(false);
    };
    fetchData();
  }, [profile.id]);

  const handleDismiss = async () => {
    setDismissing(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_dismissed_at: now })
      .eq('id', profile.id);
    if (!error) setDismissedAt(now);
    setDismissing(false);
  };

  // Etapa 4 "Compartilhar link" removida 2026-05-20: era redundante com o
  // botão "LINK DE INSCRIÇÃO" do header do dashboard, e tinha bug de estado
  // volátil (linkCopied só vivia em memória, perdia no reload).
  // Setup agora = 3 etapas (perfil + Asaas + evento). Quando completa, mostra
  // "Tudo pronto" com botão Fechar.
  const profileComplete = !!(profile.full_name && (profile as any).whatsapp);
  const hasEvent = eventsCount > 0;
  const allDone = profileComplete && asaasConnected && hasEvent;

  const activeStep =
    !profileComplete ? 1 :
    !asaasConnected  ? 2 :
    !hasEvent        ? 3 : 4;

  type StepStatus = 'done' | 'active' | 'locked';
  const getStatus = (id: number): StepStatus => {
    if (activeStep === 4 || id < activeStep) return 'done';
    if (id === activeStep) return 'active';
    return 'locked';
  };

  const steps = [
    {
      id: 1,
      Icon: UserCircle,
      title: 'Complete seu perfil',
      subtitle: 'Nome, WhatsApp e documento',
      description: 'Preencha seus dados pessoais e CPF/CNPJ. Essas informações são necessárias para a abertura da subconta Asaas que receberá os pagamentos das inscrições.',
      ctaLabel: profileComplete ? 'Ver perfil' : 'Completar agora',
      ctaAction: () => navigate('/profile'),
      detail: profileComplete
        ? <span className="text-[10px] font-bold text-emerald-500 uppercase">Dados básicos preenchidos</span>
        : <span className="text-[10px] font-bold text-rose-500 uppercase">
            Faltam: {[!profile.full_name && 'Nome', !(profile as any).whatsapp && 'WhatsApp'].filter(Boolean).join(' • ')}
          </span>,
    },
    {
      id: 2,
      Icon: CreditCard,
      title: 'Conecte sua conta Asaas',
      subtitle: 'Subconta para receber pagamentos',
      description: 'Configure a subconta Asaas para receber os pagamentos das inscrições do seu festival. O split é automático: a comissão da plataforma é descontada antes do repasse pra você.',
      ctaLabel: asaasConnected ? 'Ver conta Asaas' : 'Conectar agora',
      ctaAction: () => navigate('/account-settings?tab=Pagamentos'),
      detail: asaasConnected
        ? <span className="text-[10px] font-bold text-emerald-500 uppercase">Subconta Asaas ativa</span>
        : <span className="text-[10px] font-bold text-amber-500 uppercase">Subconta ainda não criada</span>,
    },
    {
      id: 3,
      Icon: Calendar,
      title: 'Crie seu primeiro festival',
      subtitle: 'Nome, datas, modalidades e preços',
      description: 'Configure seu evento: nome, data, local, modalidades (solo, duo, grupo), categorias etárias, estilos de dança e valores de inscrição. Você pode editar tudo depois.',
      ctaLabel: hasEvent ? `Ver eventos (${eventsCount})` : 'Criar evento',
      ctaAction: () => navigate(hasEvent ? '/qg-organizador' : '/criar-evento'),
      detail: hasEvent
        ? <span className="text-[10px] font-bold text-emerald-500 uppercase">{eventsCount} evento{eventsCount !== 1 ? 's' : ''} cadastrado{eventsCount !== 1 ? 's' : ''}</span>
        : <span className="text-[10px] font-bold text-amber-500 uppercase">Nenhum evento criado ainda</span>,
    },
  ];

  if (loading) return <GuiaSkeleton />;

  // Dismiss permanente quando completou tudo, OU temporário (14 dias) quando
  // produtor fechou estando incompleto (volta a aparecer pra lembrar).
  // Stripe/Linear/Slack usam variação parecida — onboarding incompleto reaparece
  // pra não frustrar quem tá bloqueado por KYC sem virar nag screen permanente.
  if (dismissedAt) {
    if (allDone) return null;
    const daysSince = (Date.now() - new Date(dismissedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 14) return null;
  }

  if (allDone) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="bg-emerald-500/5 rounded-3xl border border-emerald-500/20 p-6 flex items-center gap-5"
      >
        <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 shrink-0">
          <Trophy size={28} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-black uppercase tracking-tighter text-emerald-500">Tudo pronto!</h3>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
            Seu festival está no ar e pronto pra receber inscrições.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          title="Fechar guia"
          aria-label="Fechar guia do produtor"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10 hover:border-slate-400 dark:hover:border-white/30 transition-all disabled:opacity-50"
        >
          <X size={12} /> Fechar
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Passo a passo</span>
          <h2 className="text-base font-black uppercase tracking-tighter leading-tight">Guia do Produtor</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map(s => (
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
              {Math.max(0, activeStep - 1)}/3
            </span>
          </div>
          {/* Esconder por 14 dias — produtor bloqueado por KYC/sem tempo pode
              tirar o guia da vista sem perder o progresso. Volta a aparecer
              em 14d se ainda incompleto. */}
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            title="Esconder por 14 dias"
            aria-label="Esconder guia por enquanto"
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 dark:hover:text-white border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all disabled:opacity-50"
          >
            <X size={11} /> Esconder
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-white/5">
        {steps.map((step) => {
          const status = getStatus(step.id);
          const isExpanded = expandedStep === step.id;
          const { Icon } = step;

          // Etapa concluída: layout COMPACTO (linha fina, padding mínimo,
          // sem subtítulo). Padrão Stripe/Linear/Notion — depois que
          // concluiu, o item vira só confirmação visual.
          if (status === 'done') {
            return (
              <motion.div
                key={step.id}
                layout
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                className="px-5 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors duration-200"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-500">
                    <CheckCircle2 size={14} />
                  </div>
                  <h3 className="flex-1 min-w-0 font-bold text-[12px] text-slate-500 dark:text-slate-400 truncate">
                    {step.title}
                  </h3>
                  <ChevronRight
                    size={13}
                    className={`text-slate-300 dark:text-slate-600 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 ml-10 space-y-2 pb-1">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
                          {step.description}
                        </p>
                        {step.detail && (
                          <div className="flex flex-wrap gap-2 items-center">{step.detail}</div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); step.ctaAction(); }}
                          className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 hover:text-[#ff0068] uppercase tracking-widest transition-colors mt-1"
                        >
                          {step.ctaLabel} <ChevronRight size={11} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          }

          // Etapa ativa ou bloqueada: layout expandido com CTA visível.
          const isActiveExpanded = status === 'active';
          return (
            <motion.div
              key={step.id}
              layout
              onClick={() => {
                if (status === 'locked') return;
              }}
              className={`px-5 py-4 transition-colors duration-200 ${
                status === 'locked' ? 'opacity-35 cursor-not-allowed' : 'bg-[#ff0068]/5'
              }`}
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
                  status === 'active'
                    ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/25'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-300 dark:text-slate-600'
                }`}>
                  {status === 'locked' ? <Lock size={14} /> : <Icon size={18} />}
                </div>

                <div className="flex-1 min-w-0">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${
                    status === 'active' ? 'text-[#ff0068]' : 'text-slate-400'
                  }`}>
                    {status === 'active' ? '● Em andamento' : `Passo ${step.id}`}
                  </span>
                  <h3 className={`font-black uppercase tracking-tighter text-sm leading-tight ${
                    status === 'locked' ? 'text-slate-400 dark:text-slate-600' : 'text-slate-900 dark:text-white'
                  }`}>
                    {step.title}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                    {step.subtitle}
                  </p>
                </div>

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

              {isActiveExpanded && (
                <div className="mt-3 ml-13 space-y-2.5 pb-1">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
                    {step.description}
                  </p>
                  {step.detail && (
                    <div className="flex flex-wrap gap-2 items-center">{step.detail}</div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default GuiaDoProdutor;
