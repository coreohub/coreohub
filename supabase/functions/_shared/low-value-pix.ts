// Agrupa repasses de baixo valor já transferidos pra subconta (status
// 'transferido') por produtora, pra release-low-value-transfers mandar cada
// lote pro PIX numa única transferência. Puro (sem I/O) pra ser testável.

export interface LowValueToSend {
  id:          string
  value:       number | string
  producer_id: string
}

export interface ProducerPixBatch {
  producerId: string
  total:      number
  /** Na ordem recebida (as mais antigas primeiro), pro pickCoveredCommissionIds. */
  items:      { id: string; net: number }[]
}

const round2 = (n: number): number => parseFloat(n.toFixed(2))

export function groupLowValueByProducer(rows: LowValueToSend[]): ProducerPixBatch[] {
  const byProducer = new Map<string, ProducerPixBatch>()
  for (const r of rows) {
    const net = round2(Number(r.value))
    if (!(net > 0)) continue
    let batch = byProducer.get(r.producer_id)
    if (!batch) {
      batch = { producerId: r.producer_id, total: 0, items: [] }
      byProducer.set(r.producer_id, batch)
    }
    batch.items.push({ id: r.id, net })
    batch.total = round2(batch.total + net)
  }
  return Array.from(byProducer.values())
}
