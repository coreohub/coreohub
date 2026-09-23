/**
 * Informações e regras do evento (events.info_config) — seções fixas + FAQ.
 * Fonte única do formato, compartilhada entre o editor (Configurações) e a
 * seção pública da vitrine.
 */

export const INFO_SECTIONS = [
  { key: 'portoes', titulo: 'Portões e horários', placeholder: 'Ex: Portões abrem às 18h. O espetáculo começa às 19h, com tolerância de 15 min.' },
  { key: 'meia', titulo: 'Meia-entrada', placeholder: 'Ex: Vale para estudantes, idosos, PCD e jovens de baixa renda (Lei 12.933). Apresente o documento na entrada.' },
  { key: 'menores', titulo: 'Menores de idade', placeholder: 'Ex: Crianças até 5 anos não pagam, mas não têm assento próprio.' },
  { key: 'acessibilidade', titulo: 'Acessibilidade', placeholder: 'Ex: Assentos PCD e para acompanhante, rampa de acesso e banheiro adaptado.' },
  { key: 'estacionamento', titulo: 'Estacionamento e transporte', placeholder: 'Ex: Estacionamento no local, R$ 15. Ponto de ônibus a 200 m.' },
  { key: 'outras', titulo: 'Outras informações', placeholder: 'Ex: Não é permitido filmar durante as apresentações.' },
] as const;

export type InfoSectionKey = typeof INFO_SECTIONS[number]['key'];

export type InfoFaq = { pergunta: string; resposta: string };
/** Ponto de venda fisico (divulgado ao publico, padrao Guiche Web: nome, endereco, telefone, cidade). */
export type InfoPdv = { nome: string; endereco: string; cidade: string; telefone: string; horario: string };
export type InfoConfig = { secoes: Partial<Record<InfoSectionKey, string>>; faq: InfoFaq[]; pdvs: InfoPdv[] };

export const INFO_SECTION_MAX = 1000;
export const INFO_FAQ_MAX_ITEMS = 12;
export const INFO_FAQ_Q_MAX = 150;
export const INFO_FAQ_A_MAX = 600;
export const INFO_PDV_MAX_ITEMS = 10;
export const INFO_PDV_FIELD_MAX = 200;

export const EMPTY_INFO: InfoConfig = { secoes: {}, faq: [], pdvs: [] };

/** Normaliza o JSONB vindo do banco (pode ser null, formato antigo ou lixo). */
export function parseInfoConfig(raw: unknown): InfoConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  const secoes: Partial<Record<InfoSectionKey, string>> = {};
  for (const s of INFO_SECTIONS) {
    const v = r?.secoes?.[s.key];
    if (typeof v === 'string' && v.trim()) secoes[s.key] = v;
  }
  const faq: InfoFaq[] = Array.isArray(r?.faq)
    ? r.faq
        .filter((f: any) => f && typeof f.pergunta === 'string' && typeof f.resposta === 'string')
        .map((f: any) => ({ pergunta: f.pergunta, resposta: f.resposta }))
    : [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const pdvs: InfoPdv[] = Array.isArray(r?.pdvs)
    ? r.pdvs
        .filter((p: any) => p && typeof p === 'object')
        .map((p: any) => ({ nome: str(p.nome), endereco: str(p.endereco), cidade: str(p.cidade), telefone: str(p.telefone), horario: str(p.horario) }))
    : [];
  return { secoes, faq, pdvs };
}

/** Limpa antes de gravar: descarta seções e perguntas vazias; null se nada sobrou. */
export function serializeInfoConfig(cfg: InfoConfig): InfoConfig | null {
  const secoes: Partial<Record<InfoSectionKey, string>> = {};
  for (const s of INFO_SECTIONS) {
    const v = (cfg.secoes[s.key] ?? '').trim();
    if (v) secoes[s.key] = v.slice(0, INFO_SECTION_MAX);
  }
  const faq = cfg.faq
    .map(f => ({ pergunta: f.pergunta.trim().slice(0, INFO_FAQ_Q_MAX), resposta: f.resposta.trim().slice(0, INFO_FAQ_A_MAX) }))
    .filter(f => f.pergunta && f.resposta)
    .slice(0, INFO_FAQ_MAX_ITEMS);
  const cut = (v: string) => v.trim().slice(0, INFO_PDV_FIELD_MAX);
  const pdvs = cfg.pdvs
    .map(p => ({ nome: cut(p.nome), endereco: cut(p.endereco), cidade: cut(p.cidade), telefone: cut(p.telefone), horario: cut(p.horario) }))
    .filter(p => p.nome && p.endereco)
    .slice(0, INFO_PDV_MAX_ITEMS);
  if (Object.keys(secoes).length === 0 && faq.length === 0 && pdvs.length === 0) return null;
  return { secoes, faq, pdvs };
}

export function hasInfoContent(cfg: InfoConfig): boolean {
  return INFO_SECTIONS.some(s => (cfg.secoes[s.key] ?? '').trim()) || cfg.faq.length > 0 || cfg.pdvs.length > 0;
}
