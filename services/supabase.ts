import { createClient } from '@supabase/supabase-js';
import { Registration, Profile, Event, UserRole } from '../types';

/**
 * CONFIGURAÇÃO DO SUPABASE:
 * -------------------------
 * Projeto: ghpltzzijlvykiytwslu
 */

export const supabaseUrl = 'https://ghpltzzijlvykiytwslu.supabase.co';
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdocGx0enppamx2eWtpeXR3c2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDAyNjEsImV4cCI6MjA4NTg3NjI2MX0.AshAXh_5Dn2S3E74XbnDtxnb92kER8tAxEdZmKnywG8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false
  }
});

/**
 * INTERFACES DE CONEXÃO
 */
export interface ConnectionStatus {
  success: boolean;
  type: 'error' | 'connected' | 'network' | 'no_table' | 'auth_error';
  message: string;
}

/**
 * BUSCA DE DADOS
 */
export const getEvents = async (userId?: string): Promise<Event[]> => {
  let query = supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (userId) {
    query = query.eq('created_by', userId);
  }

  const { data, error } = await query;
  
  if (error) throw error;
  return data || [];
};

export const getEventById = async (id: string): Promise<Event | null> => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
};

export const updateEvent = async (id: string, updates: Partial<Event>) => {
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) throw error;
  return data;
};

export const createEvent = async (payload: Partial<Event>) => {
  const { data, error } = await supabase
    .from('events')
    .insert([payload])
    .select();
    
  if (error) throw error;
  return data;
};

export const subscribeToEvents = (callback: () => void) => {
  return supabase
    .channel('events-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => callback())
    .subscribe();
};

export const getRegistrations = async (): Promise<Registration[]> => {
  const { data, error } = await supabase
    .from('registrations')
    .select('*, profiles(full_name), events(*)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const getProfile = async (id: string): Promise<Profile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

export const updateProfile = async (id: string, updates: Partial<Profile>) => {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
  return data;
};

/**
 * AVALIAÇÕES E STORAGE
 */
export const uploadAudioFeedback = async (regId: string, audioBlob: Blob) => {
  const fileName = `feedback_${regId}_${Date.now()}.webm`;
  const { data, error } = await supabase.storage
    .from('audio-feedbacks')
    .upload(fileName, audioBlob);
    
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage
    .from('audio-feedbacks')
    .getPublicUrl(fileName);
    
  return publicUrl;
};

export const uploadEventCover = async (eventId: string, fileBlob: Blob) => {
  const fileName = `cover_${eventId}_${Date.now()}.webp`;
  const { data, error } = await supabase.storage
    .from('event-covers')
    .upload(fileName, fileBlob, {
      contentType: 'image/webp'
    });
    
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage
    .from('event-covers')
    .getPublicUrl(fileName);
    
  return publicUrl;
};

export const uploadEventRules = async (eventId: string, file: File) => {
  const fileExt = file.name.split('.').pop();
  const fileName = `rules_${eventId}_${Date.now()}.${fileExt}`;
  const { data, error } = await supabase.storage
    .from('event-rules')
    .upload(fileName, file);
    
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage
    .from('event-rules')
    .getPublicUrl(fileName);
    
  return publicUrl;
};

export const uploadMusic = async (eventId: string, file: File) => {
  const fileExt = file.name.split('.').pop();
  const fileName = `music_${eventId}_${Date.now()}.${fileExt}`;
  const { data, error } = await supabase.storage
    .from('event-music')
    .upload(fileName, file);
    
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage
    .from('event-music')
    .getPublicUrl(fileName);
    
  return publicUrl;
};

export const submitEvaluation = async (evaluation: any) => {
  const { data, error } = await supabase
    .from('evaluations')
    .insert([evaluation])
    .select();
  if (error) throw error;
  return data;
};

/**
 * REALTIME E ESCRITA
 */
export const subscribeToRegistrations = (callback: () => void) => {
  return supabase
    .channel('schema-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => callback())
    .subscribe();
};

export const createRegistration = async (payload: Partial<Registration>) => {
  const { data, error } = await supabase
    .from('registrations')
    .insert([payload])
    .select();
  if (error) throw error;
  return data;
};

// ─── Seletiva de Vídeo ───────────────────────────────────────────────────────

export type VideoStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'conditional';
export type VideoFeeStatus = 'not_required' | 'pending' | 'paid' | 'waived';

/** Busca inscrições de um evento com dados de seletiva de vídeo */
export const getRegistrationsByEvent = async (eventId: string): Promise<Registration[]> => {
  const { data, error } = await supabase
    .from('registrations')
    .select('*, profiles(full_name)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

/** Inscrição envia link do vídeo para seletiva */
export const submitVideoForSelection = async (
  registrationId: string,
  videoUrl: string
): Promise<void> => {
  const { error } = await supabase
    .from('registrations')
    .update({
      video_url: videoUrl,
      video_status: 'submitted',
      video_submitted_at: new Date().toISOString(),
    })
    .eq('id', registrationId);
  if (error) throw error;
};

/** Produtor decide sobre o vídeo enviado */
export const reviewVideoSubmission = async (
  registrationId: string,
  status: Extract<VideoStatus, 'approved' | 'rejected' | 'conditional'>,
  feedback?: string
): Promise<void> => {
  const { error } = await supabase
    .from('registrations')
    .update({ video_status: status, video_feedback: feedback ?? null })
    .eq('id', registrationId);
  if (error) throw error;
};

/** Atualiza status de pagamento da seletiva */
export const updateVideoFeeStatus = async (
  registrationId: string,
  feeStatus: VideoFeeStatus,
  paymentId?: string
): Promise<void> => {
  const { error } = await supabase
    .from('registrations')
    .update({
      video_fee_status: feeStatus,
      video_fee_payment_id: paymentId ?? null,
    })
    .eq('id', registrationId);
  if (error) throw error;
};

/** Assina em tempo real mudanças nas seletivas de um evento */
export const subscribeToVideoSelections = (
  eventId: string,
  callback: () => void
) => {
  return supabase
    .channel(`video-selection-${eventId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'registrations',
        filter: `event_id=eq.${eventId}`,
      },
      () => callback()
    )
    .subscribe();
};

// ─── Regulamento IA ──────────────────────────────────────────────────────────

/** Faz upload do PDF de regulamento e retorna a URL pública */
export const uploadRegulationPdf = async (eventId: string, file: File): Promise<string> => {
  const fileExt = file.name.split('.').pop() ?? 'pdf';
  const fileName = `regulation_${eventId}_${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('event-rules')
    .upload(fileName, file, { contentType: file.type });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage
    .from('event-rules')
    .getPublicUrl(fileName);
  return publicUrl;
};

// ─── Verificação de Conexão ───────────────────────────────────────────────────

export const checkConnection = async (): Promise<ConnectionStatus> => {
  try {
    const { data, error } = await supabase.from('configuracoes').select('id').eq('id', 1).single();
    if (error) {
      const type = error.code === '42P01' ? 'no_table' : 
                   (error.message.includes('JWT') || error.code === 'PGRST301') ? 'auth_error' : 'error';
      return { success: false, type: type as any, message: error.message };
    }
    return { success: true, type: 'connected', message: 'Conectado.' };
  } catch (e: any) {
    console.error('Supabase connection error:', e);
    const isNetworkError = e.message?.includes('Failed to fetch') || e.name === 'TypeError';
    return { 
      success: false, 
      type: isNetworkError ? 'network' : 'error', 
      message: isNetworkError ? 'Não foi possível conectar ao servidor. Verifique sua internet ou se o projeto está ativo.' : e.message 
    };
  }
};
