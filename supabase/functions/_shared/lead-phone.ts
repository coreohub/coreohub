// WhatsApp do lead da calculadora. Mesmas regras de utils/masks.ts: número de
// outro país volta com "+"; brasileiro volta só com DDD + número, sem o 55.
// null = inválido (ex.: cortado).
export function normalizeLeadPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  let digits = value.replace(/\D/g, '')
  if (value.startsWith('+') && !digits.startsWith('55')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  digits = digits.replace(/^0+/, '')
  if (digits.startsWith('55') && (value.startsWith('+') || digits.length >= 12)) {
    digits = digits.slice(2).replace(/^0+/, '')
  }
  return /^[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(digits) ? digits : null
}
