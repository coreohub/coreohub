// Converte o que a IA leu LITERALMENTE de uma planta de assentos (PDF/imagem) na grade do /locais.
// A IA só transcreve (letra da fileira, blocos de números na ordem impressa, alinhamento, palco);
// a decisão de corredor/espelhado/palco é daqui, determinística e testada em tests/seat-map-from-plan.test.ts.

import type { RowConfig } from './venueRows';

export type PlanAlignment = 'esquerda' | 'centro' | 'direita';
export type PlanStage = 'cima' | 'baixo' | 'indefinido';
export type PlanHintKind = 'cadeirante' | 'pcd_largo' | 'acompanhante' | 'desconhecido';

export interface PlanRow {
  codigo: string;
  /** Blocos separados por corredor, cada um com os números NA ORDEM IMPRESSA (esquerda para direita). */
  blocos: number[][];
  alinhamento: PlanAlignment;
}

export interface PlanHint {
  codigo: string;
  numero: number;
  tipo: PlanHintKind;
  /** 0 a 1. Só sugestão: nunca vira tipo de assento sozinho. */
  confianca: number;
}

export interface PlanExtraction {
  palco: PlanStage;
  /** Fileiras na ordem impressa, de cima para baixo. */
  fileiras: PlanRow[];
  sugestoes?: PlanHint[];
  /** Dúvidas que a IA apontou (trecho ilegível, número cortado). Viram avisos na prévia. */
  notas?: string[];
}

export interface PlanConversion {
  rows: RowConfig[];
  total: number;
  warnings: string[];
  /** Sugestões de PCD para o produtor revisar (não aplicadas em `rows`). */
  sugestoes: PlanHint[];
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

/** Limpa o que veio da IA: descarta o que não é número válido e fileira sem código. Nunca lança. */
export function sanitizePlan(raw: unknown): PlanExtraction {
  const r = (raw ?? {}) as Partial<PlanExtraction>;
  const palco: PlanStage = r.palco === 'cima' || r.palco === 'baixo' ? r.palco : 'indefinido';
  const fileiras: PlanRow[] = (Array.isArray(r.fileiras) ? r.fileiras : [])
    .map(f => ({
      codigo: String(f?.codigo ?? '').trim().toUpperCase(),
      blocos: (Array.isArray(f?.blocos) ? f.blocos : [])
        .map(b => (Array.isArray(b) ? b.filter(isInt) : []))
        .filter(b => b.length > 0),
      alinhamento: (f?.alinhamento === 'esquerda' || f?.alinhamento === 'direita' ? f.alinhamento : 'centro') as PlanAlignment,
    }))
    .filter(f => f.codigo !== '');
  const sugestoes: PlanHint[] = (Array.isArray(r.sugestoes) ? r.sugestoes : [])
    .filter(h => h && isInt(h.numero) && String(h.codigo ?? '').trim() !== '')
    .map(h => ({
      codigo: String(h.codigo).trim().toUpperCase(),
      numero: h.numero,
      tipo: (['cadeirante', 'pcd_largo', 'acompanhante'].includes(h.tipo) ? h.tipo : 'desconhecido') as PlanHintKind,
      confianca: Math.min(1, Math.max(0, Number(h.confianca) || 0)),
    }));
  const notas = (Array.isArray(r.notas) ? r.notas : []).map(n => String(n ?? '').trim()).filter(Boolean);
  return { palco, fileiras, sugestoes, notas };
}

/** Espelhada = números decrescem da esquerda para a direita. Vale o sentido dentro dos blocos; só com blocos de 1 lugar compara a fileira toda. */
function isMirrored(blocos: number[][]): boolean {
  const longos = blocos.filter(b => b.length >= 2);
  if (longos.length) return longos.every(b => b[0] > b[b.length - 1]);
  const flat = blocos.flat();
  return flat.length > 1 && flat[0] > flat[flat.length - 1];
}

function convertRow(f: PlanRow, warnings: string[]): RowConfig | null {
  const flat = f.blocos.flat();
  if (flat.length === 0) {
    warnings.push(`Fileira ${f.codigo}: nenhum lugar lido.`);
    return null;
  }
  const assentos = Math.max(...flat);

  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const n of flat) (seen.has(n) ? dup : seen).add(n);
  if (dup.size) warnings.push(`Fileira ${f.codigo}: número repetido (${[...dup].sort((a, b) => a - b).join(', ')}).`);

