import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Gavel, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

/**
 * Entrada por código curto pro Terminal de Júri — mesmo padrão Kahoot
 * (kahoot.it + PIN): 1 link único, 1 código de 6 caracteres. O produtor
 * mostra/fala o código (gerado em /equipe-jurados) e o jurado digita aqui
 * — sem nunca ver o link assinado por token que existe só como rota
 * interna de destino. A QR code do produtor também aponta pra cá com
 * `?code=` preenchido — escanear é só um atalho pro mesmo formulário,
 * não um segundo caminho diferente.
 *
 * Rota: /entrar-juri (pública, sem login).
 */
const EntrarJuri: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSubmittedRef = useRef(false);

  const submitCode = async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length < 4) {
      setError('Digite o código completo.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('resolve_judge_short_code', { p_code: trimmed });
      if (rpcError) throw rpcError;
      if (!data) {
        setError('Código não encontrado. Confira com o produtor e tente de novo.');
        setLoading(false);
        return;
      }
      navigate(`/judge-login/${data}`, { replace: true });
    } catch (err) {
      console.error('[EntrarJuri] resolve_judge_short_code', err);
      setError('Não foi possível verificar o código agora. Tente de novo.');
      setLoading(false);
    }
  };

  // QR code do produtor codifica /entrar-juri?code=XXXXXX — escanear entra
  // sozinho, sem o jurado digitar nada (mesma experiência que copiar o link
  // direto oferecia antes, mas sem expor 2 caminhos diferentes).
  useEffect(() => {
    const fromQuery = searchParams.get('code');
    if (fromQuery && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      const normalized = fromQuery.toUpperCase().slice(0, 6);
      setCode(normalized);
      submitCode(normalized);
      return;
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCode(code);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="p-4 bg-[#ff0068]/10 rounded-2xl text-[#ff0068] mb-4">
            <Gavel size={28} />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tighter italic text-white">Entrar como Jurado</h1>
          <p className="text-xs text-slate-400 mt-2">
            Digite o código de 6 caracteres que o produtor mostrou pra você.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase().slice(0, 6)); setError(null); }}
            placeholder="XXXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Código de acesso do jurado"
            className="w-full text-center text-3xl font-black tracking-[0.3em] uppercase bg-white/5 border border-white/10 focus:border-[#ff0068] rounded-2xl py-5 text-white placeholder:text-slate-700 outline-none transition-colors"
          />

          {error && (
            <p role="alert" className="flex items-center gap-2 text-xs font-bold text-rose-400">
              <AlertCircle size={14} className="shrink-0" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.trim().length < 4}
            className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#ff1a7d] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <>Entrar <ArrowRight size={14} /></>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default EntrarJuri;
