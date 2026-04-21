import React, { useState } from 'react';
import { X, Check, Award, CheckCircle2 } from 'lucide-react';

interface CompetencyProps {
  judge: any;
  onClose: () => void;
  onSave: (data: any) => void;
}

const TagSelector = ({ label, items, selected, onToggle, color }: any) => (
  <div className="space-y-3">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block px-1">{label}</label>
    <div className="flex flex-wrap gap-2">
      {items.map((item: string) => {
        const isSelected = selected.includes(item);
        return (
          <button
            key={item}
            onClick={() => onToggle(item)}
            className={`px-4 py-2.5 rounded-xl border font-black text-[9px] uppercase tracking-widest transition-all flex items-center gap-2 ${
              isSelected ? `${color} border-transparent text-white shadow-lg` : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            {item} {isSelected && <Check size={12} />}
          </button>
        );
      })}
    </div>
  </div>
);

const JudgeCompetencyManager: React.FC<CompetencyProps> = ({ judge, onClose, onSave }) => {
  const [formats, setFormats] = useState<string[]>(['Mostra Competitiva']);
  const [styles, setStyles] = useState<string[]>(['Jazz']);

  const allFormats = ['Mostra Competitiva', 'Mostra por Médias', 'Batalhas', 'Workshop'];
  const allStyles = ['Ballet', 'Jazz', 'Urbanas', 'Tap', 'K-Pop', 'Contemporâneo', 'Estilo Livre'];

  const toggle = (list: string[], setList: any, item: string) => {
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[60] flex items-center justify-center p-6">
      <div className="bg-slate-900 w-full max-w-3xl rounded-[3.5rem] overflow-hidden border border-white/5 shadow-2xl">
        <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-3xl bg-[#ff0068] flex items-center justify-center text-white shadow-lg shadow-[#ff0068]/20">
              <Award size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tighter">Assinatura Técnica</h2>
              <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">Configurando: {judge.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-4 hover:bg-white/10 rounded-2xl transition-all">
            <X size={24} className="text-slate-500" />
          </button>
        </div>

        <div className="p-10 space-y-10">
          <TagSelector
            label="Formatos Autorizados"
            items={allFormats}
            selected={formats}
            onToggle={(i: string) => toggle(formats, setFormats, i)}
            color="bg-[#ff0068]"
          />
          <TagSelector
            label="Domínio de Estilos"
            items={allStyles}
            selected={styles}
            onToggle={(i: string) => toggle(styles, setStyles, i)}
            color="bg-cyan-500"
          />

          <div className="bg-[#ff0068]/10 p-8 rounded-[2.5rem] border border-[#ff0068]/20 flex gap-6 items-start">
            <div className="p-3 bg-[#ff0068] rounded-2xl text-white">
              <CheckCircle2 size={24} />
            </div>
            <p className="text-[10px] text-slate-400 font-medium leading-relaxed uppercase">
              Este terminal só será desbloqueado quando a coreografia no palco pertencer a um dos{' '}
              <strong>{styles.length} estilos</strong> e <strong>{formats.length} formatos</strong> selecionados.
            </p>
          </div>
        </div>

        <div className="p-10 bg-black border-t border-white/5 flex gap-6">
          <button onClick={onClose} className="flex-1 py-5 font-black text-[10px] uppercase tracking-widest text-slate-500 hover:text-white transition-colors">
            Descartar
          </button>
          <button
            onClick={() => { onSave({ formats, styles }); onClose(); }}
            className="flex-[2] py-6 bg-[#ff0068] text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl hover:opacity-90 transition-all"
          >
            Confirmar Banca Técnica
          </button>
        </div>
      </div>
    </div>
  );
};

export default JudgeCompetencyManager;