  const faltam: number[] = [];
  for (let n = 1; n <= assentos; n++) if (!seen.has(n)) faltam.push(n);
  if (faltam.length) warnings.push(`Fileira ${f.codigo}: faltam os números ${faltam.join(', ')} (buraco na sequência).`);

  // Cada bloco precisa andar num sentido só, e todos os blocos no mesmo sentido.
  const sentidos = new Set<'sobe' | 'desce'>();
  for (const b of f.blocos) {
    if (b.length < 2) continue;
    const sobe = b.every((n, i) => i === 0 || n > b[i - 1]);
    const desce = b.every((n, i) => i === 0 || n < b[i - 1]);
    if (sobe) sentidos.add('sobe');
    else if (desce) sentidos.add('desce');
    else warnings.push(`Fileira ${f.codigo}: numeração fora de ordem dentro de um bloco (${b.join(', ')}).`);
  }
  if (sentidos.size > 1) warnings.push(`Fileira ${f.codigo}: blocos com numeração em sentidos opostos. Revise a fileira.`);

  // Os blocos também precisam andar no mesmo sentido da numeração dentro deles (senão a grade desenha errado).
  const mins = f.blocos.map(b => Math.min(...b));
  if (f.blocos.length > 1 && sentidos.size === 1) {
    const mesmoSentido = sentidos.has('desce')
      ? mins.every((m, i) => i === 0 || m < mins[i - 1])
      : mins.every((m, i) => i === 0 || m > mins[i - 1]);
    if (!mesmoSentido) warnings.push(`Fileira ${f.codigo}: a ordem dos blocos não acompanha a numeração. Revise a fileira.`);
  }

  // Corredor entre dois blocos = último número do bloco de menor numeração.
  const porNumero = [...f.blocos].map(b => ({ min: Math.min(...b), max: Math.max(...b) })).sort((a, b) => a.min - b.min);
  const corredores: number[] = [];
  for (let i = 0; i < porNumero.length - 1; i++) {
    if (porNumero[i].max >= porNumero[i + 1].min) {
      warnings.push(`Fileira ${f.codigo}: blocos com números sobrepostos.`);
      continue;
    }
    corredores.push(porNumero[i].max);
  }

  if (f.alinhamento === 'direita') warnings.push(`Fileira ${f.codigo}: alinhada à direita na planta; a grade só alinha à esquerda ou ao centro.`);

  return {
    codigo: f.codigo,
    assentos,
    pcd: [],
    ...(corredores.length ? { corredor_apos: corredores[0] } : {}),
    ...(corredores.length > 1 ? { corredores_apos: corredores } : {}),
    ...(isMirrored(f.blocos) ? { espelhado: true } : {}),
    ...(f.alinhamento === 'esquerda' ? { alinhamento: 'esquerda' as const } : {}),
  };
}

/**
 * Plano lido -> `RowConfig[]` na ordem da grade (a última fileira é a que fica junto do palco).
 * `expectedTotal` é o total que o produtor informou; se divergir, vira aviso.
 */
export function planToRows(planIn: PlanExtraction, expectedTotal?: number): PlanConversion {
  const plan = sanitizePlan(planIn);
  const warnings: string[] = (plan.notas ?? []).map(n => `A IA avisou: ${n}`);

  if (plan.fileiras.length === 0) warnings.push('Nenhuma fileira foi lida da planta.');

  const codigos = new Set<string>();
  for (const f of plan.fileiras) {
    if (codigos.has(f.codigo)) warnings.push(`Fileira ${f.codigo} aparece mais de uma vez.`);
    codigos.add(f.codigo);
  }

  let rows = plan.fileiras.map(f => convertRow(f, warnings)).filter((r): r is RowConfig => r !== null);

  // A grade termina na fileira do palco: palco em cima inverte a ordem impressa.
  if (plan.palco === 'cima') rows = rows.reverse();
  if (plan.palco === 'indefinido') warnings.push('Não deu para saber se o palco fica em cima ou embaixo da planta. Confira a ordem das fileiras e o palco.');
  if (rows.length && plan.palco !== 'indefinido') rows[rows.length - 1] = { ...rows[rows.length - 1], palco_apos: true };

  const total = rows.reduce((s, r) => s + r.assentos, 0);
  if (expectedTotal != null && expectedTotal !== total) {
    warnings.push(`A planta lida tem ${total} lugares, mas o total informado é ${expectedTotal}.`);
  }

  const sugestoes = (plan.sugestoes ?? []).filter(h => {
    const row = rows.find(r => r.codigo === h.codigo);
    return row != null && h.numero <= row.assentos;
  });

  return { rows, total, warnings, sugestoes };
}
