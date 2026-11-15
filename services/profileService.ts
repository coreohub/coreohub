import { supabase } from './supabase';
import { Profile, UserRole } from '../types';

// Promoção a admin NÃO acontece no cliente: `role` e `is_super_admin` são colunas protegidas
// (trigger protect_profiles_privileged_columns reverte UPDATE e força INSERT). Quem concede
// é o banco/serviço. A lista de e-mails de admin que existia aqui era código morto e expunha
// os endereços no bundle (auditoria 2026-11-15, Passo 8).

export const getOrCreateProfile = async (user: any): Promise<Profile | null> => {
  if (!user) return null;

  try {
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Erro ao buscar perfil:', fetchError);
      throw fetchError;
    }

    // Login social (Google etc) traz nome e avatar no user_metadata
    const meta: any = user.user_metadata ?? {};
    const fullNameFromProvider = meta.full_name ?? meta.name ?? null;
    const avatarFromProvider   = meta.avatar_url ?? meta.picture ?? null;

    if (existingProfile) {
      // Backfill nome/avatar do provedor social SE o profile ainda não tem.
      // Não sobrescreve dados já preenchidos pelo user manualmente.
      const updates: Record<string, any> = {};
      if (!existingProfile.full_name && fullNameFromProvider) updates.full_name = fullNameFromProvider;
      if (!existingProfile.avatar_url && avatarFromProvider)  updates.avatar_url = avatarFromProvider;
      if (Object.keys(updates).length > 0) {
        await supabase.from('profiles').update(updates).eq('id', user.id);
        Object.assign(existingProfile, updates);
      }

      return existingProfile as Profile;
    }

    const newProfile: any = {
      id: user.id,
      full_name: fullNameFromProvider || user.email?.split('@')[0] || 'Novo Usuário',
      email: user.email,
      avatar_url: avatarFromProvider,  // Google foto vai pro perfil automaticamente
      role: UserRole.INDEPENDENT,
    };

    const { data: createdProfile, error: insertError } = await supabase
      .from('profiles')
      .insert([newProfile])
      .select()
      .single();

    if (insertError) throw insertError;
    return createdProfile as Profile;
  } catch (error) {
    console.error('Erro na lógica de getOrCreateProfile:', error);
    throw error;
  }
};
