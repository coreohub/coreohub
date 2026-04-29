import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Scale, Clock, AlertCircle,
  ArrowRight, X,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { Profile as UserProfile } from '../types';

type Severity = 'critical' | 'warning' | 'info';

interface AlertItem {
  id: string;
  severity: Severity;
  icon: React.ElementType;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
  dismissable?: boolean;
}

interface Props {
  profile: UserProfile;
}

const DISMISSED_KEY = 'coreohub_dismissed_alerts';

const getDismissed = (): Set<string> => {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
};

const saveDismissed = (ids: Set<string>) => {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {}
};

const daysUntil = (isoDate: string): number => {
  const target = new Date(isoDate + 'T23:59:59').getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

const ProducerAlerts: React.FC<Props> = ({ profile }) => {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed());

  useEffect(() => {
    const load = async () => {
      const newAlerts: AlertItem[] = [];

      const [eventsRes, profileRes, cfgRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, name, category_price, registration_deadline, formacoes_config')
          .eq('created_by', profile.id),
        supabase
          .from('profiles')
          .select('asaas_subconta_id')
          .eq('id', profile.id)
          .maybeSingle(),
        supabase
          .from('configuracoes')
          .select('regras_avaliacao')
          .eq('id', 1)
          .maybeSingle(),
      ]);

      const events = eventsRes.data ?? [];
      const asaasOk = !!profileRes.data?.asaas_subconta_id;
      const hasCriterios = !!(cfgRes.data?.regras_avaliacao && (cfgRes.data.regras_avaliacao as any)?.globalRules);

      // ── ALERTA CRÍTICO: Asaas não conectado mas tem evento pago ───────
      const hasPaidEvent = events.some(e => {
        const price = Number(e.category_price ?? 0);
        const formacoes: any[] = Array.isArray(e.formacoes_config) ? e.formacoes_config : [];
        const formacaoPaga = formacoes.some((f: any) => Number(f?.fee ?? 0) > 0);
        return price > 0 || formacaoPaga;
      });

      if (!asaasOk && hasPaidEvent) {
        newAlerts.push({
          id: 'asaas-missing',
          severity: 'critical',
          icon: CreditCard,
          title: 'Conecte sua conta Asaas',
          description: 'Você tem evento com inscrição paga, mas a conta de recebimento não está configurada. Sem ela, ninguém consegue pagar.',
          ctaLabel: 'Conectar agora',
          onCta: () => navigate('/account-settings?tab=Pagamentos'),
          dismissable: false,
        });
      }

      // ── AVISO: Critérios de avaliação não configurados ────────────────
      if (events.length > 0 && !hasCriterios) {
        newAlerts.push({
          id: 'criterios-missing',
          severity: 'warning',
          icon: Scale,
          title: 'Configure os critérios dos jurados',
          description: 'Sem critérios de avaliação definidos, os jurados não conseguem dar notas no terminal.',
          ctaLabel: 'Configurar',
          onCta: () => navigate('/account-settings?tab=Avaliação'),
          dismissable: true,
        });
      }

      // ── INFO: Prazos críticos de inscrição ────────────────────────────
      for (const ev of events) {
        if (!ev.registration_deadline) continue;
        const days = daysUntil(ev.registration_deadline);
        if (days < 0 || days > 7) continue;

        const { count } = await supabase
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', ev.id)
          .eq('status_pagamento', 'CONFIRMADO');

        const dayLabel = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`;
        const inscritos = count ?? 0;

        newAlerts.push({
          id: `deadline-${ev.id}`,
          severity: days <= 1 ? 'warning' : 'info',
          icon: Clock,
          title: `Inscrições encerram ${dayLabel}`,
          description: `${ev.name} — ${inscritos} inscrição${inscritos !== 1 ? 'ões' : ''} confirmada${inscritos !== 1 ? 's' : ''}.`,
          dismissable: true,
        });
      }

      setAlerts(newAlerts);
    };
    load();
  }, [profile.id, navigate]);

  const handleDismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  };

  const visible = alerts.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  const styleByLevel: Record<Severity, { bg: string; border: string; icon: string; cta: string }> = {
    critical: {
      bg: 'bg-rose-500/5',
      border: 'border-rose-500/30',
      icon: 'bg-rose-500/10 text-rose-500',
      cta: 'bg-rose-500 hover:bg-rose-600 text-white',
    },
    warning: {
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/30',
      icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      cta: 'bg-amber-500 hover:bg-amber-600 text-white',
    },
    info: {
      bg: 'bg-sky-500/5',
      border: 'border-sky-500/30',
      icon: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      cta: 'bg-sky-500 hover:bg-sky-600 text-white',
    },
  };

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {visible.map(alert => {
          const s = styleByLevel[alert.severity];
          const Icon = alert.icon;
          return (
            <motion.div
              key={alert.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex items-start gap-3 p-4 rounded-2xl border ${s.bg} ${s.border}`}
            >
              <div className={`w-9 h-9 rounded-xl ${s.icon} flex items-center justify-center shrink-0`}>
                <Icon size={16} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {alert.title}
                </p>
                <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 font-medium mt-0.5 leading-relaxed">
                  {alert.description}
                </p>
              </div>

              {alert.onCta && alert.ctaLabel && (
                <button
                  onClick={alert.onCta}
                  className={`shrink-0 hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${s.cta}`}
                >
                  {alert.ctaLabel} <ArrowRight size={11} />
                </button>
              )}

              {alert.dismissable && (
                <button
                  onClick={() => handleDismiss(alert.id)}
                  className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                  aria-label="Dispensar alerta"
                >
                  <X size={14} />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default ProducerAlerts;
