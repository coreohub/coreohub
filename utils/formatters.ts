import { supabase } from '../services/supabase';

/**
 * registrations.trilha_url vem em 2 formatos dependendo de quem enviou:
 *   - Inscrito via InscricaoWizard: salva só o PATH interno do bucket
 *     'trilhas' (ex: "userId/evento_123.mp3"), sem domínio.
 *   - Produtor via CentralDeMidia: salva a URL PÚBLICA completa (http...).
 * Todo consumidor (Schedule.tsx: play, ZIP, duração; CentralDeMidia player)
 * precisa resolver pro formato tocável — sem isso, o <audio>/fetch tenta
 * carregar o path relativo à página (ex: app.coreohub.com/userId/..mp3) e
 * falha silenciosamente. Bug real: coreografias com trilha enviada só pelo
 * inscrito (nunca reenviada pela Central de Mídia) não tocavam em produção.
 */
export const resolveTrilhaUrl = (pathOrUrl?: string | null): string => {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return supabase.storage.from('trilhas').getPublicUrl(pathOrUrl).data.publicUrl;
};

export const formatWhatsApp = (value: string) => {
  const nums = value.replace(/\D/g, '');
  if (nums.length <= 10) return nums.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return nums.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
};

/**
 * Formata WhatsApp do evento aceitando DDI (até 13 dígitos: 55 + DDD + 9 + 8).
 * Resultado:
 *   "+55 17 99877-6655" quando tem DDI
 *   "(17) 99877-6655"   quando só DDD + celular
 * Limita o input a 13 dígitos numéricos pra impedir excesso.
 */
export const formatEventWhatsApp = (value: string) => {
  const d = value.replace(/\D/g, '').slice(0, 13);
  if (d.length === 0) return '';
  // Com DDI (12-13 dígitos): "+55 17 99877-6655"
  if (d.length >= 12) {
    const tail = d.slice(9);
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}${tail ? '-' + tail : ''}`;
  }
  // 11 dígitos (DDD + celular): "(17) 99877-6655"
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  // 10 dígitos (fixo): "(17) 9877-6655"
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  // Digitação parcial — mantém legível
  if (d.length > 7) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
};

export const formatCPF = (value: string) => {
  const nums = value.replace(/\D/g, '');
  if (nums.length <= 11) {
    return nums
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return nums.substring(0, 11);
};

export const formatCNPJ = (value: string) => {
  const nums = value.replace(/\D/g, '');
  return nums
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$3')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

export const formatRG = (value: string) => {
  const cleaned = value.replace(/[^0-9xX]/g, '').toUpperCase();
  if (cleaned.length <= 9) {
    return cleaned
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$3')
      .replace(/(\d{3})([0-9X]{1,2})$/, '$1-$2');
  }
  return cleaned.substring(0, 9);
};

export const formatFullDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  return `${days[date.getDay()]}, ${date.getDate()}/${months[date.getMonth()]}/${date.getFullYear()}`;
};

/**
 * Nome do estúdio de uma inscrição. O Wizard atual grava esse dado em
 * `event_data.estudio_nome` (JSONB) — a coluna top-level `registrations.estudio`
 * fica vazia pra praticamente toda inscrição recente. Rows antigas/editadas
 * manualmente ainda podem ter a coluna preenchida, por isso ela vem primeiro.
 * Usada por Schedule.tsx e AccountSettings.tsx (Narração IA) — mantenha as
 * duas em sincronia se essa regra mudar.
 */
export const resolveEstudio = (reg: {
  estudio?: string | null;
  event_data?: { estudio_nome?: string | null } | null;
}): string => reg.estudio || reg.event_data?.estudio_nome || '';

/**
 * Remove o sufixo "e suas vertentes" do nome do estilo (ex: "Estilo Livre e
 * suas vertentes" → "Estilo Livre") — produtores cadastram estilos com esse
 * sufixo pra indicar subgêneros agrupados, mas ele não deve aparecer lido em
 * voz alta na narração nem na frase de locução do Cronograma.
 */
export const stripEstiloVertentes = (estilo?: string | null): string =>
  (estilo || '').replace(/\s+e\s+suas\s+vertentes\s*$/i, '').trim();

// Conectores PT-BR que ficam minúsculos em Title Case (exceto na 1ª palavra).
// Corrige exibições tipo "New Corpus escola de dança" → "New Corpus Escola de Dança".
const TITLE_CASE_LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export const toTitleCase = (value?: string | null): string => {
  if (!value) return '';
  return value
    .toLowerCase()
    .split(' ')
    .map((word, idx) => {
      if (!word) return word;
      if (idx > 0 && TITLE_CASE_LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};

/** Slug genérico: sem acento, sem espaço, sem maiúscula, só [a-z0-9-]. */
export const slugify = (value: string, fallback = 'item'): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;

/** Nome de arquivo seguro (sem acento, sem espaço, sem maiúscula) pra
 * `a.download` — nomes com "João"/"Conceição" viram %-encoded ou somem
 * silenciosamente em alguns SO/navegador quando usados crus no atributo. */
export const slugifyFilename = (value: string): string => slugify(value, 'certificado');

/**
 * Categoria é texto livre digitado pelo produtor por evento (ex: "Melhor
 * idade – a partir de 55 anos"). Pra caber numa coluna de tabela sem virar
 * bloco de texto, extrai o nome e comprime a faixa etária: "a partir de X
 * anos" → "X+" (convenção de mercado BR/IBGE, não "+X"), "de X a Y anos" →
 * "X-Y". Sem faixa numérica reconhecível (ex: "Mista - grupo de faixas
 * etárias variadas"), mostra só o nome — nunca o texto livre inteiro.
 * Usada junto com formato_participacao (Solo/Duo/Conjunto) pra formar a
 * "classe de disputa" no padrão brasileiro Formação + Categoria (ex: "Solo
 * Amador"), confirmado via regulamento real do Festival de Dança de
 * Joinville — o inverso do padrão americano "Category + Format".
 */
export const formatCategoriaAbbrev = (categoria?: string | null): string => {
  if (!categoria) return '';
  const m = categoria.match(/^(.*?)\s+[-–]\s*(.+)$/);
  const nome = toTitleCase((m ? m[1] : categoria).trim());
  const resto = (m ? m[2] : '').trim();
  if (!resto) return nome;

  const aPartir = resto.match(/a partir de\s*(\d+)/i);
  if (aPartir) return `${nome} ${aPartir[1]}+`;

  const faixa = resto.match(/de\s*(\d+)\s*a\s*(\d+)\s*anos/i);
  if (faixa) {
    const minutos = resto.match(/até\s*(\d+)\s*min/i);
    return minutos ? `${nome} ${faixa[1]}-${faixa[2]} · até ${minutos[1]}min` : `${nome} ${faixa[1]}-${faixa[2]}`;
  }

  return nome;
};

export const getInitials = (name?: string) => {
  if (!name || typeof name !== 'string' || name.trim() === '') return 'U';
  const filteredParts = name.trim().split(/\s+/).filter(p => p.length > 0);
  if (filteredParts.length === 0) return 'U';
  if (filteredParts.length === 1) return filteredParts[0].substring(0, 2).toUpperCase();
  return (filteredParts[0][0] + filteredParts[filteredParts.length - 1][0]).toUpperCase();
};
