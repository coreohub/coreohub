/**
 * Geração e validação de slugs de eventos.
 *
 * Fonte ÚNICA da verdade (Fase 2 — Slug Hardening).
 * Antes da Fase 2, OnboardingWizard, CreateEvent e a migration de backfill tinham
 * 3 implementações diferentes — causou o bug "usualdance-festival-2026-2026"
 * (slug duplicado com ano em 2026-05-15).
 *
 * Regras:
 * - Base: slugify(nome) + "-{year}" (lowercase, sem acentos, hífens em vez de espaços)
 * - Se nome já termina com -{year}, não duplica
 * - Resultado validado contra RESERVED_SLUGS (palavras de rota do app)
 * - Unicidade verificada no banco; se colidir, append -2, -3, ... até livre
 */

import { supabase } from './supabase';

/**
 * Palavras reservadas que NÃO podem virar slug porque colidem com rotas do app
 * ou com áreas administrativas/funcionais.
 *
 * Quando o slugify resultar em uma dessas, append `-festival` automático.
 * Quando produtor digitar manualmente uma dessas no campo de edição, recusa.
 *
 * Lista derivada das rotas em App.tsx + paths sensíveis. Manter sincronizada
 * com novas rotas (rotina manual — não tem como auto-extrair).
 */
export const RESERVED_SLUGS = new Set<string>([
  // Rotas principais
  'admin', 'login', 'register', 'logout', 'auth',
  'criar-evento', 'criar-festival', 'novo-evento',
  'festival', 'evento', 'eventos', 'festivais',
  'workshop', 'workshops', 'workshops-do-evento',
  'inscricao', 'inscricoes', 'inscrever',
  'checkout', 'checkout-ingresso', 'checkout-workshop',
  'pagamento', 'pagamentos',
  'cupons', 'cupom',
  'jurados', 'jurado', 'judge-login',
  'cronograma', 'narracao-ia', 'marcacao-de-palco',
  'credenciais', 'credenciamento',
  'apuracao', 'premiacao', 'certificados',
  'coordenador-do-juri', 'configuracoes',
  'qg-organizador', 'painel', 'dashboard',
  'vendas-de-ingressos', 'meu-ingresso', 'meu-workshop',
  'meu-perfil', 'perfil', 'meu-elenco', 'minhas-coreografias',
  'feedbacks', 'resultados', 'meus-certificados',
  'comprar-ingressos', 'central-de-midia',
  'estudios', 'lp', 'governo',
  'leaderboard', 'placar',
  'termo-produtor', 'termo',
  // Áreas técnicas
  'api', 'graphql', 'webhook', 'webhooks', 'callback',
  'public', 'static', 'assets', 'images', 'img',
  'sitemap', 'robots',
  // Vanity short codes futuros (Fase 5)
  'u', 'i', 'r', 'e', 'f',
  // Geral
  'about', 'sobre', 'contact', 'contato', 'help', 'ajuda',
  'home', 'index', 'main',
]);

const slugifyText = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/** Resultado da geração — separa o slug pronto do indicador se foi modificado pra evitar colisão. */
export interface SlugResult {
  slug: string;
  /** True se o slug precisou de sufixo (-2, -3, etc) por causa de colisão. */
  hadCollision: boolean;
  /** True se o slug base bateu em RESERVED_SLUGS e foi modificado. */
  hitReserved: boolean;
}

/**
 * Compõe slug base a partir do nome do evento e do ano da edição.
 * Não consulta banco — só monta a string. Útil pra preview na UI.
 *
 * @example
 *   buildEventSlugBase("Usualdance Festival", 2026)        // "usualdance-festival-2026"
 *   buildEventSlugBase("Usualdance Festival 2026", 2026)   // "usualdance-festival-2026" (não duplica)
 *   buildEventSlugBase("Festival", 2026)                   // "festival-2026" (festival é reservado isolado, mas com ano OK)
 */
export const buildEventSlugBase = (name: string, year: number): string => {
  const nameSlug = slugifyText(name);
  if (!nameSlug) return `festival-${year}`;
  const yearSuffix = `-${year}`;
  return nameSlug.endsWith(yearSuffix) ? nameSlug : `${nameSlug}${yearSuffix}`;
};

/**
 * Gera slug único pra evento. Resolve colisões automaticamente (-2, -3, ...).
 *
 * @param name Nome do festival (ex: "Usualdance Festival")
 * @param year Ano da edição (ex: 2026)
 * @param ignoreEventId Se editando, passar o ID atual pra não considerar o próprio evento como colisão
 * @returns SlugResult com slug final + flags de modificação
 */
export const generateEventSlug = async (
  name: string,
  year: number,
  ignoreEventId?: string,
): Promise<SlugResult> => {
  let base = buildEventSlugBase(name, year);
  let hitReserved = false;

  // Se a base bateu em palavra reservada (improvável com ano, mas defensivo).
  if (RESERVED_SLUGS.has(base)) {
    base = `${base}-festival`;
    hitReserved = true;
  }

  // Probe unicidade. Em caso de colisão, append -2, -3, etc.
  let candidate = base;
  let suffix = 2;
  let hadCollision = false;

  // Loop com guarda — se acharmos 50 colisões algo está muito errado.
  for (let attempt = 0; attempt < 50; attempt++) {
    let query = supabase.from('events').select('id').eq('slug', candidate);
    if (ignoreEventId) query = query.neq('id', ignoreEventId);
    const { data } = await query.maybeSingle();
    if (!data) return { slug: candidate, hadCollision, hitReserved };
    hadCollision = true;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  // Fallback extremo: sufixo aleatório. Não deveria acontecer.
  return {
    slug: `${base}-${Math.random().toString(36).substring(2, 6)}`,
    hadCollision: true,
    hitReserved,
  };
};

/**
 * Valida slug fornecido pelo usuário (UI de edição em /configuracoes).
 * Retorna mensagem de erro ou null se válido.
 *
 * Regras:
 * - 3-60 chars
 * - Apenas a-z, 0-9 e hífen
 * - Não pode começar/terminar com hífen
 * - Não pode ser palavra reservada
 * - Disponibilidade (única) verificada separadamente via isSlugAvailable
 */
export const validateSlugInput = (slug: string): string | null => {
  if (!slug || slug.length < 3) return 'Mínimo 3 caracteres.';
  if (slug.length > 60) return 'Máximo 60 caracteres.';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use apenas letras minúsculas, números e hífen.';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Não pode começar nem terminar com hífen.';
  if (slug.includes('--')) return 'Não pode ter dois hífens seguidos.';
  if (RESERVED_SLUGS.has(slug)) return 'Esse nome é reservado pelo sistema. Escolha outro.';
  return null;
};

/**
 * Verifica se o slug está disponível no banco (não conflita com outro evento).
 * Passar ignoreEventId quando estiver editando — não considera o próprio evento.
 */
export const isSlugAvailable = async (slug: string, ignoreEventId?: string): Promise<boolean> => {
  let query = supabase.from('events').select('id').eq('slug', slug);
  if (ignoreEventId) query = query.neq('id', ignoreEventId);
  const { data } = await query.maybeSingle();
  return !data;
};
