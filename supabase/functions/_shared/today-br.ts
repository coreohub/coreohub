// "Hoje" no Brasil (America/Sao_Paulo) como AAAA-MM-DD. Módulo puro (sem Deno.*),
// testado no Vitest e usado pelo servidor (Deno roda em UTC) e pelo front.
//
// Lote vale até a `data_virada` (inclusive) pela data do calendário brasileiro: entre
// 21h e 24h BRT o UTC já é o dia seguinte, e usar toISOString() virava o lote 3h cedo.

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

export function todayBR(now: Date = new Date()): string {
  return FMT.format(now)
}
