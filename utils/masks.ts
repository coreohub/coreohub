/**
 * Máscaras de input pt-BR sem dependência externa.
 * Padrão Sympla/Pagar.me/Stripe BR: detecta o formato pelo length de dígitos
 * e formata progressivamente conforme o usuário digita.
 *
 * Cada `mask*` retorna a string formatada pra exibir no <input>.
 * Cada `parse*` extrai o valor "limpo" pra enviar ao backend.
 */

/** "12345678901" → "123.456.789-01" (CPF) ou "12345678000190" → "12.345.678/0001-90" (CNPJ).
 *  Detecta pelo length: ≤11 dígitos = CPF, >11 = CNPJ. */
export function maskCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  // CNPJ: 00.000.000/0000-00
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

/** Extrai só os dígitos (11 = CPF, 14 = CNPJ). */
export function unmaskCpfCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

/** "5000" → "R$ 50,00" · "500000" → "R$ 5.000,00".
 *  Trata o input como centavos pra UX tipo cartão de crédito —
 *  o usuário digita "5000" e vê "R$ 50,00" formando da direita pra esquerda. */
export function maskMoeda(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  const reais = cents / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(reais);
}

/** "R$ 5.000,00" → 5000 (number em reais). Retorna 0 se inválido. */
export function parseMoeda(masked: string): number {
  const digits = masked.replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

/** "01011990" → "01/01/1990". Limita a 8 dígitos. */
export function maskData(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

/** "01/01/1990" → "1990-01-01" (ISO pro backend). Retorna null se inválida. */
export function parseDataISO(masked: string): string | null {
  const m = masked.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = parseInt(dd, 10);
  const mo = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (y < 1900 || y > new Date().getFullYear()) return null;
  // Valida que a data existe (ex.: 31/02 não existe)
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Calcula idade em anos a partir de "1990-01-01". */
export function calcIdade(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const hoje = new Date();
  let idade = hoje.getFullYear() - y;
  const aniversarioPassou =
    hoje.getMonth() + 1 > m || (hoje.getMonth() + 1 === m && hoje.getDate() >= d);
  if (!aniversarioPassou) idade--;
  return idade;
}
