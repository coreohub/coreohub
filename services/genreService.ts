/**
 * genreService.ts
 * CRUD para Gêneros (event_styles) e Subgêneros (sub_types jsonb)
 *
 * Arquitetura dos 3 Eixos:
 *   Eixo Técnico  → EventStyle (Gênero) + Subgenre (Subgênero)
 *   Eixo Etário   → categories table
 *   Eixo Formação → configuracoes.formatos jsonb
 */

import { supabase } from './supabase';
import { EventStyle, Subgenre } from '../types';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Garante que sub_types sempre retorne Subgenre[] (nunca string[]) */
function normalizeSubTypes(raw: any): Subgenre[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((item: any) => {
      if (typeof item === 'string') return { name: item, is_categoria_livre: false };
      if (item && typeof item === 'object' && item.name) {
        return {
          name: item.name,
          is_categoria_livre: item.is_categoria_livre ?? false,
          allow_shorter_track: item.allow_shorter_track ?? false,
        };
      }
      return null;
    })
    .filter(Boolean) as Subgenre[];
}

function toEventStyle(row: any): EventStyle {
  return {
    id:                   row.id,
    event_id:             row.event_id,
    name:                 row.name,
    is_active:            row.is_active ?? true,
    sub_types:            normalizeSubTypes(row.sub_types),
    requires_subcategory: row.requires_subcategory ?? false,
  };
}

/* ── Leitura ─────────────────────────────────────────────────────────────── */

export async function getGenres(eventId: string): Promise<EventStyle[]> {
  const { data, error } = await supabase
    .from('event_styles')
    .select('*')
    .eq('event_id', eventId)
    .order('name');

  if (error) throw error;
  return (data ?? []).map(toEventStyle);
}

export async function getAllGenres(options?: { includeHidden?: boolean }): Promise<EventStyle[]> {
  const { data, error } = await supabase
    .from('event_styles')
    .select('*')
    .order('name');

  if (error) throw error;
  const all = (data ?? []).map(toEventStyle);

  // Filtra gêneros "ocultos" — quando o produtor "exclui" um gênero do
  // catálogo global, criamos um fork local com is_active=false (vide
  // deleteGenre). Por default, esses ficam ocultos da lista. Pra reativar,
  // a UI passa includeHidden=true e oferece botão "Reativar".
  if (options?.includeHidden) return all;

  // Mapa: nome lowercase → fork local do user (created_by não NULL)
  const localOverrides = new Map<string, EventStyle>();
  for (const g of all) {
    // Se há um fork local inativo, ele "mascara" o global de mesmo nome.
    // toEventStyle não retorna created_by, então leio do data bruto:
    const raw = data!.find(r => r.id === g.id);
    if (raw?.created_by && !g.is_active) {
      localOverrides.set(g.name.trim().toLowerCase(), g);
    }
  }

  return all.filter(g => {
    const key = g.name.trim().toLowerCase();
    const override = localOverrides.get(key);
    if (!override) return true;
    // Tem override local inativo. Esconde TODAS as rows desse nome
    // (inclui o global original que o user "excluiu" + o próprio fork).
    return false;
  });
}

/* ── Criação ─────────────────────────────────────────────────────────────── */

