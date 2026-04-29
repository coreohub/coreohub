import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Award, Loader2, Lock, ArrowLeft, ShieldCheck, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, supabaseUrl, supabaseAnonKey } from '../services/supabase';

/**
 * Página pública de seleção e login de jurado.
 *
 * URL: /judge-login/:token (token é o profiles.judge_access_token do produtor)
 *
 * Fluxo:
 * 1. Página pública — não exige nenhum login. Funciona no celular do jurado.
 * 2. Chama Edge Function `judge-login` com action=list pra puxar a lista de
 *    jurados daquele produtor (só nome/avatar, PIN nunca trafega).
 * 3. Jurado escolhe nome → digita PIN → chamada Edge Function action=validate.
 * 4. Edge Function valida PIN no backend (PIN nunca chega no client por outro
 *    caminho que não a tentativa do próprio usuário).
 * 5. Sucesso → salva sessão em localStorage por 24h → redireciona pro /judge-terminal.
 */

interface Judge {
  id: string;
  name: string;
  avatar_url?: string | null;
  competencias_generos?: string[] | null;
}

const SESSION_KEY = 'coreohub_judge_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 min

export interface JudgeSession {
  judge_id: string;
  judge_name: string;
  language: string;
  producer_token: string;
  expires_at: number;
}

