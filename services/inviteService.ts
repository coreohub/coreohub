import { supabase } from './supabase';

export interface ProducerInvite {
  id: string;
  token: string;
  email: string;
  full_name: string | null;
  used_at: string | null;
  used_by: string | null;
  expires_at: string;
  created_by: string;
  created_at: string;
}

function generateToken(): string {
  // 32 chars base64url-safe
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function listInvites(): Promise<ProducerInvite[]> {
  const { data, error } = await supabase
    .from('producer_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createInvite(input: {
  email: string;
  full_name?: string;
}): Promise<ProducerInvite> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const token = generateToken();
  const { data, error } = await supabase
    .from('producer_invites')
    .insert({
      token,
      email:      input.email.trim().toLowerCase(),
      full_name:  input.full_name?.trim() ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ProducerInvite;
}

export async function deleteInvite(id: string): Promise<void> {
  const { error } = await supabase.from('producer_invites').delete().eq('id', id);
  if (error) throw error;
}

/** Valida convite na landing pública (consulta sem autenticação) */
export async function getInviteByToken(token: string): Promise<ProducerInvite | null> {
  const { data, error } = await supabase
    .from('producer_invites')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as ProducerInvite | null;
}

/** Marca convite como usado (chamado depois do signup) */
export async function markInviteUsed(token: string, userId: string): Promise<void> {
  await supabase
    .from('producer_invites')
    .update({ used_at: new Date().toISOString(), used_by: userId })
    .eq('token', token);
}

export function buildInviteUrl(token: string): string {
  const base = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'https://app.coreohub.com';
  return `${base}/convite/${token}`;
}
