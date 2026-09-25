import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  INFO_SECTIONS, INFO_SECTION_MAX, INFO_FAQ_MAX_ITEMS, INFO_FAQ_Q_MAX, INFO_FAQ_A_MAX,
  INFO_PDV_MAX_ITEMS, INFO_PDV_FIELD_MAX,
  type InfoConfig, type InfoPdv,
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
  // Seções abertas pelo produtor (padrão Eventbrite "Good to know": só aparece o que se aplica).
  // Seção com texto salvo sempre aparece; as demais ficam atrás de um botão "+".
  const [opened, setOpened] = useState<string[]>([]);
  const visiveis = INFO_SECTIONS.filter(s => (value.secoes[s.key] ?? '').trim() || opened.includes(s.key));
  const disponiveis = INFO_SECTIONS.filter(s => !visiveis.some(v => v.key === s.key));

  const setSecao = (key: string, text: string) =>
    onChange({ ...value, secoes: { ...value.secoes, [key]: text.slice(0, INFO_SECTION_MAX) } });

  const setFaq = (idx: number, patch: Partial<{ pergunta: string; resposta: string }>) =>
    onChange({ ...value, faq: value.faq.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });

  const setPdv = (idx: number, patch: Partial<InfoPdv>) =>
    onChange({ ...value, pdvs: value.pdvs.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });

  return (
    <div className="space-y-5">
      <div>
        <p className={`${labelClass} mb-1`}>Informações e regras</p>
        <p className="text-[10px] text-slate-400">
          Aparecem no fim da página pública, com o nome de cada seção. Adicione só as que se aplicam ao seu evento.
        </p>
      </div>

      {visiveis.map(s => {
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

      {disponiveis.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {disponiveis.map(s => (
            <button
              key={s.key}
              type="button"
              onClick={() => setOpened(o => [...o, s.key])}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-[#ff0068]/50 cursor-pointer"
            >
              <Plus size={12} /> {s.titulo}
            </button>
          ))}
        </div>
      )}

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

      <div className="border-t border-slate-200 dark:border-white/10 pt-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className={`${labelClass} mb-0`}>Pontos de venda</p>
          <span className="text-[9px] font-bold tabular-nums text-slate-400">{value.pdvs.length}/{INFO_PDV_MAX_ITEMS}</span>
        </div>
        <p className="text-[10px] text-slate-400 mb-2">
          Onde o público pode comprar ingresso presencialmente. Aparece no fim da página pública. Nome e endereço são obrigatórios.
        </p>
        {value.pdvs.length === 0 && (
          <p className="text-[10px] text-slate-400 mb-2">Nenhum ponto de venda. Se você só vende online, deixe em branco.</p>
        )}
        <ul className="space-y-3">
          {value.pdvs.map((p, idx) => (
            <li key={idx} className="bg-slate-50 dark:bg-white/5 rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input type="text" value={p.nome} maxLength={INFO_PDV_FIELD_MAX} onChange={e => setPdv(idx, { nome: e.target.value })}
                  placeholder="Nome do ponto (ex: Bilheteria do teatro)" aria-label={`Nome do ponto de venda ${idx + 1}`} className={inputClass} />
                <button type="button" aria-label={`Remover ponto de venda ${idx + 1}`}
                  onClick={() => onChange({ ...value, pdvs: value.pdvs.filter((_, i) => i !== idx) })}
                  className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <input type="text" value={p.endereco} maxLength={INFO_PDV_FIELD_MAX} onChange={e => setPdv(idx, { endereco: e.target.value })}
                placeholder="Endereço" aria-label={`Endereço do ponto de venda ${idx + 1}`} className={inputClass} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input type="text" value={p.cidade} maxLength={INFO_PDV_FIELD_MAX} onChange={e => setPdv(idx, { cidade: e.target.value })}
                  placeholder="Cidade" aria-label={`Cidade do ponto de venda ${idx + 1}`} className={inputClass} />
                <input type="text" inputMode="tel" value={p.telefone} maxLength={INFO_PDV_FIELD_MAX} onChange={e => setPdv(idx, { telefone: e.target.value })}
                  placeholder="Telefone (opcional)" aria-label={`Telefone do ponto de venda ${idx + 1}`} className={inputClass} />
                <input type="text" value={p.horario} maxLength={INFO_PDV_FIELD_MAX} onChange={e => setPdv(idx, { horario: e.target.value })}
                  placeholder="Horário (opcional)" aria-label={`Horário do ponto de venda ${idx + 1}`} className={inputClass} />
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={value.pdvs.length >= INFO_PDV_MAX_ITEMS}
          onClick={() => onChange({ ...value, pdvs: [...value.pdvs, { nome: '', endereco: '', cidade: '', telefone: '', horario: '' }] })}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-[#ff0068]/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Plus size={12} /> Adicionar ponto de venda
        </button>
      </div>
    </div>
  );
}
