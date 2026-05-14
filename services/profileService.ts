import { supabase } from './supabase';
import { Profile, UserRole } from '../types';

// Emails com acesso de Super Admin. Emails legados (*@usualdance.*) permanecem
// temporariamente para não bloquear acesso durante a transição para CoreoHub —
// remover após confirmar migração completa da equipe.
const ADMIN_EMAILS = [
  'admin@coreohub.com',
  'coreohub@gmail.com',
  'admin@usualdance.com.br',
  'usualdance@gmail.com',
];

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

      if (user.email && ADMIN_EMAILS.includes(user.email) && existingProfile.role !== UserRole.COREOHUB_ADMIN) {
        // Item 39: maybeSingle pra evitar PGRST116 caso o UPDATE não toque
        // nenhuma linha (trigger protect_profiles_privileged_columns pode
        // reverter, ou profile pode ter sido deletado entre fetch e update).
        // Promoção a admin é best-effort — falha cai pra existingProfile.
        const { data: updatedProfile } = await supabase
          .from('profiles')
          .update({ role: UserRole.COREOHUB_ADMIN })
          .eq('id', user.id)
          .select()
          .maybeSingle();
        if (updatedProfile) return updatedProfile as Profile;
      }
      return existingProfile as Profile;
    }

    const isAdminEmail = user.email && ADMIN_EMAILS.includes(user.email);

    const newProfile: any = {
      id: user.id,
      full_name: fullNameFromProvider || user.email?.split('@')[0] || 'Novo Usuário',
      email: user.email,
      avatar_url: avatarFromProvider,  // Google foto vai pro perfil automaticamente
      role: isAdminEmail ? UserRole.COREOHUB_ADMIN : UserRole.INDEPENDENT,
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
