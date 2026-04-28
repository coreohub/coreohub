import { supabase } from './supabase';
import { UserRole, PermissoesCustom } from '../types';

export interface TeamInvite {
  id: string;
  token: string;
  email: string;
  full_name: string | null;
  cargo: string | null;
  role: UserRole;
  permissoes_custom: PermissoesCustom | null;
  used_at: string | null;
  used_by: string | null;
  expires_at: string;
  invited_by: string;
  created_at: string;
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function listTeamInvites(): Promise<TeamInvite[]> {
  const { data, error } = await supabase
    .from('team_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TeamInvite[];
}

export async function createTeamInvite(input: {
  email: string;
  full_name?: string;
  cargo?: string;
  role: UserRole;
  permissoes_custom: PermissoesCustom;
}): Promise<TeamInvite> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const token = generateToken();
  const { data, error } = await supabase
    .from('team_invites')
    .insert({
      token,
      email:             input.email.trim().toLowerCase(),
      full_name:         input.full_name?.trim() ?? null,
      cargo:             input.cargo?.trim() ?? null,
      role:              input.role,
      permissoes_custom: input.permissoes_custom,
      invited_by:        user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as TeamInvite;
}

export async function deleteTeamInvite(id: string): Promise<void> {
  const { error } = await supabase.from('team_invites').delete().eq('id', id);
  if (error) throw error;
}

export async function getTeamInviteByToken(token: string): Promise<TeamInvite | null> {
  const { data, error } = await supabase
    .from('team_invites')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as TeamInvite | null;
}

export async function markTeamInviteUsed(token: string, userId: string): Promise<void> {
  await supabase
    .from('team_invites')
    .update({ used_at: new Date().toISOString(), used_by: userId })
    .eq('token', token);
}

export function buildTeamInviteUrl(token: string): string {
  const base = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'https://app.coreohub.com';
  return `${base}/equipe-convite/${token}`;
}
