// Busca de compradores nas telas de vendas (nome, e-mail, CPF, WhatsApp).
// Só compara dígitos quando a busca tem dígitos: antes, "Leila" virava '' e
// `cpf.includes('')` é sempre verdadeiro, então a busca por texto não filtrava nada.

export interface BuyerSearchFields {
  buyer_name?: string | null;
  buyer_email?: string | null;
  buyer_cpf?: string | null;
  buyer_phone?: string | null;
}

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

export function matchesBuyerSearch(row: BuyerSearchFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((row.buyer_name ?? '').toLowerCase().includes(q)) return true;
  if ((row.buyer_email ?? '').toLowerCase().includes(q)) return true;
  const digits = onlyDigits(q);
  if (!digits) return false;
  return onlyDigits(row.buyer_cpf).includes(digits) || onlyDigits(row.buyer_phone).includes(digits);
}
