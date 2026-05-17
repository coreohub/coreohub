/**
 * Gate de MFA pro painel /super-admin.
 *
 * 3 estados possíveis:
 * 1. AAL2 já — passa transparente, renderiza children
 * 2. Tem fator TOTP verified mas sessão AAL1 — desafio: pede 6 dígitos
 * 3. Sem fator algum — enroll: QR code + confirma 6 dígitos
 *
 * Bloqueia render do painel até user passar pelo fluxo. Sem bypass.
 *
 * Decisão arquitetural: gate vive aqui no client por simplicidade.
 * Defesa em profundidade adicional: a função `is_super_admin(uid)` no DB
 * passa a checar `auth.jwt() ->> 'aal' = 'aal2'`, então mesmo que alguém
 * burle o frontend, RLS bloqueia queries sensíveis sem 2FA.
 */

import { useEffect, useState } from 'react';
import { ShieldCheck, Smartphone, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import {
  isAal2,
  hasVerifiedTotp,
  startTotpEnroll,
  verifyTotpEnroll,
  listMfaFactors,
  createChallenge,
  verifyChallenge,
  type EnrollResult,
} from '../services/mfaService';

type GateState = 'loading' | 'enroll' | 'challenge' | 'authorized';

interface Props {
  children: React.ReactNode;
}

export default function SuperAdminMfaGate({ children }: Props) {
  const [state, setState] = useState<GateState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enroll flow
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);

  // Challenge flow
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeCode, setChallengeCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const aal2 = await isAal2();
        if (cancelled) return;
        if (aal2) { setState('authorized'); return; }

        const has = await hasVerifiedTotp();
        if (cancelled) return;
        if (has) {
          // Tem fator mas sessão é AAL1 — desafiar
          const factors = await listMfaFactors();
          const verified = factors.find(f => f.status === 'verified');
          if (verified) {
            setFactorId(verified.id);
            setState('challenge');
          } else {
            setState('enroll');
          }
        } else {
          setState('enroll');
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'Falha ao verificar MFA');
        setState('enroll');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleStartEnroll = async () => {
    setBusy(true); setError(null);
    try {
      const result = await startTotpEnroll();
      setEnrollResult(result);
    } catch (e: any) {
      setError(e?.message ?? 'Falha ao iniciar enroll. Confirma que MFA está habilitado no Supabase.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmEnroll = async () => {
    if (!enrollResult || enrollCode.length !== 6) return;
    setBusy(true); setError(null);
    try {
      await verifyTotpEnroll(enrollResult.factorId, enrollCode);
      // Verify automaticamente sobe a sessão pra AAL2 — autoriza direto.
      setState('authorized');
    } catch (e: any) {
      setError(e?.message?.includes('Invalid') ? 'Código inválido. Tenta de novo.' : (e?.message ?? 'Falha ao verificar código.'));
      setEnrollCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmChallenge = async () => {
    if (!factorId || challengeCode.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const challengeId = await createChallenge(factorId);
      await verifyChallenge(factorId, challengeId, challengeCode);
      setState('authorized');
    } catch (e: any) {
      setError(e?.message?.includes('Invalid') ? 'Código inválido. Tenta de novo.' : (e?.message ?? 'Falha ao verificar código.'));
      setChallengeCode('');
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!enrollResult) return;
    try {
      await navigator.clipboard.writeText(enrollResult.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2500);
    } catch { /* navegador sem clipboard — ignora */ }
  };

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (state === 'authorized') {
    return <>{children}</>;
  }

  // ── Enroll (1ª vez) ─────────────────────────────────────────────────
  if (state === 'enroll') {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><ShieldCheck size={20} /></div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Ative o 2FA</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            O painel de Super Admin exige autenticação de 2 fatores. Use um app autenticador (Google Authenticator, Authy, 1Password, Microsoft Authenticator) pra gerar códigos de 6 dígitos.
          </p>

          {!enrollResult ? (
            <button
              onClick={handleStartEnroll}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
              Começar agora
            </button>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">1. Abra seu app autenticador</p>
                <p className="text-[12px] text-slate-600 dark:text-slate-300">Adicione uma nova conta escaneando o QR code abaixo ou digitando o secret manualmente.</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-slate-50 dark:bg-white/5 rounded-2xl">
                <img
                  src={enrollResult.qrCode}
                  alt="QR Code MFA"
                  className="w-44 h-44 rounded-xl bg-white p-2"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ou digite o secret:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-slate-200 break-all">
                      {enrollResult.secret}
                    </code>
                    <button
                      onClick={copySecret}
                      className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                      title="Copiar"
                    >
                      {secretCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">2. Digite o código de 6 dígitos que aparece no app:</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={enrollCode}
                  onChange={e => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]"
                />
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Salve o secret em local seguro</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed mt-0.5">
                    Se você perder o celular, o secret acima é a única forma de reativar 2FA sem suporte. Guarde no Bitwarden, 1Password, ou anote num lugar seguro fora do celular.
                  </p>
                </div>
              </div>

              <button
                onClick={handleConfirmEnroll}
                disabled={busy || enrollCode.length !== 6}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Ativar 2FA
              </button>
            </div>
          )}

          {error && (
            <p className="mt-4 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Challenge (já tem fator, sessão AAL1) ───────────────────────────
  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl text-center">
        <div className="inline-flex p-3 bg-[#ff0068]/10 rounded-2xl text-[#ff0068] mb-4">
          <ShieldCheck size={28} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white mb-2">Confirme sua identidade</h1>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          Digite o código de 6 dígitos do seu app autenticador pra acessar o painel de Super Admin.
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
          value={challengeCode}
          onChange={e => setChallengeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter' && challengeCode.length === 6) handleConfirmChallenge(); }}
          placeholder="000000"
          className="w-full px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] mb-4"
        />
        <button
          onClick={handleConfirmChallenge}
          disabled={busy || challengeCode.length !== 6}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Validar
        </button>

        {error && (
          <p className="mt-4 text-[11px] text-rose-600 dark:text-rose-400 flex items-center justify-center gap-2">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
