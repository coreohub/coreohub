import React, { useEffect, useRef, useState } from 'react';
import { Check, X, Loader2, Info } from 'lucide-react';
import { supabase } from '../services/supabase';
import { slugify, slugAlternatives, slugValidity, SLUG_MAX, SLUG_MIN } from '../utils/slug';

interface Props {
  /** Valor atual do campo (o que o produtor vê). */
  value: string;
  onChange: (v: string) => void;
  /** Sugestão gerada do nome (e professor). Enquanto o campo não for editado à mão, ele acompanha a sugestão. */
  suggestion: string;
  /** Slug salvo hoje (edição). Null em workshop novo. */
  originalSlug: string | null;
  /** Id do workshop em edição, pra não contar o próprio slug como ocupado. */
  excludeId: string | null;
  /** Prefixo mostrado antes do campo, ex: "app.coreohub.com/workshop/". */
  prefix: string;
}

type Status = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid' | 'error';

/**
 * Campo de slug com sugestão automática, verificação de disponibilidade na hora (check/X) e alternativas
 * quando o endereço já existe. Em workshop novo o campo acompanha o nome até o produtor digitar nele;
 * em edição nunca muda sozinho (mudar quebraria link compartilhado) e avisa que o link antigo redireciona.
 */
const SlugField: React.FC<Props> = ({ value, onChange, suggestion, originalSlug, excludeId, prefix }) => {
  const [touched, setTouched] = useState<boolean>(!!originalSlug);
  const [status, setStatus] = useState<Status>('idle');
  const reqId = useRef(0);

  // Acompanha a sugestão enquanto o produtor não mexeu no campo (workshop novo).
  useEffect(() => {
    if (!touched && suggestion !== value) onChange(suggestion);
  }, [suggestion, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verificação com debounce. Slug igual ao salvo hoje é sempre válido.
  useEffect(() => {
    const slug = value.trim();
    if (!slug) { setStatus('idle'); return; }
    if (slug === originalSlug) { setStatus('ok'); return; }
    if (slugValidity(slug) !== 'ok') { setStatus('invalid'); return; }
    setStatus('checking');
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('workshop_slug_available', { p_slug: slug, p_exclude_id: excludeId });
      if (id !== reqId.current) return;
      if (error) { console.error('[SlugField] workshop_slug_available:', error.message); setStatus('error'); return; }
      setStatus(data === true ? 'ok' : 'taken');
    }, 400);
    return () => clearTimeout(t);
  }, [value, originalSlug, excludeId]);

  const changed = !!originalSlug && value.trim() !== originalSlug;
  const typedFix = slugify(value);

  return (
    <div>
      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Endereço do workshop (link público)</span>
      <div className="flex items-stretch rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-[#ff0068]/30">
        <span className="hidden sm:flex items-center pl-3 text-xs text-slate-400 whitespace-nowrap select-none">{prefix}</span>
        <input
          value={value}
          onChange={e => { setTouched(true); onChange(e.target.value); }}
          onBlur={() => { if (value && typedFix && typedFix !== value) onChange(typedFix); }}
          maxLength={SLUG_MAX + 10}
          autoComplete="off"
          spellCheck={false}
          aria-label="Endereço do workshop"
          className="flex-1 min-w-0 bg-transparent dark:text-white px-3 py-2 text-sm focus:outline-none"
          placeholder="jazz-funk-intensivo-com-maria-silva"
        />
        <span className="flex items-center pr-3" aria-live="polite">
          {status === 'checking' && <Loader2 size={14} className="animate-spin text-slate-400" />}
          {status === 'ok' && <Check size={14} className="text-emerald-500" />}
          {(status === 'taken' || status === 'invalid') && <X size={14} className="text-rose-500" />}
        </span>
      </div>

      <div className="mt-1 min-h-[16px] text-[11px] leading-snug">
        {status === 'ok' && <span className="text-emerald-600 dark:text-emerald-400">Endereço disponível.</span>}
        {status === 'checking' && <span className="text-slate-400">Verificando…</span>}
        {status === 'invalid' && (
          <span className="text-rose-600 dark:text-rose-400">
            Use só letras minúsculas, números e hífens, de {SLUG_MIN} a {SLUG_MAX} caracteres. Ao sair do campo ele é ajustado sozinho.
          </span>
        )}
        {status === 'error' && <span className="text-amber-600 dark:text-amber-400">Não foi possível verificar agora; a conferência final acontece ao salvar.</span>}
        {status === 'taken' && (
          <span className="text-rose-600 dark:text-rose-400">
            Esse endereço já está em uso. Tente:{' '}
            {slugAlternatives(value.trim()).map(alt => (
              <button key={alt} type="button" onClick={() => { setTouched(true); onChange(alt); }} className="mr-2 font-black underline underline-offset-2 hover:text-rose-800">
                {alt}
              </button>
            ))}
          </span>
        )}
      </div>

      {changed && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-sky-700 dark:text-sky-400">
          <Info size={12} className="mt-0.5 shrink-0" />
          O link antigo ({originalSlug}) continua funcionando e redireciona para o novo.
        </p>
      )}
      {!originalSlug && (
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Sugerido a partir do nome e do professor. Você pode editar; depois de publicado, mudar o endereço mantém o link antigo redirecionando.
        </p>
      )}
    </div>
  );
};

export default SlugField;
