import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, Loader2, Mail, Lock, ArrowRight, ShieldCheck, Zap, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';
import AsaasBadge from '../components/AsaasBadge';
import { suggestEmail } from '../utils/mailcheck';
import { isInAppBrowser } from '../utils/inAppBrowser';

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // #14 mudanca 2: tablet em modo Terminal nunca deve cair em /login do
  // produtor. Se kiosk_mode ativo + tablet_token salvo, redireciona pra
  // a tela de selecao de jurado. Equipe que precisa logar como produtor
  // tem que sair do modo Terminal explicitamente em /judge-login/<token>.
  useEffect(() => {
    try {
      const isKiosk = localStorage.getItem('coreohub_tablet_kiosk_mode') === 'true';
      const tabletToken = localStorage.getItem('coreohub_tablet_judge_token');
      if (isKiosk && tabletToken) {
        navigate(`/judge-login/${tabletToken}`, { replace: true });
      }
    } catch { /* noop */ }
  }, [navigate]);

  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Decide modo inicial pela URL (autoritativa) + redirectTo como override.
  // Antes só olhava redirectTo, o que podia deixar o usuario em "signup"
  // depois de logout se algum state lingerasse. Agora /login = login,
  // /register = signup, e deep link com redirectTo defaulta pra signup
  // (intencao de criar conta pra se inscrever no evento).
  const [authMode, setAuthMode] = useState<'login' | 'signup'>(() => {
    if (location.pathname === '/register') return 'signup';
    if (location.pathname === '/login') return 'login';
    return location.state?.redirectTo ? 'signup' : 'login';
  });

  // Suporta redirectTo via location.state (PrivateRoute) OU query string (após
  // OAuth callback do Google que perde o state mas mantém URL).
  const queryParams = new URLSearchParams(location.search);
  const redirectTo = location.state?.redirectTo ?? queryParams.get('redirectTo');

  // Captura source do lead (UTM) na primeira visita à tela de auth. Ordem
  // de precedência (padrão GA4/Mixpanel):
  //   1) utm_source explícito na URL atual
  //   2) document.referrer (mapeia host → fonte conhecida)
  //   3) 'direct' como fallback
  // Persiste em localStorage pra sobreviver ao roundtrip de OAuth/email.
  // Lido no SIGNED_IN handler junto com entry_event_id.
  useEffect(() => {
    try {
      // Não sobrescreve se já capturou nesta sessão (preserva fonte da primeira chegada).
      if (localStorage.getItem('coreohub_lead_entry_source')) return;

      const utm = queryParams.get('utm_source')?.trim().toLowerCase();
      if (utm) {
        localStorage.setItem('coreohub_lead_entry_source', utm);
        return;
      }

      const ref = document.referrer;
      if (ref) {
        const refHost = (() => { try { return new URL(ref).host.toLowerCase(); } catch { return ''; } })();
        // Mapa simples host → source canônica (mercado BR de dança usa muito).
        // Padrão GA4 "default channel grouping" reduzido.
        const inferred =
          refHost.includes('instagram.com') ? 'instagram' :
          refHost.includes('facebook.com')  ? 'facebook'  :
          refHost.includes('whatsapp.com') || refHost.includes('wa.me') ? 'whatsapp' :
          refHost.includes('youtube.com')  ? 'youtube'  :
          refHost.includes('tiktok.com')   ? 'tiktok'   :
          refHost.includes('google.')      ? 'google'   :
          refHost.includes('bing.com')     ? 'bing'     :
          refHost && !refHost.includes(window.location.host) ? 'referral' : null;
        if (inferred) {
          localStorage.setItem('coreohub_lead_entry_source', inferred);
          return;
        }
      }

      localStorage.setItem('coreohub_lead_entry_source', 'direct');
    } catch {
      /* localStorage off — ignora */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Detecção de in-app browser (Instagram/Facebook/TikTok): o OAuth do Google
  // é bloqueado nesses WebViews (erro 403 disallowed_useragent). Dentro deles
  // escondemos o Google e oferecemos login por e-mail (OTP + link mágico), que
  // funciona em qualquer navegador. Fora do webview nada muda.
  const isInApp = isInAppBrowser();
  const [useOtp, setUseOtp] = useState(isInApp);
  const [otpStep, setOtpStep] = useState<'idle' | 'sent'>('idle');
  const [otpCode, setOtpCode] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpResendIn, setOtpResendIn] = useState(0);

  // Quando o login vem de um deep link de festival, mostra contexto do evento
  // pra reduzir confusão ("estou me inscrevendo em qual mostra?")
  const [eventContext, setEventContext] = useState<{ id: string; name: string; coverUrl: string | null } | null>(null);

  useEffect(() => {
    if (!redirectTo) { setEventContext(null); return; }
    // /festival/:id/... ou /evento/:idOrSlug
    const m = redirectTo.match(/^\/(?:festival|evento)\/([^/?#]+)/);
    if (!m) { setEventContext(null); return; }
    const idOrSlug = decodeURIComponent(m[1]);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const filterCol = isUuid ? 'id' : 'slug';
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id, name, cover_url')
        .eq(filterCol, idOrSlug)
        .maybeSingle();
      if (data?.id && data?.name) {
        setEventContext({ id: data.id, name: data.name, coverUrl: data.cover_url ?? null });
        // Funil de leads: persiste evento de origem antes do signup. Lido no
        // callback SIGNED_IN pra gravar em profiles.entry_event_id. Plano em
        // [[plano-leads-reengajamento]] — habilita email de reengajamento
        // contextualizado quando o lead não converte em N dias.
        try {
          localStorage.setItem('coreohub_lead_entry_event_id', data.id);
          localStorage.setItem('coreohub_lead_entry_at', String(Date.now()));
        } catch { /* localStorage off — ignora silenciosamente */ }
      }
    })();
  }, [redirectTo]);

  // Funil de leads: grava entry_source (UTM/referrer) — independente de
  // ter entry_event_id (lead pode chegar direto pela landing sem passar
  // pela vitrine de um evento). UPDATE só toca rows com entry_source IS NULL
  // → primeira sessão, idempotente. Best-effort silencioso (migration 20260617).
  const persistLeadEntrySource = async (userId: string, createdAtIso?: string) => {
    try {
      const entrySource = localStorage.getItem('coreohub_lead_entry_source');
      if (!entrySource) return;

      // Só associa em "primeira sessão" (< 10min de criação) — mesmo critério
      // do entry_event_id. Evita poluir fonte se user antigo re-loga vindo
      // de outra campanha.
      if (createdAtIso) {
        const ageMs = Date.now() - new Date(createdAtIso).getTime();
        if (ageMs > 10 * 60 * 1000) {
          localStorage.removeItem('coreohub_lead_entry_source');
          return;
        }
      }

      await supabase
        .from('profiles')
        .update({ entry_source: entrySource })
        .eq('id', userId)
        .is('entry_source', null);

      localStorage.removeItem('coreohub_lead_entry_source');
    } catch {
      /* best-effort */
    }
  };

  // Funil de leads: grava entry_event_id no profile quando user faz signup
  // vindo da vitrine pública. Só grava se:
  //   1) user foi criado recentemente (< 10min — heurística "primeira sessão")
  //   2) localStorage tem o evento de origem (salvo quando eventContext resolveu)
  //   3) profile.entry_event_id ainda está NULL (não sobrescreve em re-logins)
  // Não falha o flow de auth se algo der errado — best-effort silencioso.
  const persistLeadEntryEventId = async (userId: string, createdAtIso?: string) => {
    try {
      const entryEventId = localStorage.getItem('coreohub_lead_entry_event_id');
      if (!entryEventId) return;

      // Só associa em "primeira sessão" — evita sobrescrever lead antigo se
      // user já logado revisita a vitrine de outro evento e re-loga.
      if (createdAtIso) {
        const ageMs = Date.now() - new Date(createdAtIso).getTime();
        if (ageMs > 10 * 60 * 1000) {
          localStorage.removeItem('coreohub_lead_entry_event_id');
          localStorage.removeItem('coreohub_lead_entry_at');
          return;
        }
      }

      // UPDATE com filtro entry_event_id IS NULL → idempotente e não sobrescreve.
      await supabase
        .from('profiles')
        .update({ entry_event_id: entryEventId })
        .eq('id', userId)
        .is('entry_event_id', null);

      localStorage.removeItem('coreohub_lead_entry_event_id');
      localStorage.removeItem('coreohub_lead_entry_at');
    } catch {
      /* best-effort — não bloqueia signup se UPDATE falhar */
    }
  };

  // Decide a tela inicial pós-login com base no role do user. Produtor
  // (ORGANIZER) cai direto no /qg-organizador. Demais roles vão pro
  // /dashboard padrão. Lookup feito FORA do callback de onAuthStateChange
  // pra não deadlockar o lock interno do auth-js.
  const resolveLandingPath = async (userId: string): Promise<string> => {
    if (redirectTo) return redirectTo;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      return data?.role === 'ORGANIZER' ? '/qg-organizador' : '/dashboard';
    } catch {
      return '/dashboard';
    }
  };

  useEffect(() => {
    // Se a sessão já existe (callback OAuth processou os tokens do hash antes
    // do mount, ou o usuário já tinha login salvo), redireciona direto.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setIsAuthenticating(true);
        await persistLeadEntryEventId(session.user.id, session.user.created_at);
        await persistLeadEntrySource(session.user.id, session.user.created_at);
        const path = await resolveLandingPath(session.user.id);
        setTimeout(() => navigate(path), 0);
      }
    });

    // IMPORTANTE: o callback de onAuthStateChange NÃO pode usar await de queries
    // do Supabase (deadlock do lock interno de auth). O App.tsx já cuida de
    // getOrCreateProfile — aqui só navegamos após o SIGNED_IN.
    // Ref: https://github.com/supabase/auth-js/issues/762
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setIsAuthenticating(true);
        // setTimeout(..., 0) garante que o navigate roda fora do lock de auth.
        // resolveLandingPath roda DENTRO do timeout (não no callback) — sem deadlock.
        setTimeout(async () => {
          await persistLeadEntryEventId(session.user.id, session.user.created_at);
          await persistLeadEntrySource(session.user.id, session.user.created_at);
          const path = await resolveLandingPath(session.user.id);
          navigate(path);
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, redirectTo]);

  const handleGoogleSignIn = async () => {
    // Guard contra duplo-click: signInWithOAuth dispara redirect imediato.
    // Click 2x rápido criava 2 state tokens — Supabase rejeitava com
    // "Invalid state" no callback. Bloqueia durante isLoading/isAuthenticating.
    if (isLoading || isAuthenticating) return;
    setError(null);
    setIsLoading(true);
    try {
      // Pra preservar o redirectTo após login social, anexa como query string.
      const redirectUrl = `${window.location.origin}/login${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl },
      });
      if (error) throw error;
      // signInWithOAuth redireciona o usuário pra Google — não chega aqui.
    } catch (err: any) {
      setError(err.message ?? 'Não foi possível iniciar login com Google.');
      setIsLoading(false);
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setEmailSuggestion(suggestEmail(value));
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setRecoveryNotice(null);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // A4: safety timeout — SIGNED_IN listener navega; se falhar, libera o spinner.
        setTimeout(() => setIsLoading(false), 5000);
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: email.split('@')[0],
            },
            // Após confirmar, redireciona pra dashboard (ou redirectTo se vier de checkout).
            emailRedirectTo: `${window.location.origin}${redirectTo || '/dashboard'}`,
          },
        });
        if (signUpError) throw signUpError;

        // Padrão Stripe/Sympla: tenta logar imediatamente após criar conta.
        // Se confirmação de e-mail está OFF (Supabase config), entra direto.
        // Se ON, signIn falha com "Email not confirmed" — aí avisamos sem bloquear UX.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (!signInError) {
          // SIGNED_IN listener no useEffect já navega pra dashboard.
          // A4: safety timeout — se navigate falhar (rota destino com RLS error
          // ou redirect loop), libera o spinner em 5s pra usuário não travar.
          setTimeout(() => setIsLoading(false), 5000);
          return;
        }
        if (signInError.message?.toLowerCase().includes('email not confirmed')) {
          setRecoveryNotice('Conta criada! Confirme seu e-mail pra ativar o acesso. Já enviamos o link.');
          setIsLoading(false);
          return;
        }
        throw signInError;
      }
    } catch (err: any) {
      let message = 'Erro na autenticação. Verifique suas credenciais.';
      if (err.message === 'Invalid login credentials') message = 'E-mail ou senha incorretos.';
      if (err.message === 'User already registered') message = 'Este e-mail já está cadastrado.';
      if (err.message === 'Password should be at least 6 characters') message = 'A senha deve ter pelo menos 6 caracteres.';

      setError(message);
      setIsLoading(false);
    }
  };

  /**
   * Magic link como recovery — Q2.6 da pesquisa de mercado. Padrão Stripe:
   * envia link por e-mail que loga + vai pra reset de senha. Não é fluxo
   * de signup, é só recuperação.
   */
  const handlePasswordRecovery = async () => {
    setError(null);
    setRecoveryNotice(null);
    if (!email) {
      setError('Digite seu e-mail antes de recuperar a senha.');
      return;
    }
    setRecoveryLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      setRecoveryNotice('Link de recuperação enviado pro seu e-mail. Verifique também a caixa de spam.');
    } catch (err: any) {
      setError(err.message ?? 'Não foi possível enviar o link de recuperação.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Cooldown do botão de reenvio de código.
  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = setTimeout(() => setOtpResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendIn]);

  /**
   * Envia o e-mail de acesso (OTP). O auth-email-hook já manda link mágico +
   * código de 6 dígitos no MESMO e-mail. shouldCreateUser:true → serve login
   * E cadastro (bailarino novo vindo do Instagram não precisa criar senha).
   * emailRedirectTo preserva o festival de destino quando o link é aberto no
   * navegador padrão do celular (escapando da webview do Instagram).
   */
  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setOtpError(null);
    const mail = email.trim();
    if (!mail) { setOtpError('Digite seu e-mail.'); return; }
    setOtpLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/login${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: mail,
        options: { emailRedirectTo: redirectUrl, shouldCreateUser: true },
      });
      if (error) throw error;
      setOtpEmail(mail);
      setOtpStep('sent');
      setOtpResendIn(45);
    } catch (err: any) {
      setOtpError(err.message ?? 'Não foi possível enviar o e-mail. Tente de novo.');
    } finally {
      setOtpLoading(false);
    }
  };

  /** Verifica o código de 6 dígitos. Sucesso → SIGNED_IN listener navega. */
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setOtpError(null);
    const token = otpCode.replace(/\D/g, '');
    if (token.length < 6) { setOtpError('Digite o código que chegou no e-mail.'); return; }
    setOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: otpEmail, token, type: 'email' });
      if (error) throw error;
      setIsAuthenticating(true);
      // onAuthStateChange (SIGNED_IN) cuida do redirect — mantém o spinner.
      // Safety (mesmo padrão do handleAuth): se o navigate não disparar
      // (RLS/redirect loop), libera o spinner em 5s pra não travar o usuário.
      setTimeout(() => { setOtpLoading(false); setIsAuthenticating(false); }, 5000);
    } catch (err: any) {
      const raw = err.message ?? '';
      setOtpError(
        /expire|invalid|token/i.test(raw)
          ? 'Código inválido ou expirado. Peça um novo.'
          : (raw || 'Não foi possível validar o código.'),
      );
      setOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans transition-colors">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.1),transparent_70%)]" />
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#ff0068]/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-[#ff0068]/10 blur-[120px] rounded-full" />

      {/* Voltar pra site institucional — escape route padrão Stripe/GitHub/Vercel */}
      <a
        href="https://coreohub.com"
        className="absolute top-5 left-5 z-20 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-[#ff0068] transition-colors"
      >
        <ArrowRight size={12} className="rotate-180" />
        Voltar para coreohub.com
      </a>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            className="inline-flex items-center justify-center mb-3"
          >
            <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-16 h-16 drop-shadow-[0_0_20px_rgba(255,0,104,0.5)]" />
          </motion.div>

          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic leading-none">
            Coreo<span className="text-[#ff0068]">Hub</span>
          </h1>
          <p className="text-slate-400 dark:text-slate-500 font-black text-[10px] uppercase tracking-[0.4em] mt-3">
            Gestão Inteligente para Festivais de Dança
          </p>
        </div>

        {eventContext && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-2xl border border-[#ff0068]/30 bg-[#ff0068]/5 overflow-hidden"
          >
            {eventContext.coverUrl && (
              <div className="h-20 w-full overflow-hidden">
                <img src={eventContext.coverUrl} alt={eventContext.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="px-4 py-3 flex flex-col items-center text-center gap-1">
              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-[#ff0068]">
                Você está se inscrevendo em
              </span>
              <span className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
                {eventContext.name}
              </span>
            </div>
          </motion.div>
        )}

        <div className="bg-white dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-white/10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#ff0068] to-transparent opacity-50" />

          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {useOtp ? 'Entrar com e-mail' : authMode === 'login' ? 'Acesse sua conta' : 'Comece sua Jornada'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest">
                {useOtp ? 'Sem senha — enviamos um link e um código' : authMode === 'login' ? 'Entre com seu e-mail e senha' : 'Crie seu perfil de acesso'}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl text-rose-500 text-[10px] font-black uppercase tracking-widest text-center"
                >
                  {error}
                </motion.div>
              )}
              {recoveryNotice && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl text-emerald-600 dark:text-emerald-400 text-[11px] font-bold text-center flex items-start gap-2"
                >
                  <CheckCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{recoveryNotice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Login por e-mail (OTP) — caminho dentro de webview ── */}
            {useOtp && (
              <div className="space-y-5">
                {otpStep === 'idle' ? (
                  <form onSubmit={handleSendOtp} className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-4">E-mail</label>
                      <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#ff0068] transition-colors">
                          <Mail size={16} />
                        </div>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => handleEmailChange(e.target.value)}
                          placeholder="seu@email.com"
                          className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-6 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all font-bold shadow-sm"
                        />
                      </div>
                      {emailSuggestion && (
                        <button
                          type="button"
                          onClick={() => { setEmail(emailSuggestion); setEmailSuggestion(null); }}
                          className="ml-4 text-[10px] text-amber-600 dark:text-amber-400 font-bold hover:underline text-left"
                        >
                          Você quis dizer <span className="text-[#ff0068] font-black">{emailSuggestion}</span>?
                        </button>
                      )}
                    </div>

                    {otpError && (
                      <div role="alert" className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-2xl text-rose-500 text-[10px] font-black uppercase tracking-widest text-center">
                        {otpError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={otpLoading || isAuthenticating}
                      className="w-full group relative flex items-center justify-center gap-3 bg-[#ff0068] text-white font-black uppercase tracking-widest text-[10px] py-3.5 rounded-2xl transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,0,104,0.4)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {otpLoading ? (
                        <><Loader2 className="animate-spin" size={18} /><span>Enviando...</span></>
                      ) : (
                        <><span>Receber acesso por e-mail</span><ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" /></>
                      )}
                    </button>

                    <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center font-bold normal-case leading-relaxed px-2">
                      Enviamos um link de acesso e um código. Sem senha pra criar ou lembrar.
                    </p>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} className="space-y-5">
                    <div className="text-center space-y-2">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 mb-1">
                        <Mail size={20} />
                      </div>
                      <p className="text-sm font-black text-slate-900 dark:text-white normal-case">
                        Enviamos um e-mail pra<br /><span className="text-[#ff0068]">{otpEmail}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold normal-case leading-relaxed px-2">
                        Toque em <strong>Entrar agora</strong> no e-mail pra logar direto, ou digite o código do e-mail abaixo.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="otp-code" className="text-[10px] font-black uppercase tracking-widest text-slate-500 text-center block">Código</label>
                      <input
                        id="otp-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]*"
                        maxLength={10}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="Código do e-mail"
                        autoFocus
                        className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 px-6 text-center text-xl font-black tracking-[0.2em] text-slate-900 dark:text-white placeholder:text-sm placeholder:tracking-normal placeholder:font-bold placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all shadow-sm"
                      />
                    </div>

                    {otpError && (
                      <div role="alert" className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-2xl text-rose-500 text-[10px] font-black uppercase tracking-widest text-center">
                        {otpError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={otpLoading || isAuthenticating || otpCode.length < 6}
                      className="w-full group relative flex items-center justify-center gap-3 bg-[#ff0068] text-white font-black uppercase tracking-widest text-[10px] py-3.5 rounded-2xl transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,0,104,0.4)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {otpLoading || isAuthenticating ? (
                        <><Loader2 className="animate-spin" size={18} /><span>{isAuthenticating ? 'Entrando...' : 'Validando...'}</span></>
                      ) : (
                        <><span>Entrar</span><ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" /></>
                      )}
                    </button>

                    <div className="flex items-center justify-between px-1">
                      <button
                        type="button"
                        onClick={() => { setOtpStep('idle'); setOtpCode(''); setOtpError(null); }}
                        className="text-[10px] font-bold text-slate-400 hover:text-[#ff0068] transition-colors"
                      >
                        Trocar e-mail
                      </button>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={otpResendIn > 0 || otpLoading}
                        className="text-[10px] font-bold text-slate-400 hover:text-[#ff0068] transition-colors disabled:opacity-50"
                      >
                        {otpResendIn > 0 ? `Reenviar em ${otpResendIn}s` : 'Reenviar código'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {!useOtp && (
            <form onSubmit={handleAuth} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-4">E-mail</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#ff0068] transition-colors">
                    <Mail size={16} />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-6 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all font-bold shadow-sm"
                  />
                </div>
                {/* Mailcheck: sugestão de typo (gmial.com → gmail.com). Padrão Mailcheck.js. */}
                {emailSuggestion && (
                  <button
                    type="button"
                    onClick={() => { setEmail(emailSuggestion); setEmailSuggestion(null); }}
                    className="ml-4 text-[10px] text-amber-600 dark:text-amber-400 font-bold hover:underline text-left"
                  >
                    Você quis dizer <span className="text-[#ff0068] font-black">{emailSuggestion}</span>?
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-4">Senha</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-[#ff0068] transition-colors">
                    <Lock size={16} />
                  </div>
                  <input
                    ref={passwordRef}
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-6 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all font-bold shadow-sm"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-2">
                <button
                  type="submit"
                  disabled={isLoading || isAuthenticating}
                  className="w-full group relative flex items-center justify-center gap-3 bg-[#ff0068] text-white font-black uppercase tracking-widest text-[10px] py-3.5 rounded-2xl transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,0,104,0.4)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                >
                  {isLoading || isAuthenticating ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin" size={20} />
                      <span>{isAuthenticating ? 'Autenticando...' : 'Processando...'}</span>
                    </div>
                  ) : (
                    <>
                      <span>{authMode === 'login' ? 'Entrar' : 'Criar Minha Conta'}</span>
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </form>
            )}

            {/* Divisor + Login social — escondido dentro de webview (Instagram/
                Facebook/TikTok) porque o OAuth do Google quebra em in-app
                browser (403 disallowed_useragent). Lá usamos OTP por e-mail. */}
            {!isInApp && !useOtp && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">ou</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading || isAuthenticating}
                className="w-full flex items-center justify-center gap-3 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-black uppercase tracking-widest text-[10px] py-3.5 rounded-2xl transition-all hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-400 dark:hover:border-white/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continuar com Google
              </button>
            </div>
            )}

            <div className="pt-4 flex flex-col items-center gap-3">
              {/* Dentro de webview (Instagram/Facebook/TikTok) o Google quebra,
                  então alternamos entre OTP por e-mail e e-mail+senha. */}
              {isInApp && (
                <button
                  type="button"
                  onClick={() => { setUseOtp((v) => !v); setOtpStep('idle'); setOtpCode(''); setOtpError(null); }}
                  className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline transition-colors"
                >
                  {useOtp ? 'Prefiro entrar com e-mail e senha' : 'Entrar sem senha (código por e-mail)'}
                </button>
              )}

              {!useOtp && (
                <button
                  onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#ff0068] transition-colors"
                >
                  {authMode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
                </button>
              )}

              {/* Esqueci a senha — magic link como recovery (não signup).
                  Padrão Stripe Q2.6 da pesquisa de mercado. */}
              {!useOtp && authMode === 'login' && (
                <button
                  type="button"
                  onClick={handlePasswordRecovery}
                  disabled={recoveryLoading}
                  className="text-[10px] font-bold text-slate-400 hover:text-[#ff0068] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {recoveryLoading && <Loader2 size={10} className="animate-spin" />}
                  Esqueci a senha — receber link por e-mail
                </button>
              )}

              <div className="h-3" />

              <div className="flex items-center gap-2 text-slate-300 dark:text-slate-700">
                <ShieldCheck size={14} />
                <span className="text-[8px] font-black uppercase tracking-[0.2em]">Ambiente Seguro & Criptografado</span>
              </div>

              {/* Selo Asaas — exigência regulatória do BaaS (Resolução Conjunta nº 16/2025).
                  Obrigatório em telas de cadastro/login conforme Playbook Asaas.
                  Polimento 2026-05-20: 100x30 (proporção 3.3:1 preservada) + microcopy
                  "Pagamentos via". Light usa mono (preto sobre claro), dark usa
                  negative (branco sobre escuro) — ambas variantes oficiais Asaas. */}
              <div className="flex flex-col items-center gap-1.5 pt-2">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Pagamentos via
                </span>
                <div className="dark:hidden">
                  <AsaasBadge variant="compact" theme="mono" width={100} height={30} />
                </div>
                <div className="hidden dark:block">
                  <AsaasBadge variant="compact" theme="negative" width={100} height={30} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 flex items-center justify-center gap-8 text-slate-400 dark:text-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles size={14} />
            <span className="text-[9px] font-black uppercase tracking-widest italic">CoreoHub Platform</span>
          </div>
          <div className="w-1 h-1 bg-slate-300 dark:bg-slate-900 rounded-full" />
          <span className="text-[9px] font-black uppercase tracking-widest">© 2026</span>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