export async function createGenre(
  eventId: string,
  name: string,
  subgenres: Subgenre[] = [],
): Promise<EventStyle> {
  // created_by é obrigatório pra passar pela RLS `producer_writes_own_styles`
  // que exige WITH CHECK (created_by = auth.uid()). Sem isso, só super admin
  // consegue criar/editar gêneros (via super_admin_all_event_styles).
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('event_styles')
    .insert({
      event_id:             eventId,
      name:                 name.trim(),
      sub_types:            subgenres,
      is_active:            true,
      requires_subcategory: subgenres.length > 0,
      created_by:           user?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return toEventStyle(data);
}

/* ── Atualização ─────────────────────────────────────────────────────────── */

export async function updateGenre(
  id: string,
  updates: { name?: string; is_active?: boolean; sub_types?: Subgenre[] },
): Promise<EventStyle> {
  const patch: any = { ...updates };
  if (updates.sub_types !== undefined) {
    patch.requires_subcategory = updates.sub_types.length > 0;
  }

  // Tenta atualizar primeiro (funciona se o gênero é do produtor ou se é admin).
  // maybeSingle em vez de single porque RLS pode bloquear UPDATE silenciosamente
  // (returning 0 rows), e .single() lançaria "Cannot coerce".
  const { data, error } = await supabase
    .from('event_styles')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (data) return toEventStyle(data);

  // Fallback: UPDATE retornou 0 rows = o gênero é do catálogo global (created_by NULL)
  // e o produtor não tem permissão de edit. Em vez de falhar, faz FORK: busca o
  // gênero original, cria uma cópia com created_by = user e os patches aplicados.
  // Padrão Notion/Figma "edit a template": editou? Vira seu.
  const { data: original, error: fetchErr } = await supabase
    .from('event_styles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!original) {
    throw new Error('Esse gênero não existe mais. Recarregue a página.');
  }

  const { data: { user } } = await supabase.auth.getUser();
  const forkedPayload = {
    event_id:             original.event_id,
    name:                 patch.name ?? original.name,
    sub_types:            patch.sub_types ?? original.sub_types,
    is_active:            patch.is_active ?? original.is_active,
    requires_subcategory: patch.requires_subcategory ?? original.requires_subcategory,
    created_by:           user?.id ?? null,
  };

  const { data: forked, error: forkErr } = await supabase
    .from('event_styles')
    .insert(forkedPayload)
    .select()
    .single();

  if (forkErr) throw forkErr;
  return toEventStyle(forked);
}

/** Adiciona um subgênero a um gênero existente */
export async function addSubgenre(
  genre: EventStyle,
  subgenre: Subgenre,
): Promise<EventStyle> {
  const newSubs = [...genre.sub_types, subgenre];
  return updateGenre(genre.id, { sub_types: newSubs });
}

/** Edita um subgênero pelo índice */
export async function editSubgenre(
  genre: EventStyle,
  index: number,
  updated: Subgenre,
): Promise<EventStyle> {
  const newSubs = genre.sub_types.map((s, i) => (i === index ? updated : s));
  return updateGenre(genre.id, { sub_types: newSubs });
}

/** Remove um subgênero pelo índice */
export async function removeSubgenre(
  genre: EventStyle,
  index: number,
): Promise<EventStyle> {
  const newSubs = genre.sub_types.filter((_, i) => i !== index);
  return updateGenre(genre.id, { sub_types: newSubs });
}

/* ── Exclusão ─────────────────────────────────────────────────────────────── */

/**
 * Tenta DELETE direto. Se RLS bloquear (gênero do catálogo global criado
 * por admin), faz soft-delete via FORK: cria/atualiza row local do produtor
 * com is_active=false, que o getGenres filtra fora da lista visual.
 *
 * Retorna { hard: true } quando deletou de fato, { hard: false, hiddenId }
 * quando ocultou via fork. UI usa pra mostrar mensagem apropriada.
 */
export async function deleteGenre(id: string): Promise<{ hard: boolean; hiddenId?: string }> {
  // .select() retorna as rows efetivamente deletadas — necessário pra
  // detectar quando RLS bloqueia silenciosamente.
  const { data, error } = await supabase
    .from('event_styles')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;

  if (data && data.length > 0) {
    return { hard: true };
  }

  // Fallback: gênero do catálogo global (created_by NULL). RLS bloqueou
  // o DELETE direto. Fazemos fork-on-soft-delete via updateGenre —
  // mesma lógica do fork-on-edit que já existe pra UPDATE de globais.
  // O fork local fica com is_active=false e o getGenres filtra fora.
  const forked = await updateGenre(id, { is_active: false });
  return { hard: false, hiddenId: forked.id };
}

/* ── Utilidades para o Checkout ──────────────────────────────────────────── */

/**
 * Retorna os subgêneros de um gênero que precisam de categoria etária.
 * (is_categoria_livre === false)
 */
export function getSubgenresWithAgeRestriction(genre: EventStyle): Subgenre[] {
  return genre.sub_types.filter(s => !s.is_categoria_livre);
}

/**
 * Dado um subgênero, retorna true se o checkout deve pular o Eixo Etário.
 */
export function shouldSkipAgeAxis(subgenre: Subgenre): boolean {
  return subgenre.is_categoria_livre;
}

/**
 * Dado um subgênero, retorna true se a validação de duração mínima da trilha deve ser ignorada.
 * Usado para Balé de Repertório e similares.
 */
export function shouldSkipMinDurationCheck(subgenre: Subgenre): boolean {
  return subgenre.allow_shorter_track === true;
}

/**
 * Dado um nome de subgênero e a lista de estilos, retorna se aquele subgênero
 * tem allow_shorter_track ativado.
 */
export function isRepertorioSubgenre(subgenreName: string, genres: import('../types').EventStyle[]): boolean {
  for (const genre of genres) {
    for (const sub of genre.sub_types) {
      if (sub.name === subgenreName && sub.allow_shorter_track) return true;
    }
  }
  return false;
}
