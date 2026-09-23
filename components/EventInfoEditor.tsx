import { Plus, X } from 'lucide-react';
import {
  INFO_SECTIONS, INFO_SECTION_MAX, INFO_FAQ_MAX_ITEMS, INFO_FAQ_Q_MAX, INFO_FAQ_A_MAX,
  type InfoConfig,
} from '../utils/eventInfo';

interface Props {
  value: InfoConfig;
  onChange: (next: InfoConfig) => void;
  /** Classes do tema (vêm de AccountSettings, mantém o mesmo visual dos outros campos). */
  inputClass: string;
  labelClass: string;
}

/**
 * Editor de "Informações e regras" do evento: seções fixas + perguntas
 * frequentes. Renderizado sempre (empty state = campos vazios, nunca esconde).
 */
export default function EventInfoEditor({ value, onChange, inputClass, labelClass }: Props) {
  const setSecao = (key: string, text: string) =>
    onChange({ ...value, secoes: { ...value.secoes, [key]: text.slice(0, INFO_SECTION_MAX) } });

  const setFaq = (idx: number, patch: Partial<{ pergunta: string; resposta: string }>) =>
    onChange({ ...value, faq: value.faq.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-5">
      <div>
        <p className={`${labelClass} mb-1`}>Informações e regras</p>
        <p className="text-[10px] text-slate-400">
          Aparecem no fim da página pública, com o nome de cada seção. Deixe em branco o que não se aplica.
        </p>
      </div>

      {INFO_SECTIONS.map(s => {
        const text = value.secoes[s.key] ?? '';
        return (
          <div key={s.key}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor={`info-${s.key}`} className={`${labelClass} mb-0`}>{s.titulo}</label>
              <span className="text-[9px] font-bold tabular-nums text-slate-400">{text.length}/{INFO_SECTION_MAX}</span>
            </div>
            <textarea
              id={`info-${s.key}`}
              rows={3}
              maxLength={INFO_SECTION_MAX}
              value={text}
              onChange={e => setSecao(s.key, e.target.value)}
              placeholder={s.placeholder}
              className={`${inputClass} resize-none`}
            />
          </div>
        );
      })}

      <div className="border-t border-slate-200 dark:border-white/10 pt-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className={`${labelClass} mb-0`}>Perguntas frequentes</p>
          <span className="text-[9px] font-bold tabular-nums text-slate-400">{value.faq.length}/{INFO_FAQ_MAX_ITEMS}</span>
        </div>
        {value.faq.length === 0 && (
          <p className="text-[10px] text-slate-400 mb-2">Nenhuma pergunta ainda. Ex: "Posso trocar de assento?", "Tem estacionamento?".</p>
        )}
        <ul className="space-y-3">
          {value.faq.map((f, idx) => (
            <li key={idx} className="bg-slate-50 dark:bg-white/5 rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={f.pergunta}
                  maxLength={INFO_FAQ_Q_MAX}
                  onChange={e => setFaq(idx, { pergunta: e.target.value })}
                  placeholder="Pergunta"
                  aria-label={`Pergunta ${idx + 1}`}
                  className={inputClass}
                />
                <button
                  type="button"
                  aria-label={`Remover pergunta ${idx + 1}`}
                  onClick={() => onChange({ ...value, faq: value.faq.filter((_, i) => i !== idx) })}
                  className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <textarea
                rows={2}
                value={f.resposta}
                maxLength={INFO_FAQ_A_MAX}
                onChange={e => setFaq(idx, { resposta: e.target.value })}
                placeholder="Resposta"
                aria-label={`Resposta ${idx + 1}`}
                className={`${inputClass} resize-none`}
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={value.faq.length >= INFO_FAQ_MAX_ITEMS}
          onClick={() => onChange({ ...value, faq: [...value.faq, { pergunta: '', resposta: '' }] })}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-[#ff0068]/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Plus size={12} /> Adicionar pergunta
        </button>
      </div>
    </div>
  );
}
