import { supabase } from './supabase';
import { BattleBracket } from '../types';

// ─── Battle Brackets ────────────────────────────────────────────────────────

export const getBracketsByEvent = async (eventId: string): Promise<BattleBracket[]> => {
  const { data, error } = await supabase
    .from('battle_brackets')
    .select(`
      *,
      p1:profiles!battle_brackets_p1_id_fkey(full_name, avatar_url),
      p2:profiles!battle_brackets_p2_id_fkey(full_name, avatar_url)
    `)
    .eq('event_id', eventId)
    .order('phase')
    .order('position');

  if (error) throw error;
  return data || [];
};

export const getActiveBracket = async (eventId: string): Promise<BattleBracket | null> => {
  const { data, error } = await supabase
    .from('battle_brackets')
    .select(`
      *,
      p1:profiles!battle_brackets_p1_id_fkey(full_name, avatar_url),
      p2:profiles!battle_brackets_p2_id_fkey(full_name, avatar_url)
    `)
    .eq('event_id', eventId)
    .eq('status', 'active')
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

export const updateBracketWinner = async (
  bracketId: string,
  winnerId: string
): Promise<void> => {
  const { error } = await supabase
    .from('battle_brackets')
    .update({ winner_id: winnerId, status: 'finished', updated_at: new Date().toISOString() })
    .eq('id', bracketId);

  if (error) throw error;
};

export const activateBracket = async (bracketId: string): Promise<void> => {
  const { error } = await supabase
    .from('battle_brackets')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', bracketId);

  if (error) throw error;
};

export const createBrackets = async (
  eventId: string,
  participants: { id: string; name: string }[],
  category: string,
  style: string
): Promise<void> => {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const brackets: Partial<BattleBracket>[] = [];

  for (let i = 0; i < shuffled.length - 1; i += 2) {
    brackets.push({
      event_id: eventId,
      category,
      style,
      phase: 'Oitavas de Final',
      position: Math.floor(i / 2),
      p1_id: shuffled[i].id,
      p2_id: shuffled[i + 1]?.id,
      status: 'pending'
    });
  }

  const { error } = await supabase.from('battle_brackets').insert(brackets);
  if (error) throw error;
};

// ─── Battle Votes (avaliações de batalha) ───────────────────────────────────

export const submitBattleVote = async (
  bracketId: string,
  judgeId: string,
  vote: 'A' | 'B' | 'TIE'
): Promise<void> => {
  const { error } = await supabase.from('evaluations').insert([{
    registration_id: bracketId,
    judge_id: judgeId,
    scores: { vote },
    final_weighted_average: vote === 'A' ? 1 : vote === 'B' ? 0 : 0.5,
    created_at: new Date().toISOString()
  }]);

  if (error) throw error;
};

export const getBattleVotes = async (bracketId: string): Promise<{ vote: string; count: number }[]> => {
  const { data, error } = await supabase
    .from('evaluations')
    .select('scores')
    .eq('registration_id', bracketId);

  if (error) throw error;

  const votes = (data || []).map((e: any) => e.scores?.vote).filter(Boolean);
  const counts: Record<string, number> = {};
  votes.forEach((v: string) => { counts[v] = (counts[v] || 0) + 1; });

  return Object.entries(counts).map(([vote, count]) => ({ vote, count }));
};

// ─── Realtime subscription ───────────────────────────────────────────────────

export const subscribeToBrackets = (
  eventId: string,
  callback: (bracket: BattleBracket) => void
) => {
  return supabase
    .channel(`battle-brackets-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'battle_brackets', filter: `event_id=eq.${eventId}` },
      (payload) => callback(payload.new as BattleBracket)
    )
    .subscribe();
};
