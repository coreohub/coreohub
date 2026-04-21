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

  const redirectTo = location.state?.redirectTo;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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
            className="inline-flex items-center justify-center w-16 h-16 bg-[#ff0068] rounded-2xl shadow-[0_0_30px_rgba(255,0,104,0.4)] mb-4"
          >
            <Zap size={32} className="text-white fill-white" />
          </motion.div>

          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic leading-none">
            Dance Pró <span className="text-[#ff0068]">Festival</span>
          </h1>
          <p className="text-slate-400 dark:text-slate-500 font-black text-[10px] uppercase tracking-[0.4em] mt-4">
            A Elite da Dança Digital
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
            <span className="text-[9px] font-black uppercase tracking-widest italic">Dance Pró Ecosystem</span>
          </div>
          <div className="w-1 h-1 bg-slate-300 dark:bg-slate-900 rounded-full" />
          <span className="text-[9px] font-black uppercase tracking-widest">© 2026</span>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
