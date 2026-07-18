import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { OtpBoxes } from '../components/OtpBoxes';
import {
  getTeamInviteByToken,
  type TeamInvite,
} from '../services/teamInviteService';
import { resolveFirstEquipeRoute } from '../utils/permMenu';
import {
  Users, Loader2, AlertCircle, CheckCircle, ArrowRight, Mail, User as UserIcon,
} from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
  COORDENADOR: 'Coordenador',
  MESARIO:     'Coordenador do Júri',
  SONOPLASTA:  'Sonoplasta',
  RECEPCAO:    'Recepção / Palco',
  PALCO:       'Marcador de Palco',
};

// Convite de equipe via código por e-mail (OTP), sem senha — mesmo padrão
// Slack/Notion/Linear: o código verificado JÁ é login + confirmação de
// e-mail + aceite do convite, tudo em 1 passo. Evita a dupla-fricção de
// senha + confirmação por e-mail separada (que travava quando o convidado
// já tinha conta, ou quando o e-mail de confirmação atrasava/repetia).
const TeamInviteLanding = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite]   = useState<TeamInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [step, setStep] = useState<'otp-sent' | 'code' | 'name'>('otp-sent');
  const [otpCode, setOtpCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [sending, setSending]   = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

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
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const sendOtp = async (inv: TeamInvite) => {
    setSending(true);
    setFormError(null);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: inv.email,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;
      setStep('code');
      setResendIn(45);
    } catch (e: any) {
      setFormError(e.message ?? 'Não foi possível enviar o código. Tente de novo.');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (invite) sendOtp(invite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // profiles.role só pode ser alterado por service_role/super admin (trigger
  // protect_profiles_privileged_columns, migration 20260509) — um UPDATE
  // direto do client (mesmo sendo o próprio dono da linha) é silenciosamente
  // revertido. Por isso a aplicação do convite passa pela Edge Function
  // apply-team-invite, que roda com service_role.
  const applyInvite = async () => {
    if (!token) return;
    const { error: fnError } = await supabase.functions.invoke('apply-team-invite', { body: { token } });
    if (fnError) throw fnError;
  };

  const finishAfterAuth = async () => {
    // Nome só é pedido se o profile ainda não tiver um (conta nova).
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user?.id ?? '')
      .maybeSingle();

    await applyInvite();

    if (!profile?.full_name?.trim()) {
      setStep('name');
      return;
    }
    navigate(landingPathAfterInvite());
  };

  // Mesma lógica do redirect de login (Auth.tsx) — manda o novo membro pra
  // primeira rota que a permissão dele já libera, em vez de /dashboard (tela
  // de inscrito). Usa invite.permissoes_custom em vez de reler o profile:
  // applyInvite() acabou de gravar exatamente esse valor via service_role.
  const landingPathAfterInvite = () =>
    (invite && resolveFirstEquipeRoute(invite.permissoes_custom)) ?? '/dashboard?welcome=team';

  const handleVerifyOtp = async (code?: string) => {
    if (!invite) return;
    const value = (code ?? otpCode).replace(/\D/g, '');
    if (value.length < 6) { setFormError('Digite o código que chegou no e-mail.'); return; }
    setVerifying(true);
    setFormError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: invite.email, token: value, type: 'email',
      });
      if (verifyError) throw verifyError;
      await finishAfterAuth();
    } catch (e: any) {
      const raw = e.message ?? '';
      setFormError(/expire|invalid|token/i.test(raw) ? 'Código inválido ou expirado. Peça um novo.' : (raw || 'Não foi possível validar o código.'));
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveName = async () => {
    if (!fullName.trim()) { setFormError('Informe seu nome completo.'); return; }
    setSavingName(true);
    setFormError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada. Recarregue a página.');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', user.id);
      if (updateError) throw updateError;
      navigate(landingPathAfterInvite());
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSavingName(false);
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
          {step === 'otp-sent' && (
            <div className="text-center py-6 space-y-3">
              {sending ? (
                <>
                  <Loader2 size={28} className="animate-spin text-[#ff0068] mx-auto" />
                  <p className="text-xs text-slate-500 font-bold">Enviando código pro seu e-mail...</p>
                </>
              ) : (
                <>
                  <AlertCircle size={28} className="text-amber-400 mx-auto" />
                  <p className="text-xs text-red-600 dark:text-red-400 font-bold px-4">{formError ?? 'Não foi possível enviar o código.'}</p>
                  <button
                    onClick={() => invite && sendOtp(invite)}
                    className="px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all"
                  >
                    Tentar de novo
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'code' && invite && (
            <div className="space-y-5">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 mb-1">
                  <Mail size={20} />
                </div>
                <p className="text-sm font-black text-slate-900 dark:text-white normal-case">
                  Enviamos um código pra<br /><span className="text-[#ff0068]">{invite.email}</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold normal-case leading-relaxed px-2">
                  Digite o código de 6 dígitos que chegou no e-mail.
                </p>
              </div>

              <OtpBoxes
                value={otpCode}
                onChange={setOtpCode}
                onComplete={(v) => handleVerifyOtp(v)}
                autoFocus
                disabled={verifying}
              />

              {formError && (
                <div role="alert" className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
                </div>
              )}

              <button
                onClick={() => handleVerifyOtp()}
                disabled={verifying || otpCode.length < 6}
                className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
              >
                {verifying ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={16} /> Entrar na equipe <ArrowRight size={14} /></>}
              </button>

              <button
                type="button"
                onClick={() => sendOtp(invite)}
                disabled={resendIn > 0 || sending}
                className="w-full text-[10px] font-bold text-slate-400 hover:text-[#ff0068] transition-colors disabled:opacity-50"
              >
                {resendIn > 0 ? `Reenviar código em ${resendIn}s` : 'Reenviar código'}
              </button>
            </div>
          )}

          {step === 'name' && (
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <p className="text-sm font-black text-slate-900 dark:text-white uppercase">Só mais um passo</p>
                <p className="text-[11px] text-slate-500 font-bold normal-case">Como podemos te chamar?</p>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  <UserIcon size={11} /> Nome completo
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Seu nome"
                  autoFocus
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
                </div>
              )}

              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
              >
                {savingName ? <Loader2 size={16} className="animate-spin" /> : <>Concluir <ArrowRight size={14} /></>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamInviteLanding;
