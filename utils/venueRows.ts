// Lógica do editor de Locais (Fase 3): tipos de assento e vizinho de acompanhante.
// Funções puras, testadas em tests/venue-rows.test.ts.

export type VenueSeatTipo = 'cadeirante' | 'pcd_largo';
export type VenuePaintTool = 'comum' | VenueSeatTipo | 'acompanhante';

export interface RowConfig {
  codigo: string;
  assentos: number;
  /** Legado: números de assento PCD/cadeirante. O editor mantém sincronizado com `tipos`. */
  pcd: number[];
  tipos?: Record<string, VenueSeatTipo>;
  /** Vizinho de acompanhante -> assento especial que ele acompanha. */
  acompanhante?: Record<string, number>;
  /** Legado: 1 corredor. Locais salvos antes dos corredores múltiplos só têm este campo. */
  corredor_apos?: number;
  /** Corredores pelo NÚMERO do assento (um corredor entre n e n+1). Vence `corredor_apos` quando presente. */
  corredores_apos?: number[];
  /** Só desenho: numeração da direita para a esquerda. O número do assento não muda. */
  espelhado?: boolean;
  /** Só desenho: fileira curta alinhada à esquerda em vez de centralizada (padrão). */
  alinhamento?: 'esquerda';
  espaco_antes?: boolean;
  palco_apos?: boolean;
}

/** Parte da fileira que o desenho do corredor e do espelhamento precisa (compartilhada com SeatRow). */
export interface RowLayout {
  assentos: number;
  corredor_apos?: number;
  corredores_apos?: number[];
  espelhado?: boolean;
}

/** Corredores da fileira, ordenados e sem repetição. Cobre o campo legado `corredor_apos`. */
export function corredoresOf(row: Pick<RowLayout, 'corredor_apos' | 'corredores_apos'>): number[] {
  const raw = row.corredores_apos ?? (row.corredor_apos != null ? [row.corredor_apos] : []);
  return [...new Set(raw.filter(c => Number.isFinite(c)))].sort((a, b) => a - b);
}

/** Lado (bloco) do assento: quantos corredores ficam antes dele. Mesmo valor = mesmo lado. */
export const seatSide = (row: Pick<RowLayout, 'corredor_apos' | 'corredores_apos'>, n: number) =>
  corredoresOf(row).filter(c => n > c).length;

/** Números dos assentos na ordem em que aparecem na tela (invertida quando espelhado). */
export function displayOrder(row: Pick<RowLayout, 'assentos' | 'espelhado'>): number[] {
  const nums = Array.from({ length: Math.max(0, row.assentos) }, (_, i) => i + 1);
  return row.espelhado ? nums.reverse() : nums;
}

