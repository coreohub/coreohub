import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Crown, Loader2, AlertCircle, CheckCircle, ArrowRight, Lock, Mail, User, Sparkles,
} from 'lucide-react';

const OnboardingWizard = lazy(() => import('../components/OnboardingWizard'));

type AuthStatus = 'loading' | 'anon' | 'ready';

const CriarEventoGate: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('anon'); return; }

      const user = session.user;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, full_name, avatar_url, email')
        .eq('id', user.id)
        .maybeSingle();

      // Login social (Google) traz full_name + avatar_url no user_metadata.
      // Preenche profile na primeira vez ou se ainda não tem nome/avatar.
      const meta: any = user.user_metadata ?? {};
      const fullNameFromProvider = meta.full_name ?? meta.name ?? null;
      const avatarFromProvider   = meta.avatar_url ?? meta.picture ?? null;

      if (!profile) {
        // Primeiro login (via Google geralmente) — cria profile com role ORGANIZER
        await supabase.from('profiles').insert({
          id:         user.id,
          email:      user.email ?? '',
          full_name:  fullNameFromProvider ?? '',
          avatar_url: avatarFromProvider,
          role:       'ORGANIZER',
        });
      } else {
        const updates: Record<string, any> = {};
        if (profile.role !== 'ORGANIZER' && profile.role !== 'COREOHUB_ADMIN') {
          updates.role = 'ORGANIZER';
        }
        if (!profile.full_name && fullNameFromProvider)  updates.full_name  = fullNameFromProvider;
        if (!profile.avatar_url && avatarFromProvider)   updates.avatar_url = avatarFromProvider;
        if (Object.keys(updates).length > 0) {
          await supabase.from('profiles').update(updates).eq('id', user.id);
        }
      }
      setStatus('ready');
    };
    check();
  }, []);

  const handleSignup = async () => {
    setFormError(null);
    if (!form.full_name.trim()) { setFormError('Informe seu nome completo.'); return; }
    if (!form.email.trim() || !form.email.includes('@')) { setFormError('E-mail inválido.'); return; }
    if (form.password.length < 6) { setFormError('A senha deve ter ao menos 6 caracteres.'); return; }

    setSubmitting(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email:    form.email,
        password: form.password,
        options:  { data: { full_name: form.full_name } },
      });
      if (authError) throw authError;
      if (!data.user) throw new Error('Não foi possível criar a conta.');

      await supabase.from('profiles').upsert({
        id:        data.user.id,
        full_name: form.full_name,
        email:     form.email,
        role:      'ORGANIZER',
      }, { onConflict: 'id' });

      try {
        await supabase.functions.invoke('send-email', {
          body: {
            type: 'producer_welcome',
            payload: {
              produtorNome:  form.full_name,
              produtorEmail: form.email,
              appUrl:        window.location.origin,
            },
          },
        });
      } catch {  }

      setStatus('ready');
    } catch (e: any) {
      setFormError(
        e.message?.includes('already registered') || e.message?.includes('User already')
          ? 'Já existe uma conta com este e-mail. Faça login.'
          : (e.message ?? 'Erro ao criar conta.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Login social (Google) — useEffect do Gate detecta SIGNED_IN no callback
  // e promove user pra ORGANIZER automaticamente.
  const handleGoogleSignup = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/criar-evento` },
      });
      if (error) throw error;
    } catch (e: any) {
      setFormError(e?.message ?? 'Erro ao iniciar login com Google.');
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <Loader2 size={32} className="animate-spin text-[#ff0068]" />
        </div>
      }>
        <OnboardingWizard />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#e3ff0a]/10 border border-[#e3ff0a]/20">
            <Sparkles size={12} className="text-[#e3ff0a]" />
            <span className="text-[9px] font-black text-[#e3ff0a] uppercase tracking-[0.3em]">Cadastro de Produtor</span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Bem-vindo ao <span className="text-[#ff0068] italic">CoreoHub</span>
          </h1>
          <p className="text-xs text-slate-500 font-bold leading-relaxed">
            Crie sua conta de produtor para cadastrar seu festival.<br />
            Inscrições, pagamentos com split automático e muito mais.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5 shadow-sm">
          <Field icon={User} label="Nome completo">
            <input
              type="text"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Seu nome"
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
            />
          </Field>

          <Field icon={Mail} label="E-mail">
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="seu@email.com"
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
            />
          </Field>

          <Field icon={Lock} label="Crie uma senha">
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Mínimo 6 caracteres"
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
            />
          </Field>

          {formError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
            </div>
          )}

          <button
            onClick={handleSignup}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={16} /> Criar conta <ArrowRight size={14} /></>}
          </button>

          {/* Divisor + Google */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">ou</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
          </div>
          <button
            onClick={handleGoogleSignup}
            disabled={submitting}
            type="button"
            className="w-full flex items-center justify-center gap-3 py-4 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuar com Google
          </button>

          <p className="text-[10px] text-center text-slate-400 leading-relaxed">
            Ao criar a conta, você passa por 4 passos rápidos pra colocar sua mostra no ar.
          </p>
        </div>

        <p className="text-center text-[10px] text-slate-400">
          Já tem conta?{' '}
          <button onClick={() => navigate('/login')} className="text-[#ff0068] font-bold">Faça login</button>
        </p>
      </div>
    </div>
  );
};

const Field: React.FC<{ icon: any; label: string; children: React.ReactNode }> = ({ icon: Icon, label, children }) => (
  <div>
    <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
      <Icon size={11} /> {label}
    </label>
    {children}
  </div>
);

export default CriarEventoGate;
