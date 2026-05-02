import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  getTeamInviteByToken,
  markTeamInviteUsed,
  type TeamInvite,
} from '../services/teamInviteService';
import {
  Users, Loader2, AlertCircle, CheckCircle, ArrowRight, Lock, Mail, User as UserIcon,
} from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
  COORDENADOR: 'Coordenador',
  MESARIO:     'Coordenador do Júri',
  SONOPLASTA:  'Sonoplasta',
  RECEPCAO:    'Recepção / Palco',
  PALCO:       'Marcador de Palco',
};

const TeamInviteLanding = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite]   = useState<TeamInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) { setError('Token de convite ausente.'); setLoading(false); return; }
      try {
        const inv = await getTeamInviteByToken(token);
        if (!inv) {
          setError('Convite inválido, expirado ou já utilizado.');
        } else if (new Date(inv.expires_at).getTime() < Date.now()) {
          setError('Este convite expirou. Peça um novo ao produtor.');
        } else {
          setInvite(inv);
          setForm(f => ({ ...f, email: inv.email, full_name: inv.full_name ?? '' }));
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const applyInvite = async (userId: string) => {
    if (!invite) return;
    await supabase
      .from('profiles')
      .upsert({
        id:                userId,
        full_name:         form.full_name,
        email:             form.email,
        role:              invite.role,
        cargo:             invite.cargo,
        permissoes_custom: invite.permissoes_custom,
      }, { onConflict: 'id' });
    if (token) await markTeamInviteUsed(token, userId);
  };

  const handleSignup = async () => {
    if (!invite) return;
    setFormError(null);
    if (!form.full_name.trim()) { setFormError('Informe seu nome completo.'); return; }
    if (form.password.length < 6) { setFormError('A senha deve ter ao menos 6 caracteres.'); return; }
    setSubmitting(true);
    try {
      // Tenta signup; se já existe, faz signIn
      const { data, error: authError } = await supabase.auth.signUp({
        email:    form.email,
        password: form.password,
        options:  { data: { full_name: form.full_name } },
      });
      let userId = data?.user?.id ?? null;

      if (authError && authError.message.toLowerCase().includes('already')) {
        const { data: signin, error: signinError } = await supabase.auth.signInWithPassword({
          email:    form.email,
          password: form.password,
        });
        if (signinError) throw new Error('Já existe conta com este e-mail. Senha incorreta.');
        userId = signin.user?.id ?? null;
      } else if (authError) {
        throw authError;
      }

      if (!userId) throw new Error('Não foi possível autenticar.');
      await applyInvite(userId);
      navigate('/dashboard?welcome=team');
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-[#ff0068]" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <div className="text-center space-y-3 max-w-sm">
        <AlertCircle size={40} className="text-amber-400 mx-auto" />
        <p className="font-black text-xl text-slate-900 dark:text-white uppercase italic">Convite Indisponível</p>
        <p className="text-slate-500 text-sm">{error}</p>
        <button onClick={() => navigate('/login')} className="text-[#ff0068] text-sm font-bold mx-auto block">
          Ir para o login
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ff0068]/10 border border-[#ff0068]/20">
            <Users size={12} className="text-[#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">
              Convite de equipe
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Bem-vindo ao <span className="text-[#ff0068] italic">CoreoHub</span>
          </h1>
          {invite && (
            <p className="text-xs text-slate-500 font-bold">
              Você foi convidado como{' '}
              <span className="text-[#ff0068]">{ROLE_LABEL[invite.role] ?? invite.role}</span>
              {invite.cargo && <> — {invite.cargo}</>}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5 shadow-sm">
          <Field icon={UserIcon} label="Nome completo">
            <input
              type="text"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Seu nome"
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
            />
          </Field>

          <Field icon={Mail} label="E-mail (do convite)">
            <input
              type="email"
              value={form.email}
              disabled
              className="w-full bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-600 dark:text-slate-400 cursor-not-allowed"
            />
          </Field>

          <Field icon={Lock} label="Crie uma senha (ou use a existente)">
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
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={16} /> Entrar na equipe <ArrowRight size={14} /></>}
          </button>

          <div className="text-[10px] text-center text-slate-400 leading-relaxed">
            Se você já tem conta no CoreoHub, use a mesma senha — você será automaticamente promovido a membro da equipe.
          </div>
        </div>
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

export default TeamInviteLanding;
