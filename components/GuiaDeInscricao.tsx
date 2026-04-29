import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCircle, Users, Music2, Upload, CreditCard,
  CheckCircle2, ChevronRight, Lock, ArrowRight,
  Calendar, Loader2, Trophy, AlertTriangle,
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

/* ── Skeleton de carregamento ─────────────────────────────────────────────── */
const GuiaSkeleton = () => (
  <div className="bg-white dark:bg-white/5 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden animate-pulse">
    <div className="px-6 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-20 bg-slate-200 dark:bg-white/10 rounded-full" />
        <div className="h-4 w-36 bg-slate-200 dark:bg-white/10 rounded-full" />
      </div>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map(i => (
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
        supabase.from('registrations').select('id, status, trilha_url').eq('user_id', profile.id),
      ]);
      setElencoCount(elencoRes.count ?? 0);
      setCoreografias(coreografiasRes.data ?? []);
      setLoading(false);
    };
    fetchData();
  }, [profile.id]);

  const profileComplete = !!(profile.full_name && profile.document && profile.whatsapp);
  const hasElenco      = elencoCount > 0;
  const total          = coreografias.length;
  const comTrilha      = coreografias.filter(c => c.trilha_url).length;
  const pagas          = coreografias.filter(c => c.status === 'PAGO').length;
  const allDone        = profileComplete && hasElenco && total > 0 && comTrilha === total && pagas === total;

  const activeStep =
    !profileComplete ? 1 :
    !hasElenco       ? 2 :
    total === 0      ? 3 :
    comTrilha < total ? 4 :
    pagas < total    ? 5 : 6;

  type StepStatus = 'done' | 'active' | 'locked';
  const getStatus = (id: number): StepStatus => {
    if (activeStep === 6 || id < activeStep) return 'done';
    if (id === activeStep) return 'active';
    return 'locked';
  };

  const steps = [
    {
      id: 1,
      Icon: UserCircle,
      title: 'Complete seu perfil',
      subtitle: 'Dados pessoais e documento',
      description: 'Preencha nome completo, CPF/CNPJ e WhatsApp. Essas informações são obrigatórias para emissão de certificados e recibos de pagamento.',
      ctaLabel: profileComplete ? 'Ver perfil' : 'Completar agora',
      ctaAction: () => navigate('/profile'),
      detail: profileComplete
        ? <span className="text-[10px] font-bold text-emerald-500 uppercase">Nome, CPF e WhatsApp preenchidos</span>
        : <span className="text-[10px] font-bold text-rose-500 uppercase">
            Faltam: {[!profile.full_name && 'Nome', !profile.document && 'CPF/CNPJ', !profile.whatsapp && 'WhatsApp'].filter(Boolean).join(' • ')}
          </span>,
    },
    {
      id: 2,
      Icon: Users,
      title: 'Cadastre seu elenco',
      subtitle: 'Bailarinos do grupo',
      description: 'Adicione cada bailarino com nome completo, CPF e data de nascimento. A faixa etária é verificada automaticamente conforme as regras do evento. Para solos, adicione apenas o próprio bailarino.',
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
      id: 3,
      Icon: Music2,
      title: 'Inscreva suas coreografias',
      subtitle: 'Solo, duo, trio ou grupo',
      description: 'Escolha o evento, estilo de dança, categoria etária e formação. Adicione os integrantes do elenco já cadastrados. Você pode inscrever quantas coreografias quiser dentro do prazo.',
      ctaLabel: total > 0 ? `Coreografias (${total})` : 'Inscrever agora',
      ctaAction: () => navigate('/minhas-coreografias'),
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
      id: 4,
      Icon: Upload,
      title: 'Envie as trilhas sonoras',
      subtitle: 'Arquivos de áudio para o evento',
      description: (() => {
        const formats = config?.formato_trilha || 'MP3, WAV ou M4A (máximo 100MB por arquivo)';
        const prazoFormatado = config?.prazo_upload_trilha
          ? new Date(config.prazo_upload_trilha).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
          : null;
        const prazoTexto = prazoFormatado
          ? `Envie a trilha sonora de cada coreografia inscrita até ${prazoFormatado}. Organize seus arquivos com antecedência para garantir uma participação tranquila no evento.`
          : 'Envie a trilha sonora de cada coreografia inscrita dentro do prazo estipulado pela produção do evento. Organize seus arquivos com antecedência para garantir sua participação.';
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
          {config?.prazo_upload_trilha && (
            <DeadlineBadge label="Enviar até" date={config.prazo_upload_trilha} />
          )}
        </div>
      ),
    },
    {
      id: 5,
      Icon: CreditCard,
      title: 'Efetue o pagamento',
      subtitle: 'Confirme sua vaga no evento',
      description: 'Realize o pagamento das inscrições para garantir sua participação. Você pode pagar agora via PIX, boleto ou cartão de crédito. Se preferir, o pagamento pode ser feito presencialmente no credenciamento do evento.',
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
    );
  }

  return (
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
        {/* Barra de progresso */}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map(s => (
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
            {Math.max(0, activeStep - 1)}/5
          </span>
        </div>
      </div>

      {/* Passos */}
      <div className="divide-y divide-slate-100 dark:divide-white/5">
        {steps.map((step) => {
          const status = getStatus(step.id);
          const isExpanded = expandedStep === step.id || status === 'active';
          const { Icon } = step;

          return (
            <motion.div
              key={step.id}
              layout
              onClick={() => {
                if (status === 'locked') return;
                setExpandedStep(isExpanded && status !== 'active' ? null : step.id);
              }}
              className={`px-5 py-4 transition-colors duration-200 ${
                status === 'locked'  ? 'opacity-35 cursor-not-allowed' :
                status === 'active'  ? 'bg-[#ff0068]/5 cursor-pointer' :
                                       'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]'
              }`}
            >
              {/* Linha principal: ícone + texto + seta (sem botão CTA aqui) */}
              <div className="flex items-center gap-3 sm:gap-4">
                {/* Ícone / status */}
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
                  status === 'done'   ? 'bg-emerald-500/10 text-emerald-500' :
                  status === 'active' ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/25' :
                                       'bg-slate-100 dark:bg-white/5 text-slate-300 dark:text-slate-600'
                }`}>
                  {status === 'done'   ? <CheckCircle2 size={18} /> :
                   status === 'locked' ? <Lock size={14} /> :
                                        <Icon size={18} />}
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
                  <h3 className={`font-black uppercase tracking-tighter text-sm leading-tight ${
                    status === 'locked' ? 'text-slate-400 dark:text-slate-600' : 'text-slate-900 dark:text-white'
                  }`}>
                    {step.title}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                    {step.subtitle}
                  </p>
                </div>

                {/* Chevron para passos concluídos (desktop e mobile) */}
                {status === 'done' && (
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
                {isExpanded && status !== 'locked' && (
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
                      {status === 'done' && (
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
  );
};

export default GuiaDeInscricao;
