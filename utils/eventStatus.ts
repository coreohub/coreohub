/**
 * Helper de fim de evento. Trava por dia inteiro encerrado (23:59:59 do
 * último dia), não por horário/aula individual.
 *
 * `events.end_date` é a fonte canônica (preenchida pelo painel via "Data do
 * Evento"); fallback pra `start_date` cobre eventos antigos sem end_date.
 * `events.event_date` é coluna legada — sempre NULL nos eventos reais (o
 * painel nunca escreve nela) — não usar.
 */

export interface EventDateLike {
  start_date?: string | null;
  end_date?: string | null;
}

/** True se o evento já passou (depois das 23:59:59 do end_date/start_date). */
export const isEventOver = (event: EventDateLike | null | undefined): boolean => {
  const dateStr = event?.end_date ?? event?.start_date ?? null;
  if (!dateStr) return false;
  const deadline = new Date(dateStr + 'T23:59:59');
  return deadline.getTime() < Date.now();
};
