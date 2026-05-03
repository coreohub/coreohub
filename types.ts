export enum UserRole {
  ORGANIZER = 'ORGANIZER',
  STUDIO_DIRECTOR = 'STUDIO_DIRECTOR',
  CHOREOGRAPHER = 'CHOREOGRAPHER',
  INDEPENDENT = 'INDEPENDENT',
  SUPPORT = 'SUPPORT',
  JUDGE = 'JUDGE',
  TEAM = 'TEAM',
  COREOHUB_ADMIN = 'COREOHUB_ADMIN',
  USER = 'USER',
  TECHNICIAN = 'TECHNICIAN',
  STAFF = 'STAFF',
  SPECTATOR = 'SPECTATOR',
  // ── Equipe Operacional ──
  COORDENADOR  = 'COORDENADOR',   // coordenador geral do evento
  MESARIO      = 'MESARIO',       // suporte à banca de jurados
  SONOPLASTA   = 'SONOPLASTA',    // opera áudio + reordena cronograma
  RECEPCAO     = 'RECEPCAO',      // recepção e backstage
  PALCO        = 'PALCO',         // marcação de palco
}

export enum EventFormat {
  RANKING = 'RANKING',       // Mostra Competitiva
  PEDAGOGICAL = 'PEDAGOGICAL', // Mostra Avaliada
  GRADUATED = 'GRADUATED',    // Mostra por Médias
  BATTLE = 'BATTLE'          // Torneio de Batalhas
}

export enum AgeReference {
  EVENT_DAY = 'EVENT_DAY',
  YEAR_END = 'YEAR_END',
  FIXED_DATE = 'FIXED_DATE'
}

export type AgeToleranceMode = 'PERCENT' | 'FIXED_COUNT';

/** Um subgênero de um gênero de dança */
export interface Subgenre {
  name: string;
  /** Se true, o checkout NÃO cruza este subgênero com o Eixo Etário (categorias de idade) */
  is_categoria_livre: boolean;
  /** Se true, a validação de duração mínima da trilha é ignorada (ex: Balé de Repertório) */
  allow_shorter_track?: boolean;
}

/** Gênero (Eixo Técnico) — K-Pop, Ballet Clássico, Danças Urbanas… */
export interface EventStyle {
  id: string;
  event_id?: string;
  name: string;
  is_active: boolean;
  /** Lista de subgêneros com flag de categoria livre */
  sub_types: Subgenre[];
  requires_subcategory: boolean;
}

export interface Subcategory {
  id: string;
  event_style_id: string;
  name: string;
}

export interface EventCategory {
  id: string;
  name: string;
  min_age: number;
  max_age: number;
  is_active: boolean;
}

export interface EventFormacao {
  id: string;
  name: string;
  base_fee: number;
  max_duration_seconds: number;
  is_active: boolean;
  per_dancer?: boolean;
}

/** @deprecated Use EventFormacao */
export type EventModality = EventFormacao;

export interface EventFormatRule {
  id: string;
  style_id: string | null;
  category_id: string | null;
  formacao_id: string | null;
  level_id: string | null;
  target_format: EventFormat;
}

export interface EvaluationCriterion {
  name: string;
  weight: number;
}

export interface EventConfig {
  name: string;
  address: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  splitGateway: 'STRIPE' | 'ASAAS' | 'PAGARME' | 'MERCADO_PAGO';
  defaultFormat: EventFormat;
  hasMultipleLevels: boolean;
  ageReference: AgeReference;
  ageTolerancePct: number;
  ageToleranceMode: AgeToleranceMode;
  requireIdDoc: boolean;
  allowDoubles: boolean;
  firstRegFee: number;
  subsequentRegFee: number;
}

export interface Event {
  id: string;
  name: string;
  description?: string;
  address?: string;
  start_date?: string;
  end_date?: string;
  registration_deadline?: string;
  rules_text?: string;
  registration_start_date?: string;
  registration_end_date?: string;
  show_school_field?: boolean;
  score_scale?: number;
  score_precision?: number;
  rules_pdf_url?: string;
  created_at?: string;
  created_by?: string;
  categories?: string[]; // Legacy, keeping for compatibility
  criteria?: string[]; // Legacy, keeping for compatibility
  category_price?: number;
  slots_limit?: number;
  cover_url?: string;
  default_penalty?: number;

  // Advanced SaaS Fields
  age_reference_date?: string;
  age_tolerance_mode?: AgeToleranceMode;
  age_tolerance_value?: number;

  edition_year?: number;      // Ano/edição do festival (ex: 2026, 2027)

