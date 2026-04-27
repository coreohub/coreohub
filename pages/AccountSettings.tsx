import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import {
  getAllGenres, createGenre, updateGenre, deleteGenre,
  addSubgenre, editSubgenre, removeSubgenre,
} from '../services/genreService';
import { EventStyle, Subgenre } from '../types';
import {
  Settings, Clock, Save, Plus, Pencil, Trash2,
  Music2, DollarSign, Users, AlertTriangle,
  Clapperboard, Link2, CheckSquare, Square, X,
  ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Loader2, Sparkles,
  Scale, ArrowUp, ArrowDown, Copy, GripVertical,
  Trophy, Star, Zap, Crown, Shirt, Award, Lock, Medal,
  Calendar, CalendarDays, CalendarRange,
  CreditCard, CheckCircle, AlertCircle, ExternalLink, Percent, Hash,
} from 'lucide-react';

/* ── Evaluation Rules types ── */
interface EvalCriterion { name: string; peso: number; displayName?: string; }
interface EvalRules {
  criterios: EvalCriterion[];
  desempate: string[]; // ordered list: 'maior_media' | 'criterio_<name>'
}
interface EvalConfig {
  globalRules: EvalRules;
  overrides: Record<string, EvalRules | null>; // null = inherit global
}

const DEFAULT_CRITERIOS: EvalCriterion[] = [
  { name: 'Técnica',       peso: 3 },
  { name: 'Coreografia',   peso: 2 },
  { name: 'Musicalidade',  peso: 2 },
  { name: 'Interpretação', peso: 1 },
];

const buildDefaultTiebreaker = (cs: EvalCriterion[]) =>
  ['maior_media', ...cs.map(c => `criterio_${c.name}`)];

const DEFAULT_GLOBAL_RULES: EvalRules = {
  criterios: DEFAULT_CRITERIOS,
  desempate: buildDefaultTiebreaker(DEFAULT_CRITERIOS),
};

const tieLabel = (key: string) =>
  key === 'maior_media' ? 'Maior Média Geral' : `Maior Nota em ${key.replace('criterio_', '')}`;

/* ── pesoTotal (top-level, shared by RulesEditor) ── */
const pesoTotal = (criterios: EvalCriterion[]) =>
  criterios.reduce((s, c) => s + (c.peso || 0), 0);

/* ════════════════════════ RulesEditor component ════════════════════════
   Definido FORA do AccountSettings para evitar remontagem a cada keystroke.
   Quando definido inline dentro de um case/render, React cria um novo tipo
   de componente a cada re-render, fazendo inputs perderem o foco. ═════ */
interface RulesEditorProps {
  rules: EvalRules;
  onUpdateCriterion: (idx: number, patch: Partial<EvalCriterion>) => void;
  onAddCriterion: () => void;
  onRemoveCriterion: (idx: number) => void;
  onMoveTiebreaker: (idx: number, dir: 1 | -1) => void;
}

const RulesEditor: React.FC<RulesEditorProps> = ({
  rules,
  onUpdateCriterion,
  onAddCriterion,
  onRemoveCriterion,
  onMoveTiebreaker,
}) => {
  const total   = pesoTotal(rules.criterios);
  const formula = rules.criterios.map(c => `(${c.name.slice(0, 3)}×${c.peso})`).join(' + ');
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
      {/* Quesitos e Pesos */}
      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Quesitos e Pesos</p>
        {rules.criterios.map((c, idx) => (
          <div key={idx} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl px-3 py-2 space-y-1.5">
            {/* Nome + Peso + Remover */}
            <div className="flex items-center gap-2">
              <GripVertical size={12} className="text-slate-300 dark:text-white/20 shrink-0" />
              <input
                type="text"
                value={c.name}
                onChange={e => onUpdateCriterion(idx, { name: e.target.value })}
                className="flex-1 bg-transparent text-[11px] font-bold text-slate-900 dark:text-white focus:outline-none min-w-0"
                placeholder="Nome do quesito"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-black text-slate-400 uppercase">Peso</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={c.peso}
                  onChange={e => onUpdateCriterion(idx, { peso: Math.max(1, Number(e.target.value)) })}
                  className="w-12 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg py-1 text-[11px] font-black text-[#ff0068] focus:outline-none focus:border-[#ff0068]/50"
                />
                {total > 0 && (
                  <span className="text-[8px] font-black text-slate-400 w-8 text-right">
                    {Math.round((c.peso / total) * 100)}%
                  </span>
                )}
              </div>
              <button
                onClick={() => onRemoveCriterion(idx)}
                className="p-1 text-slate-300 dark:text-white/20 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all shrink-0"
              >
                <X size={12} />
              </button>
            </div>
            {/* Label customizado exibido no terminal do júri */}
            <div className="ml-5 flex items-center gap-1.5 border-t border-slate-100 dark:border-white/5 pt-1.5">
              <span className="text-[8px] font-black text-slate-400 uppercase shrink-0 whitespace-nowrap">Label no terminal</span>
              <input
                type="text"
                value={c.displayName || ''}
                onChange={e => onUpdateCriterion(idx, { displayName: e.target.value || undefined })}
                className="flex-1 bg-transparent text-[10px] text-slate-500 dark:text-slate-400 italic focus:outline-none min-w-0 focus:text-slate-700 dark:focus:text-slate-200 transition-colors"
                placeholder={`Padrão: "${c.name}" — ex: "Performance / Lip Sync"`}
              />
            </div>
          </div>
        ))}
        <button
          onClick={onAddCriterion}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:border-[#ff0068]/40 hover:text-[#ff0068] transition-all"
        >
          <Plus size={11} /> Adicionar Quesito
        </button>
        {rules.criterios.length > 0 && total > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#ff0068]/5 border border-[#ff0068]/10 rounded-xl">
            <Scale size={10} className="text-[#ff0068] shrink-0" />
            <p className="text-[9px] font-bold text-slate-600 dark:text-slate-400 truncate">
              Fórmula: ({formula}) ÷ {total}
            </p>
          </div>
        )}
      </div>

      {/* Cascata de Desempate */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cascata de Desempate</p>
          <span className="text-[8px] text-slate-300 dark:text-white/20">— ordem de prioridade</span>
        </div>
        {rules.desempate.map((key, idx) => (
          <div key={key} className="flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl px-3 py-2">
            <span className="w-5 text-center text-[9px] font-black text-[#ff0068] shrink-0">{idx + 1}°</span>
            <span className="flex-1 text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">{tieLabel(key)}</span>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onMoveTiebreaker(idx, -1)}
                disabled={idx === 0}
                className="p-1 text-slate-300 dark:text-white/20 hover:text-slate-700 dark:hover:text-white disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all"
              ><ArrowUp size={11} /></button>
              <button
                onClick={() => onMoveTiebreaker(idx, 1)}
                disabled={idx === rules.desempate.length - 1}
                className="p-1 text-slate-300 dark:text-white/20 hover:text-slate-700 dark:hover:text-white disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all"
              ><ArrowDown size={11} /></button>
            </div>
          </div>
        ))}
        {rules.desempate.length === 0 && (
          <p className="text-[10px] text-slate-400 italic py-4 text-center border border-dashed border-slate-200 dark:border-white/10 rounded-xl">
            Adicione quesitos para gerar a cascata.
          </p>
        )}
      </div>
    </div>
  );
};

/* ── Special Awards types ── */
interface SpecialAward {
  id: string;
  name: string;
  enabled: boolean;
  isTemplate: boolean;
  formation: string;   // 'TODOS' | formation name
  description: string;
}

const AWARD_TEMPLATES: Omit<SpecialAward, 'enabled'>[] = [
  { id: 'tpl_bailarino',  name: 'Melhor Bailarino(a)',   isTemplate: true, formation: 'TODOS',  description: 'Destaque individual de interpretação e técnica.' },
  { id: 'tpl_revelacao',  name: 'Prêmio Revelação',      isTemplate: true, formation: 'TODOS',  description: 'Apresentação mais surpreendente da noite.' },
  { id: 'tpl_coreografo', name: 'Melhor Coreógrafo',     isTemplate: true, formation: 'TODOS',  description: 'Reconhece o trabalho criativo de criação da coreografia.' },
  { id: 'tpl_grupo',      name: 'Melhor Grupo da Noite', isTemplate: true, formation: 'Grupo',  description: 'Prêmio exclusivo para formações em grupo.' },
];

const AWARD_ICONS: Record<string, React.ElementType> = {
  tpl_bailarino:  Star,
  tpl_revelacao:  Zap,
  tpl_coreografo: Crown,
  tpl_grupo:      Users,
};

const customAwardIcon = (name: string): React.ElementType => {
  const n = name.toLowerCase();
  if (n.includes('figurino') || n.includes('roupa')) return Shirt;
  if (n.includes('grupo'))                           return Users;
  if (n.includes('bailarino'))                       return Star;
  return Award;
};

import { motion, AnimatePresence } from 'motion/react';

type TabType =
  | 'Geral'
  | 'Gêneros'
  | 'Avaliação'
  | 'Prêmios'
  | 'Formações'
  | 'Categorias'
  | 'Tolerância'
  | 'Fluxo do Evento'
  | 'Redirecionamentos'
  | 'Pagamentos';

const TABS: { label: TabType; icon: React.ElementType }[] = [
  { label: 'Geral',             icon: Settings },
  { label: 'Gêneros',           icon: Music2 },
  { label: 'Avaliação',         icon: Scale },
  { label: 'Prêmios',           icon: Trophy },
  { label: 'Formações',         icon: DollarSign },
  { label: 'Categorias',        icon: Users },
  { label: 'Tolerância',        icon: AlertTriangle },
  { label: 'Fluxo do Evento',   icon: Clapperboard },
  { label: 'Redirecionamentos', icon: Link2 },
  { label: 'Pagamentos',        icon: CreditCard },
];

const TIPOS_APRESENTACAO_OPTIONS = [
  { id: 'Competitiva',           label: 'Mostra Competitiva' },
  { id: 'Avaliada',              label: 'Mostra Avaliada (Não Competitiva)' },
  { id: 'Ranking',               label: 'Ranking por Médias' },
  { id: 'Batalhas',              label: 'Torneio de Batalhas' },
];

type ScoreScale = 'BASE_10' | 'BASE_100';

const DEFAULT_GENERAL = {
  eventName: 'CoreoHub Festival',
  location: 'Concha Acústica',
  city: 'Votuporanga, SP',
  eventDate: '2026-07-11',
  regDeadline: '2026-06-30',
  trackDeadline: '2026-07-05',
  tipos_apresentacao: ['Competitiva', 'Avaliada'],
  scoreScale: 'BASE_10' as ScoreScale,
  pinInactivityMinutes: 15 as number, // 0 = nunca bloquear
  medalThresholds: { gold: 9.0, silver: 8.0, bronze: 7.0 },
};

const SCORE_SCALE_OPTIONS: { id: ScoreScale; label: string; desc: string; example: string }[] = [
  { id: 'BASE_10',  label: 'Base 10 — Decimal',    desc: 'Notas de 0,00 a 10,00 com casas decimais',     example: 'Ex: 9,8' },
  { id: 'BASE_100', label: 'Base 100 — Centesimal', desc: 'Notas inteiras de 0 a 100, sem vírgula',        example: 'Ex: 98' },
];

const DEFAULT_MODALITIES = ['Danças Urbanas', 'Balé Clássico', 'K-Pop', 'Estilo Livre'];

