import { supabase } from './supabase';
import { Profile, UserRole } from '../types';

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

    if (existingProfile) {
      const adminEmails = ['admin@usualdance.com.br', 'usualdance@gmail.com'];
      if (user.email && adminEmails.includes(user.email) && existingProfile.role !== UserRole.USUALDANCE_ADMIN) {
        const { data: updatedProfile } = await supabase
          .from('profiles')
          .update({ role: UserRole.USUALDANCE_ADMIN })
          .eq('id', user.id)
          .select()
          .single();
        if (updatedProfile) return updatedProfile as Profile;
      }
      return existingProfile as Profile;
    }

    const adminEmails = ['admin@usualdance.com.br', 'usualdance@gmail.com'];
    const isAdminEmail = user.email && adminEmails.includes(user.email);

    const newProfile: any = {
      id: user.id,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Novo Usuário',
      email: user.email,
      role: isAdminEmail ? UserRole.USUALDANCE_ADMIN : UserRole.INDEPENDENT,
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
