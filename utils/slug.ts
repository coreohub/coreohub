// Slug público (URL) de workshop: gerado do nome, sem acento, minúsculo, só letras, números e hífens.
// Módulo puro, testado no Vitest. O servidor confere a disponibilidade (RPC workshop_slug_available).

const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');

export const SLUG_MAX = 50;
export const SLUG_MIN = 3;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
}

/** Sugestão a partir do nome; acrescenta "com <professor>" só se o nome ainda não cita o professor. */
export function suggestWorkshopSlug(name: string, professor: string): string {
  const base = slugify(name);
  if (!base) return '';
  const prof = slugify(professor);
  if (!prof || base.includes(prof)) return base;
  return slugify(`${name} com ${professor}`);
}

const withSuffix = (base: string, suffix: string): string =>
  `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;

/** Ano (4 dígitos) de uma data ISO ou "YYYY-MM-DD"; null se ausente ou inválida. Sem fuso: usa o texto. */
export function yearOf(date: string | null | undefined): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(date ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Alternativas quando o slug já está em uso: primeiro o ano no fim (edição seguinte do mesmo workshop,
 * ex.: jazz-com-lucas-maia-2028), depois -2 e -3. O ano não é repetido se o slug já o contém.
 */
export function slugAlternatives(base: string, year?: number | null, count = 2): string[] {
  const out: string[] = [];
  if (year && !base.includes(String(year))) out.push(withSuffix(base, `-${year}`));
  for (let n = 2; n < 2 + count; n++) out.push(withSuffix(base, `-${n}`));
  return out;
}

export type SlugValidity = 'ok' | 'vazio' | 'curto' | 'invalido';

/** Valida o formato final (já slugificado): 3 a 50 caracteres, letras minúsculas, números e hífens. */
export function slugValidity(slug: string): SlugValidity {
  if (!slug) return 'vazio';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'invalido';
  if (slug.length < SLUG_MIN) return 'curto';
  return 'ok';
}