  formacoes_config?: any[]; // Array of { name, min_members, max_members, fee, format }
  categories_config?: any[]; // Array of { name, min_age, max_age }
  styles_config?: any[]; // Array of { name, fee, slots_limit, weight }
  criteria_config?: any[]; // Array of { name, weight, fee, slots_limit }

  // Datas operacionais
  track_submission_deadline?: string;  // Data limite envio trilha sonora

  // Seletiva de Vídeo
  video_selection_enabled?: boolean;
  video_submission_deadline?: string;
  video_selection_fee?: number;          // 0 = gratuita
  video_selection_fee_required?: boolean;
  video_fee_refund_policy?: 'no_refund' | 'full_refund' | 'partial_refund';

  // Palco & Tempos
  stage_entry_time_seconds?: number;    // Tempo de entrada no palco
  stage_marking_time_seconds?: number;  // Tempo de marcação de palco

  // Configurações de pontuação e inatividade
  inactivity_block_enabled?: boolean;   // Bloqueio por inatividade

  // Lotes de inscrição (array de { label, deadline, price })
  registration_lots?: RegistrationLot[];

  // Vitrine pública
  slug?: string;
  city?: string;
  state?: string;             // UF (2 letras)
  whatsapp_event?: string;    // Numero so digitos com DDI (ex: 5511999999999)
  instagram_event?: string;   // URL completa
  tiktok_event?: string;
  youtube_event?: string;
  website_event?: string;
  is_public?: boolean;
}

export interface Registration {
  id: string;
  choreography_name: string;
  formacao: string;
  category: string;
  audio_duration_seconds: number;
  applied_penalty: number;
  dance_style?: string;
  dance_style_id?: string;
  formacao_id?: string;
  level_id?: string;
  age_infraction_status?: 'none' | 'ignored_warning' | 'penalized';
  penalty_points?: number;
  created_at?: string;
  profiles?: {
    full_name: string;
  };

  // Seletiva de Vídeo
  video_url?: string;
  video_status?: 'pending' | 'submitted' | 'approved' | 'rejected' | 'conditional';
  video_feedback?: string;
  video_submitted_at?: string;
  video_fee_status?: 'not_required' | 'pending' | 'paid' | 'waived';
  video_fee_payment_id?: string;
}

/** Lote de inscrição com prazo e preço */
export interface RegistrationLot {
  label: string;
  /** ISO date (YYYY-MM-DD). String vazia = último lote, sem prazo */
  deadline: string;
  price: number;
}

/** Cupom de desconto por evento */
export interface Coupon {
  id: string;
  event_id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses?: number | null;
  used_count: number;
  expires_at?: string | null;
  is_active: boolean;
  created_at: string;
}

/** Tipo do evento: privado (gateway de pagamento) ou governamental (gratuito) */
export type EventType = 'private' | 'government';

/** Permissões granulares para membros da equipe operacional */
export interface PermissoesCustom {
  financeiro: boolean;
  validar_pagamentos: boolean;
  cronograma_leitura: boolean;
  cronograma_editar: boolean;
  credenciamento: boolean;
  marcacao_palco: boolean;
  suporte_juri: boolean;
  inscricoes_leitura: boolean;
  triagem: boolean;
  vendas_ingressos: boolean;
}

export const PERMISSOES_DEFAULT: PermissoesCustom = {
  financeiro: false,
  validar_pagamentos: false,
  cronograma_leitura: false,
  cronograma_editar: false,
  credenciamento: false,
  marcacao_palco: false,
  suporte_juri: false,
  inscricoes_leitura: false,
  triagem: false,
  vendas_ingressos: false,
};

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
  cargo?: string;
  permissoes_custom?: PermissoesCustom;

  // Financial & Account Info
  document?: string; // CPF or CNPJ
  whatsapp?: string;
  instagram?: string;
  location?: string;
  dance_role?: string;
  mp_client_id?: string;
  mp_client_secret?: string;
}

export interface ActiveJudge {
  id: string;
  name: string;
  avatar_url?: string;
  competencies: {
    styles: string[];
    formats: string[];
  };
}

export interface Criterion {
  name: string;
  weight: number;
  active: boolean;
}

export interface BattleBracket {
  id: string;
  event_id: string;
  category: string;
  style: string;
  phase: string;
  position: number;
  p1_id?: string;
  p2_id?: string;
  winner_id?: string;
  status: 'pending' | 'active' | 'finished';
  updated_at?: string;
  p1?: { full_name: string; avatar_url?: string };
  p2?: { full_name: string; avatar_url?: string };
}