interface FormatLote { data_virada: string | null; preco: number }
interface FormatItem {
  id: number;
  name: string;
  lotes: FormatLote[];
  pricingType: 'FIXED' | 'PER_MEMBER';
  minMembers: number;
}

const DEFAULT_FORMATS: FormatItem[] = [
  { id: 1, name: 'Solo',           lotes: [{ data_virada: '2026-05-01', preco: 100 }, { data_virada: null, preco: 120 }], pricingType: 'FIXED',      minMembers: 1 },
  { id: 2, name: 'Duo',            lotes: [{ data_virada: '2026-05-01', preco: 160 }, { data_virada: null, preco: 180 }], pricingType: 'FIXED',      minMembers: 2 },
  { id: 3, name: 'Trio',           lotes: [{ data_virada: '2026-05-01', preco: 210 }, { data_virada: null, preco: 240 }], pricingType: 'FIXED',      minMembers: 3 },
  { id: 4, name: 'Conjunto/Grupo', lotes: [{ data_virada: '2026-05-01', preco: 45  }, { data_virada: null, preco: 55  }], pricingType: 'PER_MEMBER', minMembers: 4 },
];

/** Migra formato legado (price_lote1/lote2/data_virada) pro modelo de N lotes */
const migrateFormat = (f: any): FormatItem => {
  if (Array.isArray(f.lotes) && f.lotes.length > 0) {
    return { ...f, lotes: f.lotes };
  }
  const lotes: FormatLote[] = [];
  if (f.price_lote1 != null) lotes.push({ data_virada: f.data_virada || null, preco: Number(f.price_lote1) });
  if (f.price_lote2 != null) lotes.push({ data_virada: null, preco: Number(f.price_lote2) });
  if (lotes.length === 0) lotes.push({ data_virada: null, preco: 0 });
  return {
    id: f.id,
    name: f.name,
    lotes,
    pricingType: f.pricingType ?? 'FIXED',
    minMembers: f.minMembers ?? 1,
  };
};

const DEFAULT_CATEGORIES = [
  { id: 1, name: 'Infantil', min: 7,  max: 11 },
  { id: 2, name: 'Junior',   min: 12, max: 14 },
  { id: 3, name: 'Sênior',   min: 15, max: 17 },
  { id: 4, name: 'Adulto',   min: 18, max: 99 },
];

/* ─── Sugestões de subgêneros do mercado de festivais de dança ─── */
const SUBGENRE_SUGGESTIONS: Record<string, string[]> = {
  'danças urbanas': [
    'Breaking', 'Hip-Hop', 'Popping', 'Locking', 'Waacking',
    'Voguing', 'House Dance', 'Krump', 'Dancehall', 'Afrobeats',
    'Litefeet', 'Turfing', 'Flexing',
  ],
  'estilo livre': [
    'Contemporâneo', 'Jazz', 'Funk', 'Acrobacia', 'Dança Criativa',
    'Musical Theatre', 'Experimental', 'Fusão', 'Lírico', 'Neoclássico',
    'Dança Cênica',
  ],
  'k-pop': [
    'Girl Group', 'Boy Group', 'Solo', 'Collab', 'Coreografia Original',
    'Cover Fiel', 'Freestyle K-Pop',
  ],
  'clássico': [
    'Clássico Infantil', 'Variação Solo', 'Pas de Deux', 'Grand Allegro',
    'Demi-Caractère', 'Contemporâneo Clássico', 'Dança de Caráter',
  ],
  'ballet clássico': [
    'Clássico Infantil', 'Variação Solo', 'Pas de Deux', 'Grand Allegro',
    'Demi-Caractère', 'Contemporâneo Clássico',
  ],
  'balé clássico': [
    'Clássico Infantil', 'Variação Solo', 'Pas de Deux', 'Grand Allegro',
    'Demi-Caractère', 'Contemporâneo Clássico',
  ],
  'jazz': [
    'Jazz Técnico', 'Jazz Show', 'Lyrical Jazz', 'Broadway Jazz',
    'Funk Jazz', 'Street Jazz', 'Jazz Contemporâneo',
  ],
};

/* ─── shared input style ─── */
const input = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm dark:[color-scheme:dark]';
const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

/* ═══════════════════════ EventCommissionCard ═══════════════════════ */
interface EventCommissionCardProps {
  event: { id: string; name: string; commission_type?: string; commission_percent?: number; commission_fixed?: number; fee_mode?: string };
  saving: boolean;
  onSave: (patch: { commission_type: string; commission_percent: number; commission_fixed: number; fee_mode: string }) => void;
}

