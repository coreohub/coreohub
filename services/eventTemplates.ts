import { EventFormat } from '../types';

export type TemplateId = 'COMPETITIVA' | 'AVALIADA';

export interface EventTemplate {
  id: TemplateId;
  label: string;
  tagline: string;
  description: string;
  default_format: EventFormat;
  score_scale: 10 | 100;
  formacoes_config: any[];
  categories_config: any[];
  styles_config: any[];
  criteria_config: any[];
}

const rid = () => Math.random().toString(36).substring(7);

const baseFormacoes = () => [
  { id: rid(), name: 'Solo',  min_members: 1,  max_members: 1,  fee: 0, slots_limit: 100, weight: 0, format: EventFormat.RANKING, categories: ['Infantil', 'Júnior', 'Adulto'] },
  { id: rid(), name: 'Duo',   min_members: 2,  max_members: 2,  fee: 0, slots_limit: 50,  weight: 0, format: EventFormat.RANKING, categories: ['Infantil', 'Júnior', 'Adulto'] },
  { id: rid(), name: 'Grupo', min_members: 5,  max_members: 25, fee: 0, slots_limit: 30,  weight: 0, format: EventFormat.RANKING, categories: ['Infantil', 'Júnior', 'Adulto'] },
];

const baseCategorias = () => [
  { id: rid(), name: 'Infantil', min_age: 7,  max_age: 11, fee: 0, slots_limit: 0, weight: 0 },
  { id: rid(), name: 'Júnior',   min_age: 12, max_age: 14, fee: 0, slots_limit: 0, weight: 0 },
  { id: rid(), name: 'Adulto',   min_age: 15, max_age: 99, fee: 0, slots_limit: 0, weight: 0 },
];

const baseStyles = () => [
  { id: rid(), name: 'Urbanas', fee: 0, slots_limit: 0, weight: 0 },
  { id: rid(), name: 'Jazz',    fee: 0, slots_limit: 0, weight: 0 },
  { id: rid(), name: 'Ballet',  fee: 0, slots_limit: 0, weight: 0 },
];

export const eventTemplates: EventTemplate[] = [
  {
    id: 'COMPETITIVA',
    label: 'Mostra Competitiva',
    tagline: 'Com ranking + pontuação',
    description: 'Os participantes recebem notas dos jurados e são classificados em ranking. Ideal pra festivais profissionais com premiação.',
    default_format: EventFormat.RANKING,
    score_scale: 10,
    formacoes_config: baseFormacoes(),
    categories_config: baseCategorias(),
    styles_config: baseStyles(),
    criteria_config: [
      { id: rid(), name: 'Técnica',       weight: 40, fee: 0, slots_limit: 0 },
      { id: rid(), name: 'Musicalidade',  weight: 30, fee: 0, slots_limit: 0 },
      { id: rid(), name: 'Presença',      weight: 30, fee: 0, slots_limit: 0 },
    ],
  },
  {
    id: 'AVALIADA',
    label: 'Mostra Avaliada',
    tagline: 'Conceitos, sem ranking',
    description: 'Os jurados dão conceitos e feedback escrito, sem nota numérica nem classificação. Ideal pra mostras escolares e pedagógicas.',
    default_format: EventFormat.PEDAGOGICAL,
    score_scale: 10,
    formacoes_config: baseFormacoes().map(f => ({ ...f, format: EventFormat.PEDAGOGICAL })),
    categories_config: baseCategorias(),
    styles_config: baseStyles(),
    criteria_config: [
      { id: rid(), name: 'Execução',      weight: 0, fee: 0, slots_limit: 0 },
      { id: rid(), name: 'Interpretação', weight: 0, fee: 0, slots_limit: 0 },
      { id: rid(), name: 'Criatividade',  weight: 0, fee: 0, slots_limit: 0 },
    ],
  },
];

export const getTemplate = (id: TemplateId): EventTemplate =>
  eventTemplates.find(t => t.id === id) ?? eventTemplates[0];
