// Acesso da equipe (operadores) por grupo de sessões do espetáculo.
// O vínculo é 1 evento (profiles.team_event_id); o acesso vale pra todas as sessões
// do mesmo grupo E do mesmo produtor. Fonte única: RPC team_event_ids (mesma regra
// das policies de RLS).

// deno-lint-ignore no-explicit-any
export async function teamEventIds(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('team_event_ids', { uid: userId })
  if (error) throw error
  return Array.isArray(data) ? data.map(String) : []
}

// deno-lint-ignore no-explicit-any
export async function isTeamMemberOfEvent(supabase: any, userId: string, eventId: string): Promise<boolean> {
  return (await teamEventIds(supabase, userId)).includes(String(eventId))
}