const EventCommissionCard: React.FC<EventCommissionCardProps> = ({ event, saving, onSave }) => {
  const [type, setType]       = useState(event.commission_type ?? 'percent');
  const [percent, setPercent] = useState(event.commission_percent ?? 10);
  const [fixed, setFixed]     = useState(event.commission_fixed ?? 0);
  const [feeMode, setFeeMode] = useState(event.fee_mode ?? 'repassar');
  const [dirty, setDirty]     = useState(false);

  const previewFee = (valor: number) => {
    if (type === 'percent')  return (valor * percent / 100).toFixed(2);
    if (type === 'fixed')    return fixed.toFixed(2);
    return (valor * percent / 100 + fixed).toFixed(2);
  };

  return (
    <div className="border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
      <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">{event.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Tipo */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1">Modelo</label>
          <select
            value={type}
            onChange={e => { setType(e.target.value); setDirty(true); }}
            className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm"
          >
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor Fixo (R$)</option>
            <option value="combined">Combinado (% + R$)</option>
          </select>
        </div>

        {/* Percentual */}
        {(type === 'percent' || type === 'combined') && (
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1">Percentual (%)</label>
            <div className="relative">
              <Percent size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number" min={0} max={100} step={0.5}
                value={percent}
                onChange={e => { setPercent(Number(e.target.value)); setDirty(true); }}
                className="w-full pl-9 bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 pr-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm"
              />
            </div>
          </div>
        )}

        {/* Fixo */}
        {(type === 'fixed' || type === 'combined') && (
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1">Valor Fixo (R$)</label>
            <div className="relative">
              <Hash size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number" min={0} step={0.5}
                value={fixed}
                onChange={e => { setFixed(Number(e.target.value)); setDirty(true); }}
                className="w-full pl-9 bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 pr-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Toggle fee_mode */}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2 ml-1">Quem paga a taxa?</label>
        <div className="grid grid-cols-2 gap-2">
          {(['repassar', 'absorver'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { setFeeMode(mode); setDirty(true); }}
              className={`py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                feeMode === mode
                  ? 'bg-[#ff0068] text-white border-[#ff0068]'
                  : 'bg-transparent text-slate-500 border-slate-200 dark:border-white/10 hover:border-[#ff0068]/40'
              }`}
            >
              {mode === 'repassar' ? '🎭 Bailarino paga' : '🏠 Produtor absorve'}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-slate-400 mt-1.5 ml-1">
          {feeMode === 'repassar'
            ? 'Exemplo R$100: bailarino paga R$110, produtor recebe R$100.'
            : 'Exemplo R$100: bailarino paga R$100, produtor recebe R$90.'}
        </p>
      </div>

      {/* Preview + salvar */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="text-[10px] text-slate-500">
          Plataforma retém{' '}
          <span className="font-black text-[#ff0068]">R$ {previewFee(100)}</span>
          {' '}em R$100 de inscrição
        </div>
        {dirty && (
          <button
            onClick={() => { onSave({ commission_type: type, commission_percent: percent, commission_fixed: fixed, fee_mode: feeMode }); setDirty(false); }}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar
          </button>
        )}
      </div>
    </div>
  );
};

/* ════════════════════════ AccountSettings ════════════════════════ */
const AccountSettings = ({ onSaveSuccess }: { onSaveSuccess?: () => void }) => {
  const [activeTab, setActiveTab] = useState<TabType>('Geral');
  const [saving, setSaving]       = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [isFirstSave, setIsFirstSave] = useState(false);

  /* ── Pagamentos / Asaas ── */
  const [asaasProfile, setAsaasProfile] = useState<{
    asaas_subconta_id?: string;
    asaas_wallet_id?: string;
    cpf_cnpj?: string;
    pix_key?: string;
  } | null>(null);
  const [asaasLoading, setAsaasLoading]         = useState(false);
  const [asaasForm, setAsaasForm]               = useState({ cpf_cnpj: '', pix_key: '', company_type: 'MEI', income_value: '' });
  const [asaasFormError, setAsaasFormError]     = useState<string | null>(null);
  const [currentUserId, setCurrentUserId]       = useState<string | null>(null);
  const [mpEvents, setMpEvents]                 = useState<any[]>([]);
  const [savingCommission, setSavingCommission] = useState<string | null>(null);

  /* carrega perfil Asaas e eventos ao montar */
  useEffect(() => {
    const loadAsaasData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
      const { data: profile } = await supabase
        .from('profiles')
        .select('asaas_subconta_id, asaas_wallet_id, cpf_cnpj, pix_key')
        .eq('id', user.id)
        .single();
      setAsaasProfile(profile);
      const { data: events } = await supabase
        .from('events')
        .select('id, name, commission_type, commission_percent, commission_fixed, fee_mode')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      setMpEvents(events ?? []);
    };
    loadAsaasData();
  }, []);

  const handleConnectAsaas = async () => {
    setAsaasFormError(null);
    if (!asaasForm.cpf_cnpj.trim()) { setAsaasFormError('Informe seu CPF ou CNPJ.'); return; }
    if (!asaasForm.pix_key.trim())  { setAsaasFormError('Informe sua chave PIX para receber os repasses.'); return; }
    const incomeNum = parseFloat(asaasForm.income_value.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!incomeNum || incomeNum <= 0) { setAsaasFormError('Informe sua renda mensal ou faturamento.'); return; }
    setAsaasLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/create-asaas-subconta', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          cpf_cnpj:     asaasForm.cpf_cnpj,
          pix_key:      asaasForm.pix_key,
          company_type: asaasForm.cpf_cnpj.replace(/\D/g, '').length === 14 ? asaasForm.company_type : undefined,
          income_value: incomeNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao conectar conta Asaas.');
      const { data: profile } = await supabase
        .from('profiles')
        .select('asaas_subconta_id, asaas_wallet_id, cpf_cnpj, pix_key')
        .eq('id', currentUserId!)
        .single();
      setAsaasProfile(profile);
    } catch (err: any) {
      setAsaasFormError(err.message);
    } finally {
      setAsaasLoading(false);
    }
  };

  const handleDisconnectAsaas = async () => {
    if (!currentUserId) return;
    if (!confirm('Deseja desconectar sua conta? Os pagamentos ficarão indisponíveis até reconectar.')) return;
    setAsaasLoading(true);
    await supabase.from('profiles').update({
      asaas_subconta_id: null, asaas_wallet_id: null,
      cpf_cnpj: null, pix_key: null,
    }).eq('id', currentUserId);
    setAsaasProfile(null);
    setAsaasLoading(false);
  };

  const handleSaveCommission = async (eventId: string, patch: { commission_type: string; commission_percent: number; commission_fixed: number; fee_mode?: string }) => {
    setSavingCommission(eventId);
    await supabase.from('events').update(patch).eq('id', eventId);
    setMpEvents(evs => evs.map(e => e.id === eventId ? { ...e, ...patch } : e));
    setSavingCommission(null);
  };

  const [general, setGeneral] = useState({ ...DEFAULT_GENERAL });
  const [styles,  setStyles]  = useState<string[]>(DEFAULT_MODALITIES);
  const [formats, setFormats] = useState<any[]>(DEFAULT_FORMATS);
  const [categories, setCategories] = useState<any[]>(DEFAULT_CATEGORIES);
  const [links,   setLinks]   = useState<any[]>([]);

  /* ── Gêneros (Eixo Técnico) ── */
  const [genres,        setGenres]        = useState<EventStyle[]>([]);
  const [genresLoading, setGenresLoading] = useState(false);
  const [genresError,   setGenresError]   = useState<string | null>(null);
  const [expandedGenre, setExpandedGenre] = useState<string | null>(null);

  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);

  /* ── Regras de Avaliação — Global + Exceções ── */
  const [globalRules,    setGlobalRules]    = useState<EvalRules>(DEFAULT_GLOBAL_RULES);
  const [genreOverrides, setGenreOverrides] = useState<Record<string, EvalRules | null>>({});

  const isUsingGlobal = (genreId: string) => genreOverrides[genreId] == null;

  const getEffectiveRules = (genreId: string): EvalRules =>
    genreOverrides[genreId] ?? globalRules;

  const toggleOverride = (genreId: string) => {
    if (isUsingGlobal(genreId)) {
      // Create a custom copy of the global rules
      setGenreOverrides(prev => ({ ...prev, [genreId]: { ...globalRules, criterios: [...globalRules.criterios] } }));
    } else {
      // Revert to global
      setGenreOverrides(prev => ({ ...prev, [genreId]: null }));
    }
  };

  /* ── helpers for GLOBAL rules ── */
  const updateGlobalCriterion = (idx: number, patch: Partial<EvalCriterion>) => {
    const criterios = globalRules.criterios.map((c, i) => i === idx ? { ...c, ...patch } : c);
    setGlobalRules({ criterios, desempate: buildDefaultTiebreaker(criterios) });
  };
  const addGlobalCriterion = () => {
    const criterios = [...globalRules.criterios, { name: 'Novo Quesito', peso: 1 }];
    setGlobalRules({ criterios, desempate: buildDefaultTiebreaker(criterios) });
  };
  const removeGlobalCriterion = (idx: number) => {
    const criterios = globalRules.criterios.filter((_, i) => i !== idx);
    setGlobalRules({ criterios, desempate: buildDefaultTiebreaker(criterios) });
  };
  const moveGlobalTiebreaker = (idx: number, dir: 1 | -1) => {
    const d = [...globalRules.desempate];
    const target = idx + dir;
    if (target < 0 || target >= d.length) return;
    [d[idx], d[target]] = [d[target], d[idx]];
    setGlobalRules({ ...globalRules, desempate: d });
  };

  /* ── helpers for OVERRIDE rules ── */
  const updateCriterion = (genreId: string, idx: number, patch: Partial<EvalCriterion>) => {
    const rules = getEffectiveRules(genreId);
    const criterios = rules.criterios.map((c, i) => i === idx ? { ...c, ...patch } : c);
    setGenreOverrides(prev => ({ ...prev, [genreId]: { criterios, desempate: buildDefaultTiebreaker(criterios) } }));
  };
  const addCriterion = (genreId: string) => {
    const rules = getEffectiveRules(genreId);
    const criterios = [...rules.criterios, { name: 'Novo Quesito', peso: 1 }];
    setGenreOverrides(prev => ({ ...prev, [genreId]: { criterios, desempate: buildDefaultTiebreaker(criterios) } }));
  };
  const removeCriterion = (genreId: string, idx: number) => {
    const rules = getEffectiveRules(genreId);
    const criterios = rules.criterios.filter((_, i) => i !== idx);
    setGenreOverrides(prev => ({ ...prev, [genreId]: { criterios, desempate: buildDefaultTiebreaker(criterios) } }));
  };
  const moveTiebreaker = (genreId: string, idx: number, dir: 1 | -1) => {
    const rules = getEffectiveRules(genreId);
    const d = [...rules.desempate];
    const target = idx + dir;
    if (target < 0 || target >= d.length) return;
    [d[idx], d[target]] = [d[target], d[idx]];
    setGenreOverrides(prev => ({ ...prev, [genreId]: { ...rules, desempate: d } }));
  };

  /* ── Prêmios Especiais ── */
  const [awards, setAwards] = useState<SpecialAward[]>(
    AWARD_TEMPLATES.map(t => ({ ...t, enabled: false }))
  );
  const [newAwardName, setNewAwardName]           = useState('');
  const [newAwardFormation, setNewAwardFormation] = useState('TODOS');
  const [newAwardDesc, setNewAwardDesc]           = useState('');

  const toggleAward = (id: string) =>
    setAwards(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));

  const setAwardFormation = (id: string, formation: string) =>
    setAwards(prev => prev.map(a => a.id === id ? { ...a, formation } : a));

  const addCustomAward = () => {
    if (!newAwardName.trim()) return;
    const award: SpecialAward = {
      id:          `custom_${Date.now()}`,
      name:        newAwardName.trim(),
      enabled:     true,
      isTemplate:  false,
      formation:   newAwardFormation,
      description: newAwardDesc.trim(),
    };
    setAwards(prev => [...prev, award]);
    setNewAwardName('');
    setNewAwardDesc('');
    setNewAwardFormation('TODOS');
  };

  const removeAward = (id: string) =>
    setAwards(prev => prev.filter(a => a.id !== id));

  /* modal de gênero */
  const [genreModal, setGenreModal] = useState<{
    open: boolean;
    mode: 'add-genre' | 'edit-genre' | 'add-sub' | 'edit-sub';
    genre?: EventStyle;
    subIndex?: number;
    tempName: string;
    tempFree: boolean;
    tempShorterTrack: boolean;
  }>({ open: false, mode: 'add-genre', tempName: '', tempFree: false, tempShorterTrack: false });

  const [flowConfig, setFlowConfig] = useState({
    tempo_entrada: 15,
    texto_ia: 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]',
    marcar_palco_ativo: true,
    intervalo_seguranca: 3,
    tempo_marcacao_palco: 45,
    gatilho_marcacao: 'MANUAL_MARCADOR' as 'MANUAL_MARCADOR' | 'MANUAL_COORDENADOR' | 'AUTO_SONOPLASTA',
  });

  const [toleranceRule, setToleranceRule] = useState<{ mode: 'PERCENT' | 'COUNT'; value: number; enforcement?: 'FLEXIBLE' | 'STRICT' }>({
    mode: 'PERCENT',
    value: 20,
    enforcement: 'FLEXIBLE',
  });

  /* ── Age Reference ── */
  const [ageReference, setAgeReference] = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefDate,   setAgeRefDate]   = useState('');

  /* modal state */
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode,   setModalMode]   = useState<'add' | 'edit'>('add');
  const [editingId,   setEditingId]   = useState<number | string | null>(null);
  const [tempValue,   setTempValue]   = useState<any>({});

  /* ── fetch ── */
  const fetchGenres = useCallback(async () => {
    setGenresLoading(true);
    setGenresError(null);
    try {
      const data = await getAllGenres();
      setGenres(data);
    } catch (e: any) {
      setGenresError(e.message || 'Erro ao carregar gêneros');
    } finally {
      setGenresLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGenres();
  }, [fetchGenres]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase.from('configuracoes').select('*').eq('id', 1).single();
        setIsFirstSave(!data?.atualizado_em);
        if (data) {
          setGeneral({
            eventName:          data.nome_evento      || DEFAULT_GENERAL.eventName,
            location:           data.local_evento     || DEFAULT_GENERAL.location,
            city:               data.cidade_estado    || DEFAULT_GENERAL.city,
            eventDate:          data.data_evento      || DEFAULT_GENERAL.eventDate,
            regDeadline:        data.prazo_inscricao  || DEFAULT_GENERAL.regDeadline,
            trackDeadline:      data.prazo_trilhas    || DEFAULT_GENERAL.trackDeadline,
            tipos_apresentacao: data.tipos_apresentacao?.length
              ? data.tipos_apresentacao
              : DEFAULT_GENERAL.tipos_apresentacao,
            scoreScale: (data.escala_notas as ScoreScale) || DEFAULT_GENERAL.scoreScale,
            pinInactivityMinutes: data.pin_inactivity_minutes ?? DEFAULT_GENERAL.pinInactivityMinutes,
            medalThresholds: data.medal_thresholds ?? DEFAULT_GENERAL.medalThresholds,
          });
          setStyles(data.estilos?.length    ? data.estilos    : DEFAULT_MODALITIES);
          setFormats(data.formatos?.length ? data.formatos.map(migrateFormat) : DEFAULT_FORMATS);
          setCategories(data.categorias?.length ? data.categorias : DEFAULT_CATEGORIES);
          setLinks(data.links || []);
          if (data.tolerancia) setToleranceRule(data.tolerancia);
          if (data.age_reference) setAgeReference(data.age_reference as 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE');
          if (data.age_reference_date) setAgeRefDate(data.age_reference_date);
          if (data.premios_especiais && Array.isArray(data.premios_especiais)) {
            // Merge saved data with templates (preserve template structure, apply enabled/formation)
            const saved: SpecialAward[] = data.premios_especiais;
            const savedMap: Record<string, SpecialAward> = {};
            saved.forEach(a => { savedMap[a.id] = a; });
            const merged = AWARD_TEMPLATES.map(t =>
              savedMap[t.id] ? { ...t, ...savedMap[t.id] } : { ...t, enabled: false }
            );
            // Re-append custom awards (those not in templates)
            const customs = saved.filter(a => !a.isTemplate);
            setAwards([...merged, ...customs]);
          }
          if (data.regras_avaliacao) {
            const saved = data.regras_avaliacao as any;
            // New format: { globalRules, overrides }
            if (saved.globalRules) {
              setGlobalRules(saved.globalRules);
              setGenreOverrides(saved.overrides ?? {});
            } else {
              // Legacy: flat GenreRulesMap — migrate: first entry becomes global, rest become overrides
              const entries = Object.entries(saved) as [string, EvalRules][];
              if (entries.length > 0) {
                setGlobalRules(entries[0][1]);
                const overrides: Record<string, EvalRules | null> = {};
                entries.slice(1).forEach(([id, r]) => { overrides[id] = r; });
                setGenreOverrides(overrides);
              }
            }
          }
          setFlowConfig({
            tempo_entrada:        data.tempo_entrada         ?? 15,
            texto_ia:             data.texto_ia              ?? flowConfig.texto_ia,
            marcar_palco_ativo:   data.marcar_palco_ativo    ?? true,
            intervalo_seguranca:  data.intervalo_seguranca   ?? 3,
            tempo_marcacao_palco: data.tempo_marcacao_palco  ?? 45,
            gatilho_marcacao:     data.gatilho_marcacao      ?? 'MANUAL_MARCADOR',
          });
        }
      } catch (err) {
        console.error('Erro ao carregar configurações:', err);
      }
    };
    fetchConfig();
  }, []);

  /* ── save ── */
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado.');

      const { error: sbError } = await supabase.from('configuracoes').upsert({
        id: 1,
        nome_evento:         general.eventName,
        local_evento:        general.location,
        cidade_estado:       general.city,
        data_evento:         general.eventDate,
        prazo_inscricao:     general.regDeadline,
        prazo_trilhas:       general.trackDeadline,
        tipos_apresentacao:  general.tipos_apresentacao,
        escala_notas:        general.scoreScale,
        pin_inactivity_minutes: general.pinInactivityMinutes,
        medal_thresholds:    general.medalThresholds,
        estilos:             styles,
        formatos:            formats,
        categorias:          categories,
        tolerancia:          toleranceRule,
        age_reference:       ageReference,
        age_reference_date:  ageReference === 'FIXED_DATE' ? (ageRefDate || null) : null,
        tempo_entrada:        flowConfig.tempo_entrada,
        intervalo_seguranca:  flowConfig.intervalo_seguranca,
        texto_ia:             flowConfig.texto_ia,
        marcar_palco_ativo:   flowConfig.marcar_palco_ativo,
        tempo_marcacao_palco: flowConfig.tempo_marcacao_palco,
        gatilho_marcacao:     flowConfig.gatilho_marcacao,
        links,
        regras_avaliacao:    { globalRules, overrides: genreOverrides } satisfies EvalConfig,
        premios_especiais:   awards,
        atualizado_em:       new Date().toISOString(),
      }, { onConflict: 'id' });

      if (sbError) throw sbError;

      if (isFirstSave) {
        setIsFirstSave(false);
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        await supabase.functions.invoke('send-email', {
          body: {
            type: 'event_created_producer',
            payload: {
              produtorNome:  profileData?.full_name ?? '',
              produtorEmail: user.email ?? '',
              eventoNome:    general.eventName,
              eventoData:    general.eventDate,
              eventoLocal:   general.location,
              appUrl:        window.location.origin,
            },
          },
        });
      }

      if (onSaveSuccess) onSaveSuccess();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  /* ── modal helpers ── */
  const openAdd = () => {
    setModalMode('add');
    setEditingId(null);
    setTempValue(activeTab === 'Formações' ? { pricingType: 'FIXED', minMembers: 1, lotes: [{ data_virada: null, preco: 0 }] } : {});
    setIsModalOpen(true);
  };
  const openEdit = (id: number | string, data: any) => {
    setModalMode('edit');
    setEditingId(id);
    setTempValue(activeTab === 'Formações' ? migrateFormat(data) : data);
    setIsModalOpen(true);
  };
  const handleDelete = (id: number | string) => {
    if (activeTab === 'Formações')         setFormats(formats.filter(f => f.id !== id));
    if (activeTab === 'Categorias')        setCategories(categories.filter(c => c.id !== id));
    if (activeTab === 'Redirecionamentos') setLinks(links.filter((_: any, i: number) => i !== id));
  };
  const handleModalSubmit = () => {
    if (activeTab === 'Formações') {
      const { price_lote1, price_lote2, data_virada, ...clean } = tempValue;
      if (modalMode === 'add') setFormats([...formats, { ...clean, id: Date.now() }]);
      else setFormats(formats.map(f => f.id === editingId ? { ...clean, id: editingId } : f));
    }
    if (activeTab === 'Categorias') {
      if (modalMode === 'add') setCategories([...categories, { ...tempValue, id: Date.now() }]);
      else setCategories(categories.map(c => c.id === editingId ? { ...tempValue, id: editingId } : c));
    }
    if (activeTab === 'Redirecionamentos') {
      if (modalMode === 'add') setLinks([...links, tempValue]);
      else setLinks(links.map((l: any, i: number) => i === editingId ? tempValue : l));
    }
    setIsModalOpen(false);
  };

  /* ── small components ── */
  const CRUDHeader = ({ title, onAdd }: { title: string; onAdd: () => void }) => (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
        Gerenciar <span className="text-[#ff0068]">{title}</span>
      </h2>
      <button onClick={onAdd} className="flex items-center gap-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all">
        <Plus size={14} /> Adicionar
      </button>
    </div>
  );

  const Row = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
      {children}
    </div>
  );

  const ActBtns = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => (
    <div className="flex items-center gap-2">
      <button onClick={onEdit}   className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"><Pencil size={14} /></button>
      <button onClick={onDelete} className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"><Trash2 size={14} /></button>
    </div>
  );

  const toggleTipo = (id: string) => {
    setGeneral(prev => ({
      ...prev,
      tipos_apresentacao: prev.tipos_apresentacao.includes(id)
        ? prev.tipos_apresentacao.filter(t => t !== id)
        : [...prev.tipos_apresentacao, id],
    }));
  };

  /* ══════════════════════════════════════════
     TAB CONTENT
  ══════════════════════════════════════════ */
  const renderTab = () => {
    switch (activeTab) {

      /* ── GERAL ── */
      case 'Geral':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Dados do Evento */}
              <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Settings size={18} /></div>
                  <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Dados do Evento</h3>
                </div>
                <div>
                  <label className={label}>Nome do Festival</label>
                  <input type="text" value={general.eventName} onChange={e => setGeneral({ ...general, eventName: e.target.value })} placeholder="Ex: CoreoHub Festival" className={input} />
                </div>
                <div>
                  <label className={label}>Local do Evento</label>
                  <input type="text" value={general.location} onChange={e => setGeneral({ ...general, location: e.target.value })} placeholder="Ex: Ginásio Municipal - Centro" className={input} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label}>Cidade / Estado</label>
                    <input type="text" value={general.city} onChange={e => setGeneral({ ...general, city: e.target.value })} placeholder="Votuporanga, SP" className={input} />
                  </div>
                  <div>
                    <label className={label}>Data do Evento</label>
                    <input type="date" value={general.eventDate} onChange={e => setGeneral({ ...general, eventDate: e.target.value })} className={input} />
                  </div>
                </div>
              </div>

              {/* Prazos */}
              <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Clock size={18} /></div>
                  <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Prazos Limite</h3>
                </div>
                <div>
                  <label className={label}>Prazo Final de Inscrição</label>
                  <input type="date" value={general.regDeadline} onChange={e => setGeneral({ ...general, regDeadline: e.target.value })} className={input} />
                </div>
                <div>
                  <label className={label}>Prazo Final de Envio de Trilhas</label>
                  <input type="date" value={general.trackDeadline} onChange={e => setGeneral({ ...general, trackDeadline: e.target.value })} className={input} />
                </div>
              </div>
            </div>

            {/* Tipos de Apresentação */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Clapperboard size={18} /></div>
                <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Tipos de Apresentação Permitidos</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TIPOS_APRESENTACAO_OPTIONS.map(opt => {
                  const active = general.tipos_apresentacao.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleTipo(opt.id)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${
                        active
                          ? 'border-[#ff0068] bg-[#ff0068]/5 text-[#ff0068]'
                          : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      {active ? <CheckSquare size={18} /> : <Square size={18} />}
                      <span className="text-[11px] font-black uppercase tracking-widest">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        );

      /* ── GÊNEROS (Eixo Técnico) ── */
      case 'Gêneros':
        return (
          <div className="space-y-4">
            {/* header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Gêneros & <span className="text-[#ff0068]">Modalidades</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Eixo Técnico — cada gênero contém variações que se cruzam com Categoria e Formação no checkout.
                </p>
              </div>
              <button
                onClick={() => setGenreModal({ open: true, mode: 'add-genre', tempName: '', tempFree: false, tempShorterTrack: false })}
                className="flex items-center gap-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
              >
                <Plus size={14} /> Novo Gênero
              </button>
            </div>

            {genresLoading && (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 size={24} className="animate-spin mr-3" /> Carregando gêneros…
              </div>
            )}

            {genresError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 text-sm">
                {genresError}
              </div>
            )}

            {!genresLoading && !genresError && genres.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-3xl">
                <Music2 size={32} className="mb-3 opacity-40" />
                <p className="text-sm font-bold">Nenhum gênero cadastrado.</p>
                <p className="text-xs mt-1">Clique em "Novo Gênero" para começar.</p>
              </div>
            )}

            {genres.map(genre => {
              const isExpanded = expandedGenre === genre.id;
              return (
                <div key={genre.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
                  {/* Genre header row */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <button
                      onClick={() => setExpandedGenre(isExpanded ? null : genre.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-9 h-9 bg-[#ff0068]/10 rounded-xl flex items-center justify-center text-[#ff0068] shrink-0">
                        <Music2 size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-sm uppercase tracking-wide text-slate-900 dark:text-white">{genre.name}</p>
                        <p className="text-[10px] text-slate-500">
                          {genre.sub_types.length === 0
                            ? 'Sem modalidades'
                            : `${genre.sub_types.length} modalidade${genre.sub_types.length > 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </button>

                    {/* is_active toggle */}
                    <button
                      title={genre.is_active ? 'Ativo' : 'Inativo'}
                      onClick={async () => {
                        try {
                          const updated = await updateGenre(genre.id, { is_active: !genre.is_active });
                          setGenres(gs => gs.map(g => g.id === genre.id ? updated : g));
                        } catch {}
                      }}
                      className={`text-xs font-black px-3 py-1 rounded-lg transition-all ${genre.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}
                    >
                      {genre.is_active ? 'ATIVO' : 'INATIVO'}
                    </button>

                    <button
                      onClick={() => setGenreModal({ open: true, mode: 'edit-genre', genre, tempName: genre.name, tempFree: false, tempShorterTrack: false })}
                      className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Excluir "${genre.name}" e todas as suas modalidades?`)) return;
                        try {
                          await deleteGenre(genre.id);
                          setGenres(gs => gs.filter(g => g.id !== genre.id));
                        } catch (e: any) {
                          alert('Erro ao excluir: ' + e.message);
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => setExpandedGenre(isExpanded ? null : genre.id)}
                      className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>

                  {/* Subgenres accordion */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-slate-200 dark:border-white/10 px-5 pb-4 pt-3 space-y-2">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Modalidades</p>
                            <button
                              onClick={() => setGenreModal({ open: true, mode: 'add-sub', genre, tempName: '', tempFree: false, tempShorterTrack: false })}
                              className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
                            >
                              <Plus size={11} /> Adicionar
                            </button>
                          </div>

                          {genre.sub_types.length === 0 && (
                            <p className="text-xs text-slate-400 py-2 text-center">
                              Nenhuma modalidade. Adicione acima.
                            </p>
                          )}

                          {genre.sub_types.map((sub, idx) => (
                            <div key={idx} className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 dark:bg-white/5 rounded-xl">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#ff0068] shrink-0" />
                              <span className="flex-1 text-sm font-bold text-slate-900 dark:text-white">{sub.name}</span>

                              {/* Categoria Livre toggle */}
                              <button
                                onClick={async () => {
                                  try {
                                    const updated = await editSubgenre(genre, idx, { ...sub, is_categoria_livre: !sub.is_categoria_livre });
                                    setGenres(gs => gs.map(g => g.id === genre.id ? updated : g));
                                  } catch {}
                                }}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                  sub.is_categoria_livre
                                    ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                    : 'bg-slate-200 dark:bg-white/10 text-slate-500'
                                }`}
                                title={sub.is_categoria_livre ? 'Sem limite de idade (Categoria Livre)' : 'Respeita faixas etárias'}
                              >
                                {sub.is_categoria_livre ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                                {sub.is_categoria_livre ? 'Livre' : 'Com Idade'}
                              </button>

                              {sub.allow_shorter_track && (
                                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-violet-500/10 text-violet-500 border border-violet-500/20" title="Duração mínima de trilha ignorada (Repertório)">
                                  <Music2 size={10} /> Repertório
                                </span>
                              )}

                              <button
                                onClick={() => setGenreModal({ open: true, mode: 'edit-sub', genre, subIndex: idx, tempName: sub.name, tempFree: sub.is_categoria_livre, tempShorterTrack: sub.allow_shorter_track ?? false })}
                                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    const updated = await removeSubgenre(genre, idx);
                                    setGenres(gs => gs.map(g => g.id === genre.id ? updated : g));
                                  } catch {}
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}

                          {/* ── Avaliação — resumo inline ── */}
                          {(() => {
                            const usingGlobal    = isUsingGlobal(genre.id);
                            const effectiveRules = getEffectiveRules(genre.id);
                            const total          = pesoTotal(effectiveRules.criterios);
                            return (
                              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <Scale size={12} className="text-[#ff0068]" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white/80">Regras de Avaliação</span>
                                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                                      usingGlobal
                                        ? 'bg-[#ff0068]/10 text-[#ff0068]'
                                        : 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                                    }`}>
                                      {usingGlobal ? 'Global' : 'Personalizada'}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => setActiveTab('Avaliação')}
                                    className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-[#ff0068] transition-colors"
                                  >
                                    Editar →
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {effectiveRules.criterios.map((c, i) => (
                                    <span key={i} className="flex items-center gap-1 px-2 py-1 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-lg text-[9px] font-bold text-slate-600 dark:text-slate-300">
                                      {c.name}
                                      <span className="text-[#ff0068] font-black">×{c.peso}</span>
                                      {total > 0 && <span className="text-slate-400">({Math.round((c.peso/total)*100)}%)</span>}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* ── Sugestões do mercado ── */}
                          {(() => {
                            const key = genre.name.toLowerCase().trim();
                            const suggestions = SUBGENRE_SUGGESTIONS[key];
                            if (!suggestions) return null;
                            const existingNames = genre.sub_types.map(s => s.name.toLowerCase());
                            const available = suggestions.filter(s => !existingNames.includes(s.toLowerCase()));
                            if (available.length === 0) return null;
                            return (
                              <div className="pt-3 mt-1 border-t border-slate-200 dark:border-white/5">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-1.5">
                                  <Sparkles size={10} className="text-[#ff0068]" />
                                  Sugestões do mercado — clique para adicionar
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {available.map(suggestion => {
                                    const sid = `${genre.id}-${suggestion}`;
                                    const isAdding = addingSuggestion === sid;
                                    return (
                                      <button
                                        key={suggestion}
                                        disabled={isAdding}
                                        onClick={async () => {
                                          setAddingSuggestion(sid);
                                          try {
                                            const updated = await addSubgenre(genre, { name: suggestion, is_categoria_livre: false });
                                            setGenres(gs => gs.map(g => g.id === genre.id ? updated : g));
                                          } catch (e: any) {
                                            alert('Erro: ' + e.message);
                                          } finally {
                                            setAddingSuggestion(null);
                                          }
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-white/5 border border-dashed border-slate-300 dark:border-white/10 rounded-full text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:border-[#ff0068] hover:text-[#ff0068] hover:bg-[#ff0068]/5 transition-all disabled:opacity-50"
                                      >
                                        {isAdding
                                          ? <Loader2 size={10} className="animate-spin" />
                                          : <Plus size={10} />
                                        }
                                        {suggestion}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        );

      /* ── FORMAÇÕES (Eixo de Formação) ── */
      case 'Formações':
        return (
          <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl">
            <CRUDHeader title="Formatos & Lotes de Preço" onAdd={openAdd} />
            <div className="space-y-3">
              {formats.map(f => (
                <Row key={f.id}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-[#ff0068]/10 rounded-xl flex items-center justify-center text-[#ff0068] shrink-0">
                      <DollarSign size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase">{f.name}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                        {f.pricingType === 'PER_MEMBER' ? 'por participante' : 'valor fixo'} · mín. {f.minMembers} pessoa{f.minMembers > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mr-4 flex-wrap justify-end">
                    {(f.lotes ?? []).map((lote: FormatLote, i: number) => (
                      <React.Fragment key={i}>
                        {i > 0 && <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />}
                        <div className="text-center">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Lote {i + 1}</p>
                          <p className={`font-black ${i === 0 ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>R$ {lote.preco}</p>
                          <p className="text-[9px] text-slate-400 mt-0.5">
                            {lote.data_virada ? `até ${lote.data_virada}` : 'até prazo final'}
                          </p>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <ActBtns onEdit={() => openEdit(f.id, f)} onDelete={() => handleDelete(f.id)} />
                </Row>
              ))}
              {formats.length === 0 && (
                <p className="text-center text-slate-400 py-8 text-sm">Nenhum formato cadastrado.</p>
              )}
            </div>
          </div>
        );

      /* ── CATEGORIAS ── */
      case 'Categorias':
        return (
          <div className="space-y-6">
            {/* ── Age Reference Config ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><CalendarRange size={18} /></div>
                <div>
                  <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Referência de Idade</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Data usada para calcular a idade dos bailarinos ao validar categorias.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {([
                  {
                    v: 'EVENT_DAY' as const,
                    icon: Calendar,
                    label: 'Data do Evento',
                    desc: 'A idade é calculada no dia em que o evento ocorre (recomendado).',
                  },
                  {
                    v: 'YEAR_END' as const,
                    icon: CalendarDays,
                    label: 'Fim do Ano Corrente',
                    desc: 'A idade é calculada em 31/12 do ano em que o evento ocorre. Comum em festivais de dança clássica.',
                  },
                  {
                    v: 'FIXED_DATE' as const,
                    icon: CalendarRange,
                    label: 'Data Personalizada',
                    desc: 'Escolha qualquer data de referência manualmente.',
                  },
                ]).map(opt => {
                  const Icon = opt.icon;
                  const active = ageReference === opt.v;
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setAgeReference(opt.v)}
                      className={`flex items-start gap-4 p-5 rounded-2xl border text-left transition-all ${
                        active
                          ? 'border-[#ff0068] bg-[#ff0068]/5'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <div className={`mt-0.5 p-2 rounded-xl ${active ? 'bg-[#ff0068]/10 text-[#ff0068]' : 'bg-slate-100 dark:bg-white/10 text-slate-400'}`}>
                        <Icon size={15} />
                      </div>
                      <div>
                        <p className={`text-[11px] font-black uppercase tracking-widest ${active ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                          {opt.label}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {ageReference === 'FIXED_DATE' && (
                <div className="space-y-2">
                  <label className={label}>Data de Referência Personalizada</label>
                  <input
                    type="date"
                    value={ageRefDate}
                    onChange={e => setAgeRefDate(e.target.value)}
                    className={input}
                  />
                  <p className="text-[11px] text-slate-400">
                    A idade de todos os bailarinos será calculada nesta data, independente de quando o evento ocorre.
                  </p>
                </div>
              )}
            </div>

            {/* ── Faixas Etárias ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl">
            <CRUDHeader title="Faixas Etárias" onAdd={openAdd} />
            <div className="space-y-3">
              {categories.map(c => (
                <Row key={c.id}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#ff0068]/10 rounded-xl flex items-center justify-center text-[#ff0068]">
                      <Users size={16} />
                    </div>
                    <div>
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase">{c.name}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                        {!c.max || c.max >= 99 ? `${c.min}+ anos` : `${c.min} – ${c.max} anos`}
                      </p>
                    </div>
                  </div>
                  <ActBtns onEdit={() => openEdit(c.id, c)} onDelete={() => handleDelete(c.id)} />
                </Row>
              ))}
              {categories.length === 0 && (
                <p className="text-center text-slate-400 py-8 text-sm">Nenhuma categoria cadastrada.</p>
              )}
            </div>
            </div>
          </div>
        );

      /* ── TOLERÂNCIA ── */
      case 'Tolerância':
        return (
          <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl max-w-2xl space-y-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><AlertTriangle size={18} /></div>
              <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Regra de Tolerância de Idade</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 -mt-4">
              Define quantos participantes podem estar fora da faixa etária da categoria sem desclassificação.
            </p>

            <div className="space-y-3">
              <label className={label}>Modo de Tolerância</label>
              <div className="grid grid-cols-2 gap-4">
                {([
                  { v: 'PERCENT' as const, label: 'Percentual (%)',  suffix: '%',       max: 100, placeholder: '20' },
                  { v: 'COUNT'   as const, label: 'Quantidade Fixa', suffix: 'pessoas',  max: 20,  placeholder: '2'  },
                ]).map(opt => {
                  const active = toleranceRule.mode === opt.v;
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setToleranceRule(r => ({ ...r, mode: opt.v }))}
                      className={`p-5 rounded-2xl border text-left transition-all space-y-4 ${
                        active
                          ? 'border-[#ff0068] bg-[#ff0068]/5'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <p className={`text-[11px] font-black uppercase tracking-widest ${active ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                        {opt.label}
                      </p>
                      {active && (
                        <div
                          className="flex items-center gap-2"
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            type="number"
                            min={0}
                            max={opt.max}
                            value={toleranceRule.value}
                            onChange={e => setToleranceRule(r => ({ ...r, value: Number(e.target.value) }))}
                            className="w-20 bg-white dark:bg-slate-900 border border-[#ff0068]/40 rounded-xl py-2 px-3 text-[#ff0068] font-black text-lg text-center focus:outline-none focus:border-[#ff0068]"
                            placeholder={opt.placeholder}
                          />
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{opt.suffix}</span>
                        </div>
                      )}
                      {!active && (
                        <p className="text-[10px] text-slate-400">
                          {opt.v === 'PERCENT' ? 'Ex: até 20% do grupo' : 'Ex: até 2 participantes'}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className={label}>Como lidar com violações?</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {([
                  { v: 'FLEXIBLE' as const, label: 'Flexível', desc: 'Permite inscrever — produtor aprova manualmente as violações' },
                  { v: 'STRICT'   as const, label: 'Rígido',   desc: 'Bloqueia inscrição que viole a tolerância automaticamente' },
                ]).map(opt => {
                  const enforcement = toleranceRule.enforcement ?? 'FLEXIBLE';
                  const active = enforcement === opt.v;
                  return (
                    <button
                      key={opt.v}
                      onClick={() => setToleranceRule(r => ({ ...r, enforcement: opt.v }))}
                      className={`p-5 rounded-2xl border text-left transition-all ${
                        active
                          ? 'border-[#ff0068] bg-[#ff0068]/5'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <p className={`text-[11px] font-black uppercase tracking-widest mb-2 ${active ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl">
              <p className="text-[11px] font-black text-[#ff0068] uppercase tracking-widest mb-1">Resumo da Regra</p>
              <p className="text-sm text-slate-900 dark:text-white">
                {toleranceRule.mode === 'PERCENT'
                  ? `Até ${toleranceRule.value}% dos participantes do grupo pode estar fora da faixa etária.`
                  : `Até ${toleranceRule.value} participante(s) pode(m) estar fora da faixa etária.`}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {(toleranceRule.enforcement ?? 'FLEXIBLE') === 'STRICT'
                  ? '🔒 Inscrições que violarem serão bloqueadas no momento da submissão.'
                  : '✋ Inscrições que violarem ficarão pendentes de aprovação manual do produtor.'}
              </p>
            </div>
          </div>
        );

      /* ── FLUXO DO EVENTO ── */
      case 'Fluxo do Evento':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Settings size={18} /></div>
                <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Texto de Narração IA</h3>
              </div>
              <p className="text-xs text-slate-500 -mt-4">
                Use os marcadores <code className="text-[#ff0068] bg-[#ff0068]/10 px-1 rounded">[COREOGRAFIA]</code> e <code className="text-[#ff0068] bg-[#ff0068]/10 px-1 rounded">[ESTUDIO]</code> para personalizar.
              </p>
              <textarea
                rows={6}
                value={flowConfig.texto_ia}
                onChange={e => setFlowConfig(f => ({ ...f, texto_ia: e.target.value }))}
                className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-medium text-sm resize-none"
              />
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-8 rounded-3xl flex flex-col items-center justify-center gap-3 text-center">
              <div className="p-3 bg-slate-100 dark:bg-white/5 rounded-2xl text-slate-400">
                <Clapperboard size={22} />
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Palco & Marcação</p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                As configurações de <strong>Palco & Tempos</strong> foram movidas para <strong>Sonoplastia & Cronograma</strong> e as configurações de <strong>Marcação de Palco</strong> foram movidas para <strong>Marcação de Palco</strong>.
              </p>
            </div>
          </div>
        );

      /* ── REDIRECIONAMENTOS ── */
      case 'Redirecionamentos':
        return (
          <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl">
            <CRUDHeader title="Links & Redirecionamentos" onAdd={openAdd} />
            <div className="space-y-3">
              {links.map((lk: any, i: number) => (
                <Row key={i}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 bg-[#ff0068]/10 rounded-xl flex items-center justify-center text-[#ff0068] shrink-0">
                      <Link2 size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase truncate">{lk.label || 'Link sem título'}</p>
                      <p className="text-[10px] text-slate-500 truncate">{lk.url}</p>
                    </div>
                  </div>
                  <ActBtns onEdit={() => openEdit(i, lk)} onDelete={() => handleDelete(i)} />
                </Row>
              ))}
              {links.length === 0 && (
                <p className="text-center text-slate-400 py-8 text-sm">Nenhum redirecionamento cadastrado.</p>
              )}
            </div>
          </div>
        );

      /* ── PAGAMENTOS ── */
      case 'Pagamentos':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                Pagamentos & <span className="text-[#ff0068]">Recebimentos</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Configure sua conta para receber os repasses das inscrições diretamente via PIX. O split é automático no momento do pagamento.
              </p>
            </div>

            {/* Conexão Asaas */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><CreditCard size={16} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Conta de Recebimento</p>
                  <p className="text-xs text-slate-500 mt-0.5">Informe seu CPF/CNPJ e chave PIX para receber os repasses automaticamente.</p>
                </div>
              </div>
              <div className="p-6">
                {asaasProfile?.asaas_subconta_id ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl">
                      <CheckCircle size={22} className="text-emerald-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-emerald-700 dark:text-emerald-400 uppercase tracking-tight">Conta Configurada</p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-0.5">
                          Chave PIX: <span className="font-bold">{asaasProfile.pix_key}</span>
                          {asaasProfile.cpf_cnpj && <> · CPF/CNPJ: {asaasProfile.cpf_cnpj}</>}
                        </p>
                      </div>
                      <button
                        onClick={handleDisconnectAsaas}
                        disabled={asaasLoading}
                        className="shrink-0 px-4 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-500 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50"
                      >
                        {asaasLoading ? <Loader2 size={12} className="animate-spin" /> : 'Remover'}
                      </button>
                    </div>
                    <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl">
                      <AlertCircle size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-blue-700 dark:text-blue-400">
                        O repasse cai diretamente na sua chave PIX no momento em que o inscrito paga. A comissão da plataforma é descontada automaticamente.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
                      <AlertCircle size={22} className="text-amber-500 shrink-0" />
                      <div className="flex-1">
                        <p className="font-black text-sm text-amber-700 dark:text-amber-400 uppercase tracking-tight">Conta não configurada</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                          Configure sua conta para habilitar o recebimento de inscrições pagas.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">CPF ou CNPJ</label>
                        <input
                          type="text"
                          value={asaasForm.cpf_cnpj}
                          onChange={e => setAsaasForm(f => ({ ...f, cpf_cnpj: e.target.value }))}
                          placeholder="000.000.000-00 ou 00.000.000/0001-00"
                          className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                        />
                      </div>
                      {asaasForm.cpf_cnpj.replace(/\D/g, '').length === 14 && (
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Tipo de empresa</label>
                          <select
                            value={asaasForm.company_type}
                            onChange={e => setAsaasForm(f => ({ ...f, company_type: e.target.value }))}
                            className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                          >
                            <option value="MEI">MEI — Microempreendedor Individual</option>
                            <option value="LIMITED">LTDA / SA — Sociedade Limitada ou Anônima</option>
                            <option value="INDIVIDUAL">Empresário Individual</option>
                            <option value="ASSOCIATION">Associação / Organização</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                          {asaasForm.cpf_cnpj.replace(/\D/g, '').length === 14 ? 'Faturamento mensal estimado (R$)' : 'Renda mensal (R$)'}
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={asaasForm.income_value}
                          onChange={e => setAsaasForm(f => ({ ...f, income_value: e.target.value }))}
                          placeholder="Ex: 5000"
                          className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                        />
                        <p className="text-[9px] text-slate-400 mt-1">Exigido pelo Asaas para validação cadastral. Use uma estimativa.</p>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Chave PIX para receber</label>
                        <input
                          type="text"
                          value={asaasForm.pix_key}
                          onChange={e => setAsaasForm(f => ({ ...f, pix_key: e.target.value }))}
                          placeholder="CPF, e-mail, telefone ou chave aleatória"
                          className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                        />
                      </div>

                      {asaasFormError && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                          <AlertCircle size={14} className="text-red-500 shrink-0" />
                          <p className="text-[10px] text-red-600 dark:text-red-400">{asaasFormError}</p>
                        </div>
                      )}

                      <button
                        onClick={handleConnectAsaas}
                        disabled={asaasLoading}
                        className="flex items-center gap-3 px-6 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20 w-full justify-center"
                      >
                        {asaasLoading ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={16} /> Configurar conta de recebimento</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Comissão e modo de repasse por evento */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Percent size={16} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Modelo de Comissão por Evento</p>
                  <p className="text-xs text-slate-500 mt-0.5">Define quanto a plataforma retém e quem paga a taxa em cada evento.</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {mpEvents.length === 0 ? (
                  <p className="text-center text-slate-400 py-6 text-sm">Nenhum evento encontrado.</p>
                ) : (
                  mpEvents.map(ev => (
                    <EventCommissionCard
                      key={ev.id}
                      event={ev}
                      saving={savingCommission === ev.id}
                      onSave={(patch) => handleSaveCommission(ev.id, patch)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        );

      /* ── AVALIAÇÃO ── */
      case 'Avaliação': {
        return (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                Regras de <span className="text-[#ff0068]">Avaliação</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Configure a escala de notas, quesitos, pesos e cascata de desempate. Para gêneros específicos, ative regras personalizadas.
              </p>
            </div>

            {/* ── ESCALA DE PONTUAÇÃO ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Scale size={16} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Escala de Pontuação</p>
                  <p className="text-xs text-slate-500 mt-0.5">Define a régua usada pelos jurados nos tablets.</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SCORE_SCALE_OPTIONS.map(opt => {
                    const active = general.scoreScale === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setGeneral(g => ({ ...g, scoreScale: opt.id }))}
                        className={`flex flex-col gap-2 p-4 rounded-2xl border-2 transition-all text-left ${
                          active
                            ? 'border-[#ff0068] bg-[#ff0068]/5'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[11px] font-black uppercase tracking-widest ${active ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-300'}`}>
                            {opt.label}
                          </span>
                          <span className={`text-xs font-black tabular-nums italic px-2 py-0.5 rounded-lg shrink-0 ${
                            active ? 'bg-[#ff0068]/15 text-[#ff0068]' : 'bg-slate-100 dark:bg-white/5 text-slate-500'
                          }`}>
                            {opt.example}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-2xl">
                  <Scale size={12} className="text-[#ff0068] shrink-0" />
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
                    {general.scoreScale === 'BASE_10'
                      ? 'Jurado digita notas de 0,00 a 10,00 — teclado exibirá botão de vírgula decimal.'
                      : 'Jurado digita notas inteiras de 0 a 100 — vírgula e ponto serão bloqueados automaticamente.'}
                  </p>
                </div>
              </div>
            </div>

            {/* ── FAIXAS DE MEDALHA ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Medal size={16} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Faixas de Medalha</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Nota mínima para cada medalha na Mostra Competitiva. Abaixo do Bronze = Participação.
                  </p>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { key: 'gold',   label: 'Ouro',   color: 'text-yellow-500',  bg: 'bg-yellow-50 dark:bg-yellow-500/10',  border: 'border-yellow-300 dark:border-yellow-500/30' },
                    { key: 'silver', label: 'Prata',  color: 'text-slate-400',   bg: 'bg-slate-50  dark:bg-slate-700/30',   border: 'border-slate-300  dark:border-slate-500/30'  },
                    { key: 'bronze', label: 'Bronze', color: 'text-amber-600',   bg: 'bg-amber-50  dark:bg-amber-500/10',   border: 'border-amber-300  dark:border-amber-500/30'  },
                  ] as const).map(({ key, label, color, bg, border }) => {
                    const val = general.medalThresholds[key];
                    const maxVal = general.scoreScale === 'BASE_100' ? 100 : 10;
                    return (
                      <div key={key} className={`flex flex-col gap-2 p-4 rounded-2xl border-2 ${bg} ${border}`}>
                        <div className="flex items-center gap-2">
                          <Medal size={14} className={color} />
                          <span className={`text-[11px] font-black uppercase tracking-widest ${color}`}>{label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">≥</span>
                          <input
                            type="number"
                            min={0}
                            max={maxVal}
                            step={general.scoreScale === 'BASE_100' ? 1 : 0.1}
                            value={val}
                            onChange={e => {
                              const n = parseFloat(e.target.value);
                              if (!isNaN(n)) setGeneral(g => ({ ...g, medalThresholds: { ...g.medalThresholds, [key]: n } }));
                            }}
                            className={`w-full px-3 py-1.5 rounded-xl border ${border} bg-white dark:bg-slate-900 text-sm font-black tabular-nums ${color} outline-none focus:ring-2 focus:ring-[#ff0068]/30 text-center`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-start gap-2.5 px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-slate-800 rounded-2xl">
                  <Medal size={12} className="text-[#ff0068] shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 leading-relaxed">
                    Ouro ≥ <strong className="text-yellow-500">{general.medalThresholds.gold}</strong>
                    {' · '}Prata ≥ <strong className="text-slate-400">{general.medalThresholds.silver}</strong>
                    {' · '}Bronze ≥ <strong className="text-amber-600">{general.medalThresholds.bronze}</strong>
                    {' · '}Abaixo de <strong>{general.medalThresholds.bronze}</strong> = Participação
                  </p>
                </div>
              </div>
            </div>

            {/* ── BLOQUEIO AUTOMÁTICO DO TERMINAL ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Lock size={16} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Bloqueio por Inatividade</p>
                  <p className="text-xs text-slate-500 mt-0.5">Tempo sem interação para o terminal do júri pedir o PIN novamente.</p>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { value: 5,  label: '5 min' },
                    { value: 10, label: '10 min' },
                    { value: 15, label: '15 min' },
                    { value: 30, label: '30 min' },
                    { value: 0,  label: 'Nunca' },
                  ].map(opt => {
                    const active = general.pinInactivityMinutes === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setGeneral(g => ({ ...g, pinInactivityMinutes: opt.value }))}
                        className={`flex flex-col gap-1 items-center justify-center py-3 px-2 rounded-2xl border-2 transition-all ${
                          active
                            ? 'border-[#ff0068] bg-[#ff0068]/5'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                      >
                        <span className={`text-base font-black tabular-nums ${active ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-300'}`}>
                          {opt.label}
                        </span>
                        {opt.value === 0 && (
                          <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">sem trava</span>
                        )}
                        {opt.value === 15 && (
                          <span className="text-[7px] font-black uppercase tracking-widest text-emerald-500">recomendado</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-2xl">
                  <Lock size={12} className="text-[#ff0068] shrink-0" />
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
                    {general.pinInactivityMinutes === 0
                      ? 'Terminal nunca bloqueará por inatividade. Use em locais controlados com equipe de suporte presente.'
                      : `Após ${general.pinInactivityMinutes} minutos sem interação, o terminal pedirá o PIN para desbloquear.`
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* ── CONFIGURAÇÃO GLOBAL ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border-2 border-[#ff0068]/30 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 bg-[#ff0068]/5 border-b border-[#ff0068]/10">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]">
                  <Scale size={16} />
                </div>
                <div className="flex-1">
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight">
                    Configuração Global
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Aplica-se a todos os gêneros que não têm regra personalizada
                    {genres.length > 0 && (
                      <span className="ml-1 text-[#ff0068] font-bold">
                        ({genres.filter(g => isUsingGlobal(g.id)).length} de {genres.length} usando esta regra)
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff0068]/10 border border-[#ff0068]/20 rounded-xl">
                  <div className="w-2 h-2 rounded-full bg-[#ff0068]" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">Padrão</span>
                </div>
              </div>
              <div className="p-6">
                <RulesEditor
                  rules={globalRules}
                  onUpdateCriterion={updateGlobalCriterion}
                  onAddCriterion={addGlobalCriterion}
                  onRemoveCriterion={removeGlobalCriterion}
                  onMoveTiebreaker={moveGlobalTiebreaker}
                />
              </div>
            </div>

            {/* ── GÊNEROS ── */}
            {genres.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl">
                <Scale size={28} className="text-slate-300 dark:text-white/20 mb-3" />
                <p className="text-sm font-bold text-slate-500">Nenhum gênero cadastrado ainda.</p>
                <p className="text-xs text-slate-400 mt-1">Vá para a aba <strong>Gêneros</strong> para criar o primeiro gênero.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">
                  Gêneros — {genres.filter(g => !isUsingGlobal(g.id)).length} com regras personalizadas
                </p>
                {genres.map(genre => {
                  const usingGlobal = isUsingGlobal(genre.id);
                  const effectiveRules = getEffectiveRules(genre.id);
                  const total = pesoTotal(effectiveRules.criterios);

                  return (
                    <div
                      key={genre.id}
                      className={`bg-white shadow-sm dark:bg-white/5 dark:shadow-none border rounded-3xl overflow-hidden transition-all ${
                        usingGlobal
                          ? 'border-slate-200 dark:border-white/10'
                          : 'border-indigo-300 dark:border-indigo-500/30'
                      }`}
                    >
                      {/* Genre row */}
                      <div className="flex items-center gap-3 px-5 py-3.5">
                        {/* Color dot + name */}
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-black uppercase shrink-0"
                          style={{ backgroundColor: genre.color || '#ff0068' }}
                        >
                          {genre.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">{genre.name}</p>
                          {usingGlobal ? (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {globalRules.criterios.map((c, i) => (
                                <span key={i} className="text-[9px] text-slate-400 font-bold">
                                  {c.name} ×{c.peso}{i < globalRules.criterios.length - 1 ? ' ·' : ''}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold mt-0.5 uppercase tracking-widest">
                              Regra personalizada · {total > 0 ? `Peso total: ${total}` : `${effectiveRules.criterios.length} quesitos`}
                            </p>
                          )}
                        </div>

                        {/* Toggle */}
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className={`text-[9px] font-black uppercase tracking-widest ${usingGlobal ? 'text-slate-400' : 'text-indigo-500 dark:text-indigo-400'}`}>
                            {usingGlobal ? 'Global' : 'Custom'}
                          </span>
                          <button
                            onClick={() => toggleOverride(genre.id)}
                            className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${
                              !usingGlobal ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-white/15'
                            }`}
                            title={usingGlobal ? 'Ativar regra personalizada para este gênero' : 'Voltar a usar regra global'}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${!usingGlobal ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </div>
                      </div>

                      {/* Custom rules editor — only shown when override is active */}
                      {!usingGlobal && (
                        <div className="px-5 pb-5 pt-1 border-t border-indigo-100 dark:border-indigo-500/15 bg-indigo-50/30 dark:bg-indigo-500/5">
                          <RulesEditor
                            rules={effectiveRules}
                            onUpdateCriterion={(idx, patch) => updateCriterion(genre.id, idx, patch)}
                            onAddCriterion={() => addCriterion(genre.id)}
                            onRemoveCriterion={idx => removeCriterion(genre.id, idx)}
                            onMoveTiebreaker={(idx, dir) => moveTiebreaker(genre.id, idx, dir)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      /* ── PRÊMIOS ESPECIAIS ── */
      case 'Prêmios': {
        const formationOptions = ['TODOS', ...formats.map((f: any) => f.name)];
        const templateAwards = awards.filter(a => a.isTemplate);
        const customAwards   = awards.filter(a => !a.isTemplate);
        const enabledCount   = awards.filter(a => a.enabled).length;

        return (
          <div className="space-y-6">

            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Prêmios <span className="text-[#ff0068]">Especiais</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Ative os prêmios que serão exibidos no terminal do júri durante a avaliação.
                </p>
              </div>
              {enabledCount > 0 && (
                <span className="shrink-0 px-3 py-1.5 bg-[#ff0068]/10 text-[#ff0068] text-[9px] font-black uppercase tracking-widest rounded-full border border-[#ff0068]/20">
                  {enabledCount} ativo{enabledCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* ── Templates ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Trophy size={15} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Sugestões do Sistema</p>
                  <p className="text-[10px] text-slate-500">Prêmios padrão do mercado — ative com um clique.</p>
                </div>
              </div>

              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templateAwards.map(award => {
                  const Icon = AWARD_ICONS[award.id] ?? Trophy;
                  return (
                    <div
                      key={award.id}
                      className={`rounded-2xl border-2 transition-all overflow-hidden ${
                        award.enabled
                          ? 'border-[#ff0068] bg-[#ff0068]/3 dark:bg-[#ff0068]/5'
                          : 'border-slate-200 dark:border-white/10 bg-transparent'
                      }`}
                    >
                      {/* Toggle row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          award.enabled ? 'bg-[#ff0068] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                        }`}>
                          <Icon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-black uppercase tracking-widest truncate ${
                            award.enabled ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-300'
                          }`}>{award.name}</p>
                          <p className="text-[9px] text-slate-400 truncate">{award.description}</p>
                        </div>
                        {/* Toggle switch */}
                        <button
                          onClick={() => toggleAward(award.id)}
                          className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${
                            award.enabled ? 'bg-[#ff0068]' : 'bg-slate-200 dark:bg-white/15'
                          }`}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                            award.enabled ? 'left-5' : 'left-0.5'
                          }`} />
                        </button>
                      </div>

                      {/* Formation selector — shown when enabled */}
                      {award.enabled && (
                        <div className="px-4 pb-3 flex items-center gap-2 border-t border-[#ff0068]/10">
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 shrink-0 mt-2">Visível para:</span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {formationOptions.map(opt => (
                              <button
                                key={opt}
                                onClick={() => setAwardFormation(award.id, opt)}
                                className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all ${
                                  award.formation === opt
                                    ? 'bg-[#ff0068] border-[#ff0068] text-white'
                                    : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-[#ff0068]/40'
                                }`}
                              >
                                {opt === 'TODOS' ? 'Todas as Formações' : opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Custom Awards ── */}
            <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Award size={15} /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Prêmios Customizados</p>
                  <p className="text-[10px] text-slate-500">Crie prêmios exclusivos para o seu evento.</p>
                </div>
              </div>

              <div className="p-4 space-y-3">

                {/* Existing custom awards */}
                {customAwards.map(award => {
                  const Icon = customAwardIcon(award.name);
                  return (
                    <div
                      key={award.id}
                      className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-2xl"
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-widest text-slate-900 dark:text-white">{award.name}</p>
                          {award.description && (
                            <p className="text-[9px] text-slate-400">{award.description}</p>
                          )}
                        </div>
                        {/* Formation chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {formationOptions.map(opt => (
                            <button
                              key={opt}
                              onClick={() => setAwardFormation(award.id, opt)}
                              className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest border transition-all ${
                                award.formation === opt
                                  ? 'bg-indigo-500 border-indigo-500 text-white'
                                  : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-indigo-400/40'
                              }`}
                            >
                              {opt === 'TODOS' ? 'Todos' : opt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => removeAward(award.id)}
                        className="p-1.5 text-slate-300 dark:text-white/20 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}

                {/* Add new custom award form */}
                <div className="border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Novo Prêmio Especial</p>
                  <input
                    type="text"
                    value={newAwardName}
                    onChange={e => setNewAwardName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomAward()}
                    placeholder="Ex: Melhor Figurino, Prêmio do Público..."
                    className="w-full bg-transparent border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all placeholder:text-slate-400"
                  />
                  <input
                    type="text"
                    value={newAwardDesc}
                    onChange={e => setNewAwardDesc(e.target.value)}
                    placeholder="Descrição opcional (ex: Votado pelo público presente)"
                    className="w-full bg-transparent border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all placeholder:text-slate-400"
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Visível para</p>
                      <div className="flex flex-wrap gap-1.5">
                        {formationOptions.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setNewAwardFormation(opt)}
                            className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all ${
                              newAwardFormation === opt
                                ? 'bg-[#ff0068] border-[#ff0068] text-white'
                                : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-[#ff0068]/40'
                            }`}
                          >
                            {opt === 'TODOS' ? 'Todos' : opt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={addCustomAward}
                      disabled={!newAwardName.trim()}
                      className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        newAwardName.trim()
                          ? 'bg-[#ff0068] text-white hover:bg-[#d4005a] active:scale-95'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <Plus size={12} /> Adicionar
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary panel */}
            {enabledCount > 0 && (
              <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl p-4">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-3">Resumo — o que o jurado verá no terminal</p>
                <div className="space-y-2">
                  {awards.filter(a => a.enabled).map(a => {
                    const Icon = a.isTemplate ? (AWARD_ICONS[a.id] ?? Trophy) : customAwardIcon(a.name);
                    return (
                      <div key={a.id} className="flex items-center gap-2.5">
                        <Icon size={12} className="text-[#ff0068] shrink-0" />
                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 flex-1">{a.name}</span>
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">
                          {a.formation === 'TODOS' ? 'todas as formações' : a.formation}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  /* ── modal content ── */
  const renderModalContent = () => {
    switch (activeTab) {
      case 'Formações': {
        const lotes: FormatLote[] = Array.isArray(tempValue.lotes) && tempValue.lotes.length > 0
          ? tempValue.lotes
          : [{ data_virada: null, preco: 0 }];

        const updateLote = (idx: number, patch: Partial<FormatLote>) => {
          const next = lotes.map((l, i) => i === idx ? { ...l, ...patch } : l);
          setTempValue((v: any) => ({ ...v, lotes: next }));
        };
        const addLote = () => {
          // novo lote vai pro penúltimo (último é sempre o "até prazo final")
          const next = [...lotes];
          next.splice(next.length - 1, 0, { data_virada: '', preco: 0 });
          setTempValue((v: any) => ({ ...v, lotes: next }));
        };
        const removeLote = (idx: number) => {
          if (lotes.length <= 1) return;
          const next = lotes.filter((_, i) => i !== idx);
          // garante que o último não tem data_virada
          if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], data_virada: null };
          setTempValue((v: any) => ({ ...v, lotes: next }));
        };

        return (
          <div className="space-y-4">
            <div>
              <label className={label}>Nome do Formato</label>
              <input type="text" value={tempValue.name || ''} onChange={e => setTempValue((v: any) => ({ ...v, name: e.target.value }))} placeholder="Ex: Solo, Duo, Grupo..." className={input} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={label}>Lotes de Preço</label>
                <button onClick={addLote} className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:text-[#e0005c] flex items-center gap-1">
                  <Plus size={12} /> Adicionar Lote
                </button>
              </div>
              <div className="space-y-2">
                {lotes.map((lote, i) => {
                  const isLast = i === lotes.length - 1;
                  return (
                    <div key={i} className="flex gap-2 items-start bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-2xl p-3">
                      <div className="w-12 shrink-0 pt-2.5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Lote {i + 1}</p>
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Preço (R$)</label>
                          <input type="number" min={0} value={lote.preco || ''} onChange={e => updateLote(i, { preco: Number(e.target.value) })} className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-xl py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 font-bold text-sm" />
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                            {isLast ? 'Até prazo final' : 'Vira em'}
                          </label>
                          {isLast ? (
                            <input type="text" disabled value="Prazo de inscrição" className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl py-2 px-3 text-slate-400 text-xs italic cursor-not-allowed" />
                          ) : (
                            <input type="date" value={lote.data_virada || ''} onChange={e => updateLote(i, { data_virada: e.target.value })} className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-xl py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 font-bold text-sm dark:[color-scheme:dark]" />
                          )}
                        </div>
                      </div>
                      {lotes.length > 1 && (
                        <button onClick={() => removeLote(i)} className="p-2 text-slate-400 hover:text-red-500 transition-colors shrink-0" title="Remover lote">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-slate-400 mt-2">O último lote vai até o prazo de inscrição configurado em <strong>Geral</strong>.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Tipo de Cobrança</label>
                <select value={tempValue.pricingType || 'FIXED'} onChange={e => setTempValue((v: any) => ({ ...v, pricingType: e.target.value }))} className={input}>
                  <option value="FIXED">Valor Fixo</option>
                  <option value="PER_MEMBER">Por Participante</option>
                </select>
              </div>
              <div>
                <label className={label}>Mín. de Participantes</label>
                <input type="number" min={1} value={tempValue.minMembers || 1} onChange={e => setTempValue((v: any) => ({ ...v, minMembers: Number(e.target.value) }))} className={input} />
              </div>
            </div>
          </div>
        );
      }
      case 'Categorias':
        return (
          <div className="space-y-4">
            <div>
              <label className={label}>Nome da Categoria</label>
              <input type="text" value={tempValue.name || ''} onChange={e => setTempValue((v: any) => ({ ...v, name: e.target.value }))} placeholder="Ex: Infantil, Adulto..." className={input} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Idade Mínima</label>
                <input type="number" min={0} value={tempValue.min || ''} onChange={e => setTempValue((v: any) => ({ ...v, min: Number(e.target.value) }))} className={input} />
              </div>
              <div>
                <label className={label}>Idade Máxima</label>
                <input
                  type="number"
                  min={0}
                  value={tempValue.max || ''}
                  onChange={e => setTempValue((v: any) => ({ ...v, max: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="∞ sem limite"
                  className={input}
                />
                <p className="text-[9px] text-slate-400 mt-1">Vazio = "{tempValue.min || 0}+ anos"</p>
              </div>
            </div>
          </div>
        );
      case 'Redirecionamentos':
        return (
          <div className="space-y-4">
            <div>
              <label className={label}>Título do Link</label>
              <input type="text" value={tempValue.label || ''} onChange={e => setTempValue((v: any) => ({ ...v, label: e.target.value }))} placeholder="Ex: Regulamento, WhatsApp..." className={input} autoFocus />
            </div>
            <div>
              <label className={label}>URL</label>
              <input type="url" value={tempValue.url || ''} onChange={e => setTempValue((v: any) => ({ ...v, url: e.target.value }))} placeholder="https://..." className={input} />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  /* ══════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════ */
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-32 text-slate-900 dark:text-white">

      {/* Tab bar */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl shadow-sm sticky top-0 z-20">
        <div className="flex overflow-x-auto no-scrollbar">
          {TABS.map(({ label: tab }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative flex-shrink-0 px-5 py-4 text-[10px] font-black uppercase tracking-[0.15em] transition-all ${
                activeTab === tab ? 'text-[#ff0068]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff0068] shadow-[0_0_8px_#ff0068]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {renderTab()}
        </motion.div>
      </AnimatePresence>

      {/* Feedback banner */}
      <AnimatePresence>
        {(success || error) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl text-white font-black text-xs uppercase tracking-widest shadow-xl z-50 ${success ? 'bg-emerald-500' : 'bg-rose-500'}`}
          >
            {success ? '✓ Configurações salvas com sucesso!' : `✗ ${error}`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/10 z-40 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
        <div className="max-w-5xl mx-auto flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-3 bg-[#ff0068] text-white px-10 py-3.5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-[#ff0068]/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setIsModalOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 w-full max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  {modalMode === 'add' ? 'Adicionar' : 'Editar'} <span className="text-[#ff0068]">{activeTab}</span>
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
                  <X size={18} />
                </button>
              </div>

              {renderModalContent()}

              <div className="flex gap-3 mt-8">
                <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  Cancelar
                </button>
                <button onClick={handleModalSubmit} className="flex-1 py-3 rounded-2xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all">
                  {modalMode === 'add' ? 'Adicionar' : 'Salvar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Genre Modal (Gênero + Subgênero) ── */}
      <AnimatePresence>
        {genreModal.open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setGenreModal(m => ({ ...m, open: false })); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  {genreModal.mode === 'add-genre' && <>Novo <span className="text-[#ff0068]">Gênero</span></>}
                  {genreModal.mode === 'edit-genre' && <>Editar <span className="text-[#ff0068]">Gênero</span></>}
                  {genreModal.mode === 'add-sub' && <>Nova <span className="text-[#ff0068]">Modalidade</span> — {genreModal.genre?.name}</>}
                  {genreModal.mode === 'edit-sub' && <>Editar <span className="text-[#ff0068]">Modalidade</span></>}
                </h3>
                <button onClick={() => setGenreModal(m => ({ ...m, open: false }))} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className={label}>Nome</label>
                  <input
                    type="text"
                    autoFocus
                    value={genreModal.tempName}
                    onChange={e => setGenreModal(m => ({ ...m, tempName: e.target.value }))}
                    placeholder={genreModal.mode.includes('genre') ? 'Ex: K-Pop, Ballet Clássico…' : 'Ex: Cover, Repertório…'}
                    className={input}
                  />
                </div>

                {/* Categoria Livre toggle — só para subgêneros */}
                {(genreModal.mode === 'add-sub' || genreModal.mode === 'edit-sub') && (
                  <>
                    <button
                      type="button"
                      onClick={() => setGenreModal(m => ({ ...m, tempFree: !m.tempFree }))}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                        genreModal.tempFree
                          ? 'border-amber-500 bg-amber-500/5'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <div className="text-left">
                        <p className={`text-[11px] font-black uppercase tracking-widest ${genreModal.tempFree ? 'text-amber-500' : 'text-slate-900 dark:text-white'}`}>
                          Categoria Livre
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {genreModal.tempFree
                            ? 'Sem restrição de idade — o Eixo Etário será pulado no checkout'
                            : 'Participantes precisam estar dentro da faixa etária da categoria'}
                        </p>
                      </div>
                      {genreModal.tempFree
                        ? <ToggleRight size={22} className="text-amber-500 shrink-0" />
                        : <ToggleLeft  size={22} className="text-slate-400 shrink-0" />}
                    </button>

                    {/* Trilha de Repertório toggle */}
                    <button
                      type="button"
                      onClick={() => setGenreModal(m => ({ ...m, tempShorterTrack: !m.tempShorterTrack }))}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                        genreModal.tempShorterTrack
                          ? 'border-violet-500 bg-violet-500/5'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <div className="text-left">
                        <p className={`text-[11px] font-black uppercase tracking-widest ${genreModal.tempShorterTrack ? 'text-violet-500' : 'text-slate-900 dark:text-white'}`}>
                          Trilha de Repertório
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {genreModal.tempShorterTrack
                            ? 'Duração mínima ignorada — trilha original da obra é aceita em qualquer tamanho'
                            : 'Valida duração mínima da trilha conforme regras da modalidade'}
                        </p>
                      </div>
                      {genreModal.tempShorterTrack
                        ? <ToggleRight size={22} className="text-violet-500 shrink-0" />
                        : <ToggleLeft  size={22} className="text-slate-400 shrink-0" />}
                    </button>
                  </>
                )}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setGenreModal(m => ({ ...m, open: false }))}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const name = genreModal.tempName.trim();
                    if (!name) return;
                    try {
                      if (genreModal.mode === 'add-genre') {
                        // Usa o event_id do primeiro evento encontrado (ou null para global)
                        const { data: evts } = await supabase.from('events').select('id').limit(1).single();
                        const eventId = evts?.id ?? '00000000-0000-0000-0000-000000000000';
                        const created = await createGenre(eventId, name);
                        setGenres(gs => [...gs, created]);
                        setExpandedGenre(created.id);
                      } else if (genreModal.mode === 'edit-genre' && genreModal.genre) {
                        const updated = await updateGenre(genreModal.genre.id, { name });
                        setGenres(gs => gs.map(g => g.id === genreModal.genre!.id ? updated : g));
                      } else if (genreModal.mode === 'add-sub' && genreModal.genre) {
                        const updated = await addSubgenre(genreModal.genre, { name, is_categoria_livre: genreModal.tempFree, allow_shorter_track: genreModal.tempShorterTrack });
                        setGenres(gs => gs.map(g => g.id === genreModal.genre!.id ? updated : g));
                      } else if (genreModal.mode === 'edit-sub' && genreModal.genre && genreModal.subIndex !== undefined) {
                        const updated = await editSubgenre(genreModal.genre, genreModal.subIndex, { name, is_categoria_livre: genreModal.tempFree, allow_shorter_track: genreModal.tempShorterTrack });
                        setGenres(gs => gs.map(g => g.id === genreModal.genre!.id ? updated : g));
                      }
                      setGenreModal(m => ({ ...m, open: false }));
                    } catch (e: any) {
                      alert('Erro: ' + e.message);
                    }
                  }}
                  className="flex-1 py-3 rounded-2xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all"
                >
                  {genreModal.mode.startsWith('add') ? 'Adicionar' : 'Salvar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AccountSettings;
