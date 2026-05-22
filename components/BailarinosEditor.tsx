import React from 'react';
import { Trash2 } from 'lucide-react';
import { maskCpfCnpj, maskData } from '../utils/masks';

/**
 * Editor inline de bailarinos compartilhado entre painel do produtor
 * (pages/Registrations.tsx) e área do inscrito (pages/MinhasCoreografias.tsx).
 *
 * Regra de @ Instagram (Sessão 4.2, confirmada em b2f9649):
 * - Solo/Duo/Trio → 1 @ por bailarino (input dentro de cada card)
 * - Grupo/Conjunto → 1 @ único do grupo/coreógrafo (renderizado pelo PARENT
 *   via `instagram_principal` + `onInstagramPrincipalChange`). Pedir @ de 4+
 *   pessoas sobrecarrega o coreógrafo na prática (lição prod).
 *
 * Data de nascimento é DD/MM/AAAA mascarada via `maskData` — calendário nativo
 * é lento pra ano antigo (decisão validada no Wizard público).
 *
 * **Save é responsabilidade do parent.** Este componente só edita state.
 * Parent deve aplicar `parseDataISO` + `validateCpf` + `unmaskCpfCnpj` antes
 * do UPDATE no banco.
 *
 * **RLS protege.** Inscrito edita as próprias via `inscrito_own_registrations`.
 * Produtor edita inscrições do próprio evento via `producer_updates_event_registrations`
 * (migration 20260525). Trigger `protect_registrations_status_columns` reverte
 * campos financeiros se algum caller errado tentar mexer.
 */

export interface BailarinoFormValue {
  nome?: string;
  cpf?: string;
  data_nascimento?: string;
  instagram_handle?: string;
}

interface Props {
  bailarinos: BailarinoFormValue[];
  onChange: (next: BailarinoFormValue[]) => void;
  /** Pra Grupo/Conjunto — renderiza campo único de @ no rodapé. */
  instagramPrincipal?: string;
  onInstagramPrincipalChange?: (v: string) => void;
  /** Formato da inscrição (Solo/Duo/Trio/Grupo/Conjunto). Define se mostra @
   *  por bailarino ou @ único principal. */
  formato: string;
  /** Mínimo de bailarinos permitido na modalidade. Bloqueia "Remover" quando
   *  já está no mínimo. Default 1. */
  minMembers?: number;
  /** Máximo de bailarinos permitido na modalidade. Bloqueia "Adicionar" quando
   *  já está no máximo. Default 99. */
  maxMembers?: number;
}

const BailarinosEditor: React.FC<Props> = ({
  bailarinos,
  onChange,
  instagramPrincipal,
  onInstagramPrincipalChange,
  formato,
  minMembers = 1,
  maxMembers = 99,
}) => {
  const isGrupoLike = formato === 'Grupo' || formato === 'Conjunto';

  const update = (i: number, key: keyof BailarinoFormValue, val: string) => {
    onChange(bailarinos.map((b, j) => (j === i ? { ...b, [key]: val } : b)));
  };
  const remove = (i: number) => {
    if (bailarinos.length <= minMembers) return;
    onChange(bailarinos.filter((_, j) => j !== i));
  };
  const add = () => {
    if (bailarinos.length >= maxMembers) return;
    onChange([...bailarinos, { nome: '', cpf: '', data_nascimento: '', instagram_handle: '' }]);
  };

  return (
    <div className="space-y-2">
      {bailarinos.map((b, i) => (
        <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Bailarino {i + 1}
            </p>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={bailarinos.length <= minMembers}
              className="text-[9px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-600 flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
              title={bailarinos.length <= minMembers ? `Mínimo ${minMembers} bailarino(s)` : 'Remover este bailarino'}
            >
              <Trash2 size={10} /> Remover
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={b.nome ?? ''}
              onChange={e => update(i, 'nome', e.target.value)}
              placeholder="Nome completo"
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
            />
            <input
              type="text"
              inputMode="numeric"
              value={b.cpf ?? ''}
              onChange={e => update(i, 'cpf', maskCpfCnpj(e.target.value))}
              placeholder="CPF"
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
            />
            <input
              type="text"
              inputMode="numeric"
              value={b.data_nascimento ?? ''}
              onChange={e => update(i, 'data_nascimento', maskData(e.target.value))}
              placeholder="DD/MM/AAAA"
              maxLength={10}
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
            />
            {!isGrupoLike && (
              <input
                type="text"
                value={b.instagram_handle ?? ''}
                onChange={e => update(i, 'instagram_handle', e.target.value.toLowerCase().replace(/^@/, ''))}
                placeholder="instagram (sem @)"
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
              />
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={bailarinos.length >= maxMembers}
        className="w-full px-3 py-2 border border-dashed border-slate-300 dark:border-white/15 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] hover:border-[#ff0068]/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-500 disabled:hover:border-slate-300"
        title={bailarinos.length >= maxMembers ? `Máximo ${maxMembers} bailarino(s) na modalidade ${formato}` : 'Adicionar bailarino'}
      >
        + Adicionar bailarino
      </button>

      {isGrupoLike && onInstagramPrincipalChange && (
        <div className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
          <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
            @ do grupo ou coreógrafo
          </label>
          <input
            type="text"
            value={instagramPrincipal ?? ''}
            onChange={e => onInstagramPrincipalChange(e.target.value.toLowerCase().replace(/^@/, ''))}
            placeholder="nomedogrupo (sem @)"
            maxLength={31}
            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
          />
          <p className="text-[9px] text-slate-400 mt-1.5">
            Usado pra marcar nas divulgações. Pedir @ de cada bailarino do grupo sobrecarrega o coreógrafo — 1 @ por inscrição.
          </p>
        </div>
      )}
    </div>
  );
};

export default BailarinosEditor;
