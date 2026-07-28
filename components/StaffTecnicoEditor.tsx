import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Editor inline de staff técnico da coreografia — ficha técnica opcional
 * (compartilhado entre Wizard, /minhas-coreografias e painel do produtor).
 *
 * Diferente de BailarinosEditor: sem CPF/nascimento (não vira `elenco`, não
 * precisa ser pessoa cadastrada) — é só nome+função pra crédito em
 * certificado/programa. Salvo direto em `registrations.staff_tecnico` (JSONB).
 *
 * **Save é responsabilidade do parent.** Este componente só edita state.
 */

export const STAFF_TIPOS = [
  'Coreógrafo(a) assistente',
  'Professor(a) responsável',
  'Preparador físico',
  'Figurinista/Maquiador',
  'Técnico de som',
] as const;

export interface StaffTecnicoValue {
  tipo: string;
  nome: string;
}

interface Props {
  staff: StaffTecnicoValue[];
  onChange: (next: StaffTecnicoValue[]) => void;
}

const StaffTecnicoEditor: React.FC<Props> = ({ staff, onChange }) => {
  const update = (i: number, key: keyof StaffTecnicoValue, val: string) => {
    onChange(staff.map((s, j) => (j === i ? { ...s, [key]: val } : s)));
  };
  const remove = (i: number) => onChange(staff.filter((_, j) => j !== i));
  const add = () => onChange([...staff, { tipo: STAFF_TIPOS[0], nome: '' }]);

  return (
    <div className="space-y-2">
      {staff.map((s, i) => (
        <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <select
              aria-label={`Função da equipe técnica ${i + 1}`}
              value={s.tipo}
              onChange={e => update(i, 'tipo', e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
            >
              {STAFF_TIPOS.map(tipo => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
            <input
              type="text"
              aria-label={`Nome da equipe técnica ${i + 1}`}
              value={s.nome}
              onChange={e => update(i, 'nome', e.target.value)}
              placeholder="Nome completo"
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remover"
              className="justify-self-end sm:justify-self-center text-[9px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-600 flex items-center gap-1"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="w-full px-3 py-2 border border-dashed border-slate-300 dark:border-white/15 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] hover:border-[#ff0068]/50 transition-all"
      >
        + Adicionar equipe técnica
      </button>
    </div>
  );
};

export default StaffTecnicoEditor;
