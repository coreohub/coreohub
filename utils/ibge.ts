/** Lista de UFs (ordem alfabética por sigla). */
export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const municipiosCache = new Map<string, string[]>();

/** Busca municípios de uma UF via API pública do IBGE, com cache em memória por sessão.
 *  Retorna [] em caso de falha (chamador deve cair pra texto livre, nunca travar o form). */
export async function fetchMunicipios(uf: string): Promise<string[]> {
  if (!uf) return [];
  const cached = municipiosCache.get(uf);
  if (cached) return cached;
  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    if (!res.ok) return [];
    const data = await res.json();
    const nomes: string[] = Array.isArray(data) ? data.map((m: any) => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')) : [];
    municipiosCache.set(uf, nomes);
    return nomes;
  } catch {
    return [];
  }
}
