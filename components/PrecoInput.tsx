import React from 'react';
import { formatPrecoBR, parsePrecoBR } from '../utils/masks';

const MAX_PRECO = 99999.99;
const PrecoInput: React.FC<{ value: number; onChange: (n: number) => void; className?: string }> = ({ value, onChange, className }) => {
  const [draft, setDraft] = React.useState<string>(value ? formatPrecoBR(value) : '');
  React.useEffect(() => { setDraft(value ? formatPrecoBR(value) : ''); }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">R$</span>
      <input
        type="text"
        inputMode="decimal"
        maxLength={12}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const num = Math.min(parsePrecoBR(draft), MAX_PRECO);
          onChange(num);
          setDraft(num ? formatPrecoBR(num) : '');
        }}
        placeholder="0,00"
        className={className}
      />
    </div>
  );
};

export default PrecoInput;
