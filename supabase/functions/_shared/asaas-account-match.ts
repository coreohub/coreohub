// Recuperação de subconta Asaas duplicada. Módulo puro (sem Deno.*), testado no Vitest.
//
// Regra de segurança: a subconta só é do produtor se o CPF/CNPJ dela for o do
// solicitante. E-mail NÃO prova dono (o produtor pode digitar o e-mail de outra
// pessoa em "e-mail da conta de recebimento"), e o primeiro resultado da busca
// também não: vincular conta alheia mandaria o split pra carteira de um terceiro.

export type AsaasAccountLike = { id?: string; walletId?: string; cpfCnpj?: string | null; email?: string | null }

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

/** Devolve a conta cujo CPF/CNPJ bate exatamente com o do solicitante; senão null. */
export function pickRecoverableAccount<T extends AsaasAccountLike>(
  accounts: T[] | null | undefined,
  requesterCpfCnpj: string,
): T | null {
  const want = digits(requesterCpfCnpj)
  if (!want || !Array.isArray(accounts)) return null
  return accounts.find(a => !!a && !!a.id && digits(a.cpfCnpj) === want) ?? null
}
