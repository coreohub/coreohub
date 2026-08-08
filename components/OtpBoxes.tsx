import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

// Caixinhas de OTP (padrão Google/banco): auto-avança ao digitar, volta no
// backspace, e COLAR o código inteiro preenche todas de uma vez.
export function OtpBoxes({ value, onChange, onComplete, length = 6, autoFocus, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  const focus = (i: number) => refs.current[Math.max(0, Math.min(i, length - 1))]?.focus();

  const commit = (raw: string) => {
    const clean = raw.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const handleChange = (i: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '');
    // Mais de 1 dígito numa caixinha só = colagem que não passou pelo evento
    // nativo `paste` (Android/Gboard: sugestão de área de transferência e
    // autofill de SMS inserem via input direto, sem disparar `paste` —
    // `maxLength` do input não trunca porque removemos o atributo). Trata
    // como o código inteiro em vez de pegar só 1 caractere.
    if (digitsOnly.length > 1) {
      const clean = commit(digitsOnly);
      focus(clean.length);
      return;
    }
    const arr = Array.from({ length }, (_, k) => value[k] ?? '');
    arr[i] = digitsOnly;
    commit(arr.join(''));
    if (digitsOnly && i < length - 1) focus(i + 1);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      e.preventDefault();
      const arr = Array.from({ length }, (_, k) => value[k] ?? '');
      arr[i - 1] = '';
      onChange(arr.join(''));
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') {
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      focus(i + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const clean = commit(e.clipboardData.getData('text'));
    focus(clean.length);
  };

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          value={c}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          className="h-14 w-full rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-center text-2xl font-black text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 focus:bg-white dark:focus:bg-white/10 transition-all shadow-sm disabled:opacity-50"
        />
      ))}
    </div>
  );
}
