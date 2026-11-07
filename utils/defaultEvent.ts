// Evento padrão de um seletor: se o escolhido for uma sessão irmã de um espetáculo
// (events.session_group_id aponta pro principal), abre na principal — a primeira sessão —
// em vez da sessão criada por último. Sem grupo, devolve o próprio evento.
type EventLike = { id: string; session_group_id?: string | null };

export function pickDefaultEvent<T extends EventLike>(chosen: T, list: T[]): T {
  const gid = chosen.session_group_id;
  if (!gid || gid === chosen.id) return chosen;
  return list.find(e => e.id === gid) ?? chosen;
}