export const readJudgeSession = (): JudgeSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JudgeSession;
    if (parsed.expires_at < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const clearJudgeSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

const callJudgeLogin = async (body: Record<string, unknown>) => {
  const res = await fetch(`${supabaseUrl}/functions/v1/judge-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const JudgeLogin: React.FC = () => {
  const navigate = useNavigate();
  const { token: paramToken } = useParams<{ token: string }>();
  const [judges, setJudges] = useState<Judge[]>([]);
  const [producerName, setProducerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [selectedJudge, setSelectedJudge] = useState<Judge | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const avatarSrc = (j: Judge) =>
    j.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(j.name)}`;

  useEffect(() => {
    if (!paramToken) {
      setTokenInvalid(true);
      setLoading(false);
      return;
    }
    // Sessão válida e do mesmo produtor → manda direto pro terminal
    const session = readJudgeSession();
    if (session && session.producer_token === paramToken) {
      navigate('/judge-terminal', { replace: true });
      return;
    }
    (async () => {
      const { status, data } = await callJudgeLogin({ action: 'list', token: paramToken });
      if (status === 404 || data?.reason === 'invalid_token') {
        setTokenInvalid(true);
      } else if (status === 200 && data?.ok) {
        setJudges(data.judges ?? []);
        setProducerName(data.producer_name ?? null);
      } else {
        setError(data?.detail ?? 'Não foi possível carregar a lista de jurados.');
      }
      setLoading(false);
    })();
  }, [paramToken, navigate]);

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockedUntil) return 0;
    const ms = lockedUntil - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }, [lockedUntil]);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      if (lockedUntil <= Date.now()) {
        setLockedUntil(null);
        setAttemptsLeft(MAX_ATTEMPTS);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const openPinModal = (judge: Judge) => {
    if (lockedUntil && lockedUntil > Date.now()) return;
    setSelectedJudge(judge);
    setPinInput('');
    setError(null);
  };

  const closePinModal = () => {
    setSelectedJudge(null);
    setPinInput('');
    setError(null);
  };

  const handleDigit = (d: string) => {
    if (pinInput.length >= 4 || validating) return;
    setPinInput(p => p + d);
    setError(null);
  };

  const handleBackspace = () => {
    setPinInput(p => p.slice(0, -1));
    setError(null);
  };

  useEffect(() => {
    if (pinInput.length !== 4 || !selectedJudge || validating || !paramToken) return;
    setValidating(true);
    (async () => {
      const { status, data } = await callJudgeLogin({
        action: 'validate',
        token: paramToken,
        judge_id: selectedJudge.id,
        pin: pinInput,
      });

      if (status === 200 && data?.ok) {
        const session: JudgeSession = {
          judge_id: data.judge.id,
          judge_name: data.judge.name,
          language: data.judge.language ?? 'pt-BR',
          producer_token: paramToken,
          expires_at: Date.now() + SESSION_TTL_MS,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        navigate('/judge-terminal', { replace: true });
        return;
      }

      // Falhas
      const left = attemptsLeft - 1;
      setAttemptsLeft(left);
      setPinInput('');
      if (left <= 0) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setSelectedJudge(null);
        setError('Muitas tentativas erradas. Aguarde 5 minutos.');
      } else if (data?.reason === 'invalid_pin') {
        setError(`PIN incorreto. ${left} tentativa${left === 1 ? '' : 's'} restante${left === 1 ? '' : 's'}.`);
      } else {
        setError('Erro ao validar. Tente novamente.');
      }
      setValidating(false);
    })();
  }, [pinInput, selectedJudge, attemptsLeft, navigate, paramToken, validating]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (tokenInvalid) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-5">
          <div className="inline-flex p-4 rounded-3xl bg-rose-500/10 border border-rose-500/20">
            <ShieldCheck size={28} className="text-rose-500" />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 dark:text-white italic">
            Link inválido ou expirado
          </h1>
          <p className="text-xs text-slate-500 font-bold leading-relaxed">
            Esse link de acesso não existe mais ou foi revogado pelo produtor.
            Peça um link novo na produção.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-8 mt-4">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ff0068]/10 border border-[#ff0068]/20">
            <Award size={12} className="text-[#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Acesso do Jurado</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Quem está <span className="text-[#ff0068]">julgando?</span>
          </h1>
          <p className="text-xs text-slate-500 font-bold">
            Toque no seu nome e digite o PIN de 4 dígitos enviado pelo produtor.
          </p>
          {producerName && (
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Produtor: <span className="text-slate-600 dark:text-slate-300">{producerName}</span>
            </p>
          )}
        </div>

        {/* Lockout banner */}
        {lockedUntil && lockoutSecondsLeft > 0 && (
          <div className="flex items-center gap-2 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500">
            <AlertCircle size={16} className="shrink-0" />
            <p className="text-xs font-bold">
              Acesso bloqueado por excesso de tentativas. Tente em {lockoutSecondsLeft}s.
            </p>
          </div>
        )}

        {/* Inline error */}
        {error && !selectedJudge && (
          <div className="flex items-center gap-2 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500">
            <AlertCircle size={14} className="shrink-0" />
            <p className="text-xs font-bold">{error}</p>
          </div>
        )}

        {/* Judge grid */}
        {judges.length === 0 ? (
          <div className="text-center py-16 text-xs font-bold text-slate-400">
            Nenhum jurado cadastrado por esse produtor.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {judges.map(j => (
              <button
                key={j.id}
                onClick={() => openPinModal(j)}
                disabled={!!lockedUntil && lockedUntil > Date.now()}
                className="group bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl p-4 flex flex-col items-center text-center gap-2 hover:border-[#ff0068]/40 hover:shadow-lg hover:shadow-[#ff0068]/10 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200"
              >
                <img
                  src={avatarSrc(j)}
                  alt={j.name}
                  className="w-16 h-16 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10 group-hover:border-[#ff0068]/40 transition-all"
                />
                <p className="text-[11px] font-black uppercase tracking-tight text-slate-900 dark:text-white leading-tight">
                  {j.name}
                </p>
                {(j.competencias_generos?.length ?? 0) > 0 && (
                  <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 line-clamp-1">
                    {j.competencias_generos!.slice(0, 2).join(' · ')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PIN modal */}
      <AnimatePresence>
        {selectedJudge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closePinModal}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 space-y-5"
            >
              <button
                onClick={closePinModal}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#ff0068]"
              >
                <ArrowLeft size={12} /> Trocar jurado
              </button>

              <div className="text-center space-y-2">
                <img
                  src={avatarSrc(selectedJudge)}
                  alt={selectedJudge.name}
                  className="w-20 h-20 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-[#ff0068]/30 mx-auto"
                />
                <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">Bem-vindo</p>
                <h3 className="text-lg font-black uppercase tracking-tighter text-slate-900 dark:text-white">
                  {selectedJudge.name}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold">
                  Digite seu PIN de 4 dígitos
                </p>
              </div>

              {/* PIN dots */}
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-black transition-all
                      ${i < pinInput.length
                        ? 'border-[#ff0068] bg-[#ff0068]/10 text-[#ff0068]'
                        : 'border-slate-200 dark:border-white/10 text-slate-300 dark:text-slate-700'
                      }`}
                  >
                    {i < pinInput.length ? '●' : ''}
                  </div>
                ))}
              </div>

              {error && (
                <p className="text-center text-[10px] font-bold text-rose-500">{error}</p>
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                  <button
                    key={n}
                    onClick={() => handleDigit(String(n))}
                    disabled={validating}
                    className="py-4 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xl font-black text-slate-900 dark:text-white hover:bg-[#ff0068]/10 hover:text-[#ff0068] hover:border-[#ff0068]/30 active:scale-95 transition-all disabled:opacity-40"
                  >
                    {n}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => handleDigit('0')}
                  disabled={validating}
                  className="py-4 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xl font-black text-slate-900 dark:text-white hover:bg-[#ff0068]/10 hover:text-[#ff0068] hover:border-[#ff0068]/30 active:scale-95 transition-all disabled:opacity-40"
                >
                  0
                </button>
                <button
                  onClick={handleBackspace}
                  disabled={validating || pinInput.length === 0}
                  className="py-4 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center"
                >
                  ⌫
                </button>
              </div>

              <div className="flex items-center gap-1.5 justify-center text-[9px] font-bold uppercase tracking-widest text-slate-400">
                <Lock size={10} /> {attemptsLeft}/{MAX_ATTEMPTS} tentativas
                {validating && <Loader2 size={10} className="animate-spin" />}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JudgeLogin;