/** Lê "6, 18" (vírgula, ponto e vírgula ou espaço) em lista de corredores válidos. */
export function parseCorredores(text: string): number[] {
  return [...new Set(text.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);
}

const side = seatSide;
const key = (n: number) => String(n);

/** Migra o campo legado `pcd` para `tipos` (cadeirante) sem perder nada. */
export function normalizeRow(row: RowConfig): RowConfig {
  const tipos: Record<string, VenueSeatTipo> = { ...(row.tipos ?? {}) };
  for (const n of row.pcd ?? []) if (!tipos[key(n)]) tipos[key(n)] = 'cadeirante';
  return { ...row, tipos, acompanhante: { ...(row.acompanhante ?? {}) } };
}

/** Formato gravado no banco: só chaves válidas, `pcd` legado derivado, sem objetos vazios. */
export function serializeRow(row: RowConfig): RowConfig {
  const tipos: Record<string, VenueSeatTipo> = {};
  for (const [k, v] of Object.entries(row.tipos ?? {})) {
    if (Number(k) >= 1 && Number(k) <= row.assentos) tipos[k] = v;
  }
  const acompanhante: Record<string, number> = {};
  for (const [k, esp] of Object.entries(row.acompanhante ?? {})) {
    if (Number(k) >= 1 && Number(k) <= row.assentos && tipos[key(esp)] && !tipos[k]) acompanhante[k] = esp;
  }
  const pcd = Object.entries(tipos).filter(([, v]) => v === 'cadeirante').map(([k]) => Number(k)).sort((a, b) => a - b);
  const { tipos: _t, acompanhante: _a, corredor_apos: _c, corredores_apos: _cs, espelhado, alinhamento, ...rest } = row;
  // 0 ou 1 corredor continua no formato legado (locais já salvos não mudam); 2+ grava a lista
  // e mantém `corredor_apos` com o primeiro para clientes em cache.
  const corredores = corredoresOf(row).filter(c => c >= 1 && c < row.assentos);
  return {
    ...rest,
    pcd,
    ...(corredores.length ? { corredor_apos: corredores[0] } : {}),
    ...(corredores.length > 1 ? { corredores_apos: corredores } : {}),
    ...(espelhado ? { espelhado: true } : {}),
    ...(alinhamento ? { alinhamento } : {}),
    ...(Object.keys(tipos).length ? { tipos } : {}),
    ...(Object.keys(acompanhante).length ? { acompanhante } : {}),
  };
}

const isCompanion = (row: RowConfig, n: number) => (row.acompanhante ?? {})[key(n)] != null;
const companionOfSpecial = (row: RowConfig, esp: number) =>
  Object.entries(row.acompanhante ?? {}).find(([, v]) => v === esp)?.[0];

/** Vizinho sugerido para um assento especial: o comum livre mais próximo do mesmo lado do corredor (esquerda primeiro). */
export function suggestCompanion(row: RowConfig, n: number): number | null {
  for (const c of [n - 1, n + 1]) {
    if (c < 1 || c > row.assentos) continue;
    if (side(row, c) !== side(row, n)) continue;
    if ((row.tipos ?? {})[key(c)]) continue;
    if (isCompanion(row, c)) continue;
    return c;
  }
  return null;
}

/** Aplica a ferramenta de pintura num assento. Erro = mensagem para o produtor, fileira intacta. */
export function paintSeat(rowIn: RowConfig, n: number, tool: VenuePaintTool): { row: RowConfig; error?: string } {
  const row = normalizeRow(rowIn);
  const tipos = { ...row.tipos! };
  const acomp = { ...row.acompanhante! };
  const done = (): { row: RowConfig } => ({ row: { ...row, tipos, acompanhante: acomp } });

  if (tool === 'comum') {
    const wasSpecial = !!tipos[key(n)];
    delete tipos[key(n)];
    delete acomp[key(n)];
    if (wasSpecial) for (const [k, v] of Object.entries(acomp)) if (v === n) delete acomp[k];
    return done();
  }

  if (tool === 'acompanhante') {
    if (tipos[key(n)]) return { row: rowIn, error: 'Este lugar é PCD/cadeirante. Escolha um lugar comum ao lado dele.' };
    if (acomp[key(n)] != null) { delete acomp[key(n)]; return done(); } // clicar de novo desfaz
    for (const sp of [n - 1, n + 1]) {
      if (sp < 1 || sp > row.assentos || side(row, sp) !== side(row, n) || !tipos[key(sp)]) continue;
      if (companionOfSpecial(row, sp) != null) continue;
      acomp[key(n)] = sp;
      return done();
    }
    return { row: rowIn, error: 'Marque como acompanhante um lugar comum ao lado de um lugar PCD que ainda não tem acompanhante.' };
  }

  // cadeirante / pcd_largo
  delete acomp[key(n)]; // se era acompanhante, deixa de ser
  tipos[key(n)] = tool;
  const next = { ...row, tipos, acompanhante: acomp };
  if (companionOfSpecial(next, n) == null) {
    const sug = suggestCompanion(next, n);
    if (sug != null) acomp[key(sug)] = n;
  }
  return done();
}

export function countTipos(rows: RowConfig[]): { cadeirante: number; pcd_largo: number; acompanhante: number } {
  let cadeirante = 0, pcd_largo = 0, acompanhante = 0;
  for (const r of rows.map(normalizeRow)) {
    for (const v of Object.values(r.tipos ?? {})) { if (v === 'cadeirante') cadeirante++; else pcd_largo++; }
    acompanhante += Object.keys(r.acompanhante ?? {}).length;
  }
  return { cadeirante, pcd_largo, acompanhante };
}

/** Ids de assento ("C-7") que a grade gera. É o mesmo formato de event_seats.seat_id. */
export function seatIdsOf(rows: Pick<RowConfig, 'codigo' | 'assentos'>[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) for (let n = 1; n <= Math.max(0, r.assentos); n++) ids.add(`${r.codigo}-${n}`);
  return ids;
}

/**
 * O que mudar de uma grade para outra faz nos eventos já ligados ao local:
 * generate_event_seats só ACRESCENTA assentos, nunca remove. Então `criados` entram e
 * `removidos` ficam no evento mesmo deixando de existir na planta.
 */
export function diffSeatIds(
  before: Pick<RowConfig, 'codigo' | 'assentos'>[],
  after: Pick<RowConfig, 'codigo' | 'assentos'>[],
): { criados: number; removidos: number } {
  const a = seatIdsOf(before);
  const b = seatIdsOf(after);
  let criados = 0, removidos = 0;
  for (const id of b) if (!a.has(id)) criados++;
  for (const id of a) if (!b.has(id)) removidos++;
  return { criados, removidos };
}

/**
 * Valores iniciais do gerador de grade a partir da grade já salva. Sem isso o gerador abre com
 * os padrões (20 lugares, sem corredor) e um clique em "Gerar prévia" apaga a planta real.
 */
export function generatorDefaultsFrom(rows: RowConfig[]): {
  assentosPadrao: number; corredores: number[]; espelhado: boolean; nomenclatura: 'letras' | 'numeros';
} {
  if (rows.length === 0) return { assentosPadrao: 20, corredores: [], espelhado: false, nomenclatura: 'letras' };
  const freq = new Map<number, number>();
  for (const r of rows) freq.set(r.assentos, (freq.get(r.assentos) ?? 0) + 1);
  let assentosPadrao = rows[0].assentos;
  let best = 0;
  for (const [n, c] of freq) if (c > best || (c === best && n > assentosPadrao)) { best = c; assentosPadrao = n; }
  const ref = rows.find(r => r.assentos === assentosPadrao) ?? rows[0];
  return {
    assentosPadrao,
    corredores: corredoresOf(ref),
    espelhado: rows.every(r => r.espelhado),
    nomenclatura: rows.every(r => /^\d+$/.test(r.codigo)) ? 'numeros' : 'letras',
  };
}
