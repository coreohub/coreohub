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
  corredor_apos?: number;
  espaco_antes?: boolean;
  palco_apos?: boolean;
}

const side = (row: RowConfig, n: number) => (row.corredor_apos != null && n > row.corredor_apos ? 1 : 0);
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
  const { tipos: _t, acompanhante: _a, ...rest } = row;
  return {
    ...rest,
    pcd,
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
