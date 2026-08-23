import React, { useEffect, useState } from 'react';
import { MailWarning, Loader2, X, CheckCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

/**
 * Banner persistente que aparece no topo do PrivateLayout enquanto o e-mail
 * do usuário não foi confirmado. Padrão Stripe/Linear/Notion (Q2.3 da pesquisa
 * de mercado 2026-05-06): não bloqueia uso da plataforma, só sinaliza.
 *
 * - Sem `email_confirmed_at` no auth.user → mostra banner
 * - User clica "Reenviar" → dispara `auth.resend({ type: 'signup' })`
 * - User clica "Dispensar" → esconde por 24h via localStorage
 * - Em login OAuth (Google), email vem confirmado → banner não aparece
 */

const DISMISS_KEY = 'coreohub_email_verify_dismissed_at';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

const wasDismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

const EmailVerifyBanner: React.FC = () => {
  const [needsVerify, setNeedsVerify] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissedRecently);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setNeedsVerify(false);
        setEmail(null);
        return;
      }
      // email_confirmed_at é null pra signups por email/senha sem confirmação.
      // OAuth (Google) já vem confirmed.
      if (!user.email_confirmed_at) {
        setNeedsVerify(true);
        setEmail(user.email ?? null);
      } else {
        setNeedsVerify(false);
        setEmail(null);
      }
    };

    refresh();

    // A5: escuta updates de auth (verificação em outra aba, refresh de token,
    // signOut/signIn) pra não exigir reload da página pra atualizar o banner.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        refresh();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setFeedback(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/inicio` },
      });
      if (error) throw error;
      setFeedback({ kind: 'ok', msg: 'Link reenviado pro seu e-mail. Verifique também a caixa de spam.' });
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? 'Erro ao reenviar.' });
    } finally {
      setResending(false);
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  if (!needsVerify || dismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2.5">
      <div className="flex items-center gap-3 max-w-6xl mx-auto">
        <MailWarning size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          {feedback ? (
            <p className={`text-xs sm:text-sm font-bold flex items-center gap-1.5 ${
              feedback.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {feedback.kind === 'ok' && <CheckCircle size={12} />}
              {feedback.msg}
            </p>
          ) : (
            <p className="text-xs sm:text-sm font-bold text-amber-700 dark:text-amber-300 truncate">
              <span className="hidden sm:inline">Verifique seu e-mail </span>
              {email ? <span className="font-black">{email}</span> : 'pra desbloquear download de certificado e outras ações'}
            </p>
          )}
        </div>
        <button
          onClick={handleResend}
          disabled={resending || !email}
          className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-colors shrink-0 disabled:opacity-50"
        >
          {resending ? <Loader2 size={12} className="animate-spin" /> : <span>Reenviar</span>}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition-colors shrink-0"
          aria-label="Dispensar por 24h"
          title="Dispensar por 24h"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default EmailVerifyBanner;
