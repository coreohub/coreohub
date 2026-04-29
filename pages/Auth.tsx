import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, Loader2, Mail, Lock, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>(
    location.state?.redirectTo ? 'signup' : 'login'
  );

  // Suporta redirectTo via location.state (PrivateRoute) OU query string (após
  // OAuth callback do Google que perde o state mas mantém URL).
  const queryParams = new URLSearchParams(location.search);
  const redirectTo = location.state?.redirectTo ?? queryParams.get('redirectTo');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Se a sessão já existe (callback OAuth processou os tokens do hash antes
    // do mount, ou o usuário já tinha login salvo), redireciona direto.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsAuthenticating(true);
        setTimeout(() => navigate(redirectTo || '/dashboard'), 0);
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
        setTimeout(() => {
          navigate(redirectTo || '/dashboard');
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, redirectTo]);

  const handleGoogleSignIn = async () => {
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: email.split('@')[0],
            }
          }
        });
        if (error) throw error;
        if (authMode === 'signup') {
          setError('Conta criada! Verifique seu e-mail para confirmar (se necessário) ou faça login.');
          setIsLoading(false);
        }
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden font-sans transition-colors">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.1),transparent_70%)]" />
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#ff0068]/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-[#ff0068]/10 blur-[120px] rounded-full" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10"
      >
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            className="inline-flex items-center justify-center mb-4"
          >
            <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-20 h-20 drop-shadow-[0_0_20px_rgba(255,0,104,0.5)]" />
          </motion.div>

          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic leading-none">
            Coreo<span className="text-[#ff0068]">Hub</span>
          </h1>
          <p className="text-slate-400 dark:text-slate-500 font-black text-[10px] uppercase tracking-[0.4em] mt-4">
            Gestão Inteligente para Festivais de Dança
          </p>
        </div>

        <div className="bg-white dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-200 dark:border-white/10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#ff0068] to-transparent opacity-50" />

          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {authMode === 'login' ? 'Bem-vindo de Volta' : 'Comece sua Jornada'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest">
                {authMode === 'login' ? 'Acesse sua conta' : 'Crie seu perfil de acesso'}
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
            </AnimatePresence>

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
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-6 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all font-bold shadow-sm"
                  />
                </div>
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
                      <span>{authMode === 'login' ? 'Entrar no Palco' : 'Criar Minha Conta'}</span>
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Divisor + Login social */}
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

            <div className="pt-4 flex flex-col items-center gap-6">
              <button
                onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#ff0068] transition-colors"
              >
                {authMode === 'login' ? 'Não tem conta? Criar Nova Conta' : 'Já tem conta? Entrar'}
              </button>

              <div className="flex items-center gap-2 text-slate-300 dark:text-slate-700">
                <ShieldCheck size={14} />
                <span className="text-[8px] font-black uppercase tracking-[0.2em]">Ambiente Seguro & Criptografado</span>
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
