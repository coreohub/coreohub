import React from 'react';
import { Trophy, MessageSquare, Award, CheckCircle2 } from 'lucide-react';
import { EventFormat } from '../types';

interface FormatOption {
  id: EventFormat;
  title: string;
  description: string;
  icon: any;
  color: string;
  tags: string[];
}

interface Props {
  selected: EventFormat;
  onSelect: (format: EventFormat) => void;
}

const EventFormatSelector: React.FC<Props> = ({ selected, onSelect }) => {
  const options: FormatOption[] = [
    {
      id: EventFormat.RANKING,
      title: 'Mostra Competitiva',
      description: 'Foco em disputa direta. O sistema gera ranking de 1º, 2º e 3º lugares por média.',
      icon: Trophy,
      color: '#ff0068',
      tags: ['Ranking Automático', 'Pódio Tradicional']
    },
    {
      id: EventFormat.PEDAGOGICAL,
      title: 'Mostra Avaliada',
      description: 'Foco pedagógico. Coleta notas e comentários para feedback, sem ranking ou premiação.',
      icon: MessageSquare,
      color: '#1DE7F2',
      tags: ['Feedback Detalhado', 'Sem Disputa']
    },
    {
      id: EventFormat.GRADUATED,
      title: 'Mostra por Médias',
      description: 'Premiação por desempenho individual. Medalhas baseadas em notas de corte pré-definidas.',
      icon: Award,
      color: '#e3ff0a',
      tags: ['Meta de Medalhas', 'Incentivo Individual']
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = selected === opt.id;

        return (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className={`relative p-8 rounded-[3rem] border-2 transition-all flex flex-col items-start text-left group overflow-hidden ${
              isActive
                ? `bg-slate-900 border-[${opt.color}] shadow-2xl`
                : 'bg-slate-950 border-white/5 hover:border-white/10'
            }`}
            style={{ borderColor: isActive ? opt.color : undefined }}
          >
            {isActive && (
              <div className="absolute top-6 right-6 animate-in zoom-in duration-300" style={{ color: opt.color }}>
                <CheckCircle2 size={24} />
              </div>
            )}

            <div className="p-4 rounded-2xl mb-6 transition-all" style={{ backgroundColor: isActive ? `${opt.color}20` : '#ffffff05', color: isActive ? opt.color : '#475569' }}>
              <Icon size={28} />
            </div>

            <h3 className={`text-xl font-black uppercase tracking-tight mb-2 ${isActive ? 'text-white' : 'text-slate-500'}`}>
              {opt.title}
            </h3>

            <p className="text-[10px] font-medium text-slate-500 mb-6 leading-relaxed uppercase tracking-widest">
              {opt.description}
            </p>

            <div className="flex flex-wrap gap-2 mt-auto">
              {opt.tags.map(tag => (
                <span key={tag} className="text-[8px] font-black uppercase px-2 py-1 rounded-md bg-white/5 text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default EventFormatSelector;
