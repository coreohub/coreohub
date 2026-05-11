/**
 * Máscaras + validações de input pt-BR sem dependência externa.
 * Padrão Sympla/Pagar.me/Stripe BR: detecta o formato pelo length de dígitos
 * e formata progressivamente conforme o usuário digita.
 *
 * Cada `mask*` retorna a string formatada pra exibir no <input>.
 * Cada `parse*` extrai o valor "limpo" pra enviar ao backend.
 * Cada `validate*` retorna boolean indicando se o documento é matematicamente válido.
 */
import type { ChangeEvent } from 'react';

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
 *  o usuário digita "5000" e vê "R$ 50,00" formando da direita pra esquerda.
 *  Limita a 12 dígitos (suficiente pra R$ 9.999.999.999,99). */
export function maskMoeda(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12);
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

/** 1234.56 → "1.234,56" (sem prefixo R$, pra usar em inputs com prefixo separado).
 *  Usado em campos onde o user digita preço fixo (não centavos progressivos). */
export function formatPrecoBR(num: number): string {
  if (!num || isNaN(num)) return '';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Parser tolerante: aceita "1.234,56", "1234,56", "1234.56", "1234" e converte
 *  pro número em reais. Útil em onBlur quando o user pode digitar livremente. */
export function parsePrecoBR(str: string): number {
  if (!str) return 0;
  // Remove tudo que não é dígito, ponto ou vírgula
  const cleaned = str.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return 0;
  // Se tem vírgula, ela é o separador decimal — remove pontos (milhar) e troca vírgula por ponto
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: assume ponto como decimal (formato US "1234.56") ou inteiro
    normalized = cleaned;
  }
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
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

/** Valida CPF pelo algoritmo dos 2 dígitos verificadores.
 *  Rejeita sequências repetidas (111.111.111-11) que passariam matematicamente. */
export function validateCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 111.111.111-11, 222.222.222-22, etc.

  const calc = (slice: string, weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + Number(slice[i]) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(cpf[9])) return false;
  const d2 = calc(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(cpf[10]);
}

/** Valida CNPJ pelo algoritmo dos 2 dígitos verificadores.
 *  Rejeita sequências repetidas (11.111.111/1111-11) que passariam matematicamente. */
export function validateCnpj(value: string): boolean {
  const cnpj = value.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (slice: string, weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + Number(slice[i]) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(cnpj[12])) return false;
  const d2 = calc(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(cnpj[13]);
}

/** Aplica máscara num input preservando a posição do cursor.
 *  Conta os dígitos antes do cursor no valor antigo e reposiciona no novo
 *  valor mascarado pro user não "perder o lugar" enquanto digita ou apaga.
 *  Padrão usado em apps como Nubank, PicPay, etc. */
export function maskedChange(
  e: ChangeEvent<HTMLInputElement>,
  maskFn: (s: string) => string,
  setValue: (v: string) => void,
): void {
  const input = e.target;
  const oldValue = input.value;
  const cursorPos = input.selectionStart ?? oldValue.length;
  const digitsBeforeCursor = oldValue.slice(0, cursorPos).replace(/\D/g, '').length;

  const newValue = maskFn(oldValue);
  setValue(newValue);

  // Restaura cursor depois do React re-renderizar
  requestAnimationFrame(() => {
    if (document.activeElement !== input) return;
    let counted = 0;
    let newCursorPos = newValue.length;
    for (let i = 0; i < newValue.length; i++) {
      if (/\d/.test(newValue[i])) counted++;
      if (counted === digitsBeforeCursor) {
        newCursorPos = i + 1;
        break;
      }
    }
    input.setSelectionRange(newCursorPos, newCursorPos);
  });
}
