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
  APOIO_WORKSHOP = 'APOIO_WORKSHOP', // só escaneia QR de presença em workshops
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
  /** Cor de fundo do badge na UI (hex). Default rosa CoreoHub se ausente. */
  color?: string;
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
  splitGateway: 'STRIPE' | 'ASAAS' | 'PAGARME';
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

  // Plano comercial (docs/pricing-model-spec.md) — travado após escolhido,
  // sem troca self-service. Componente fixo (Essencial/Escala) é cobrado
  // adiantado, ver billing_plan_fixed_fee_paid_at.
  billing_plan?: 'comeco' | 'essencial' | 'escala';
  billing_plan_fixed_fee_paid_at?: string | null;

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
  video_fee_partial_refund_percent?: number; // 0-100, default 50
  // Multi-jurado (Sessão Seletiva v1): 1 = produtor solo via VideoSelection.tsx,
  // >=2 = blind multi-judge via /jurado-seletiva agregado por majority/unanimous.
  video_evaluators_count?: number;
  video_evaluation_rule?: 'majority' | 'unanimous';

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
  video_approved_at?: string;
  video_approved_by?: string;
}

/** Avaliação individual de jurado quando event.video_evaluators_count >= 2.
 *  Agregação pra video_status agregado é computada em código (lib + edge function).
 */
export interface VideoEvaluation {
  id: string;
  registration_id: string;
  judge_id: string;
  decision: 'approve' | 'reject' | 'conditional';
  feedback?: string;
  score?: number;  // 0-10, opcional v1
  created_at: string;
  updated_at: string;
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
  /** DEPRECATED 2026-05-28: substituído por `scopes` array. Mantido durante
   *  transição (~2 semanas pro PWA cache rolar). Edge functions leem ambos. */
  scope?: 'inscription' | 'audience' | 'workshop' | 'video_selection' | 'both' | 'all';
  /** Array de surfaces onde o cupom aplica. Substitui scope a partir da
   *  migration 20260615. Subset de: inscription | audience | workshop |
   *  video_selection. Vazio nunca (CHECK constraint força cardinality >= 1). */
  scopes?: ('inscription' | 'audience' | 'workshop' | 'video_selection')[];
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
  /** Escopos de credenciamento/QR por tipo de crachá — substituem o antigo
   *  flag único `credenciamento` (2026-07-08). Permite, por ex., um staff
   *  de apoio em workshops que só escaneia QR de workshop, sem enxergar
   *  nem marcar check-in de inscritos/ingressos/equipe/jurados. */
  checkin_inscritos: boolean;
  checkin_ingressos: boolean;
  checkin_workshops: boolean;
  checkin_equipe: boolean;
  checkin_jurados: boolean;
  marcacao_palco: boolean;
  suporte_juri: boolean;
  inscricoes_leitura: boolean;
  triagem: boolean;
  /** Triagem de vídeos enviados pelos inscritos (Seletiva). Permite delegar
   *  pra coordenador/staff aprovar/rejeitar coreografias antes do evento. */
  seletiva_video: boolean;
  vendas_ingressos: boolean;
  /** Gerenciar cupons de desconto (criar/editar/desativar). Útil pra
   *  coordenador criar cupons promocionais por escola/grupo. */
  gerenciar_cupons: boolean;
  /** Gerenciar workshops do evento (criar/editar, gerenciar inscrições). */
  gerenciar_workshops: boolean;
  /** Emitir e gerenciar certificados em batch após o evento. Útil pra
   *  staff/secretária responder dúvidas dos inscritos. */
  emitir_certificados: boolean;
  /** Leitura de Apuração + Premiação. Coordenador/Mesário acompanha
   *  resultados durante e após o evento (read-only). */
  resultados_leitura: boolean;
  /** Controla o Telão de Palco (gerar/regenerar código, ligar/desligar,
   *  revelar premiação). Rota sensível — sem essa permissão explícita,
   *  só o produtor/COREOHUB_ADMIN acessa (2026-07-10, achado de revisão:
   *  a rota não tinha nenhum gate, só ficava escondida do menu). */
  controle_telao: boolean;
  /** Publica Avisos vistos por todos os inscritos do evento. Mesma
   *  classe de achado do controle_telao — rota sem gate até 2026-07-10. */
  gerenciar_avisos: boolean;
}

export const PERMISSOES_DEFAULT: PermissoesCustom = {
  financeiro: false,
  validar_pagamentos: false,
  cronograma_leitura: false,
  cronograma_editar: false,
  checkin_inscritos: false,
  checkin_ingressos: false,
  checkin_workshops: false,
  checkin_equipe: false,
  checkin_jurados: false,
  marcacao_palco: false,
  suporte_juri: false,
  inscricoes_leitura: false,
  triagem: false,
  seletiva_video: false,
  vendas_ingressos: false,
  gerenciar_cupons: false,
  gerenciar_workshops: false,
  emitir_certificados: false,
  resultados_leitura: false,
  controle_telao: false,
  gerenciar_avisos: false,
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

  // Página pública do produtor (/produtor/<slug>) — opt-in, ver Profile.tsx
  public_page_enabled?: boolean;
  public_slug?: string;
  bio?: string;
  instagram_producer?: string;
  whatsapp_producer?: string;
  website_producer?: string;

  /** Flag de super admin — espelha profiles.is_super_admin no banco. Painel
   *  /super-admin aceita esse OU role === COREOHUB_ADMIN. */
  is_super_admin?: boolean;
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
