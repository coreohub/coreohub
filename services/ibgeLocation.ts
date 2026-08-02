/** Estados e municípios do Brasil via API pública do IBGE — usado pro
 *  seletor Cidade/Estado em Configurações → Geral (antes era texto livre,
 *  o que gerava divergência de digitação e quebrava o split por vírgula
 *  que popula events.city/events.state). Sem autenticação, gratuita.
 *  Cache em memória de módulo — a lista de UFs e cada lista de cidades por
 *  UF só é buscada 1x por sessão do app. */

export interface UfOption { sigla: string; nome: string; }

let ufCache: UfOption[] | null = null;
let ufCachePromise: Promise<UfOption[]> | null = null;
const cityCache: Record<string, string[]> = {};
const cityCachePromise: Record<string, Promise<string[]>> = {};

export async function fetchUfList(): Promise<UfOption[]> {
  if (ufCache) return ufCache;
  if (!ufCachePromise) {
    ufCachePromise = fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome')
      .then(r => {
        if (!r.ok) throw new Error(`IBGE estados respondeu ${r.status}`);
        return r.json();
      })
      .then((data: Array<{ sigla: string; nome: string }>) => {
        ufCache = data.map(d => ({ sigla: d.sigla, nome: d.nome }));
        return ufCache;
      })
      .catch(err => { ufCachePromise = null; throw err; });
  }
  return ufCachePromise;
}

export async function fetchCitiesByUf(uf: string): Promise<string[]> {
  const key = uf.trim().toUpperCase();
  if (!key) return [];
  if (cityCache[key]) return cityCache[key];
  if (!cityCachePromise[key]) {
    cityCachePromise[key] = fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${key}/municipios`)
      .then(r => {
        if (!r.ok) throw new Error(`IBGE municípios respondeu ${r.status}`);
        return r.json();
      })
      .then((data: Array<{ nome: string }>) => {
        const names = data.map(d => d.nome);
        cityCache[key] = names;
        return names;
      })
      .catch(err => { delete cityCachePromise[key]; throw err; });
  }
  return cityCachePromise[key];
}

/** Tenta separar um valor livre "Cidade, UF" / "Cidade - UF" / "Cidade/UF"
 *  em partes — usado só pra pré-preencher os selects a partir de configs
 *  antigas salvas como texto livre antes dessa feature existir. */
export function parseCityUf(raw: string): { city: string; uf: string } {
  const trimmed = (raw || '').trim();
  const m = trimmed.match(/^(.*?)[\s,\-/]+([A-Za-z]{2})$/);
  if (!m) return { city: trimmed, uf: '' };
  return { city: m[1].trim(), uf: m[2].toUpperCase() };
}
