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
        return { name: item.name, is_categoria_livre: item.is_categoria_livre ?? false };
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

export async function getAllGenres(): Promise<EventStyle[]> {
  const { data, error } = await supabase
    .from('event_styles')
    .select('*')
    .order('name');

  if (error) throw error;
  return (data ?? []).map(toEventStyle);
}

/* ── Criação ─────────────────────────────────────────────────────────────── */

export async function createGenre(
  eventId: string,
  name: string,
  subgenres: Subgenre[] = [],
): Promise<EventStyle> {
  const { data, error } = await supabase
    .from('event_styles')
    .insert({
      event_id:             eventId,
      name:                 name.trim(),
      sub_types:            subgenres,
      is_active:            true,
      requires_subcategory: subgenres.length > 0,
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

  const { data, error } = await supabase
    .from('event_styles')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toEventStyle(data);
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

export async function deleteGenre(id: string): Promise<void> {
  const { error } = await supabase
    .from('event_styles')
    .delete()
    .eq('id', id);

  if (error) throw error;
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
