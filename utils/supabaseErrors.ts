/**
 * Helper pra traduzir erros do PostgREST/Supabase em mensagens amigáveis pt-BR.
 *
 * Códigos comuns:
 *   - 42501: RLS violation (permissão negada)
 *   - 23505: unique_violation (duplicação)
 *   - 23503: foreign_key_violation (referência inválida)
 *   - 23502: not_null_violation (campo obrigatório vazio)
 *   - PGRST116: "Cannot coerce..." → .single() retornou 0 ou >1 rows
 *
 * Uso:
 *   try {
 *     const { error } = await supabase.from('x').update(y);
 *     if (error) throw error;
 *   } catch (e) {
 *     setError(humanizeSupabaseError(e));
 *   }
 */

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export function humanizeSupabaseError(error: unknown, contexto?: string): string {
  if (!error) return 'Erro desconhecido.';
  const e = error as SupabaseLikeError;
  const code = e.code ?? '';
  const message = e.message ?? String(error);

  // RLS — permissão negada
  if (code === '42501' || /row-level security|new row violates/i.test(message)) {
    return contexto
      ? `Você não tem permissão pra ${contexto}. Verifique se você é o dono do evento.`
      : 'Você não tem permissão pra executar essa ação.';
  }

  // .single() em query sem resultados (ou múltiplos)
  if (code === 'PGRST116' || /cannot coerce.*single json object/i.test(message)) {
    return contexto
      ? `${contexto[0].toUpperCase()}${contexto.slice(1)} não encontrado ou sem permissão pra editar.`
      : 'Item não encontrado ou sem permissão pra editar.';
  }

  // Duplicação
  if (code === '23505' || /duplicate key|already exists/i.test(message)) {
    if (/email/i.test(message)) return 'Este e-mail já está cadastrado.';
    if (/cpf/i.test(message))   return 'Este CPF já está cadastrado.';
    if (/slug/i.test(message))  return 'Esse identificador já está em uso. Escolha outro.';
    return 'Esse item já existe.';
  }

  // FK inválida
  if (code === '23503' || /foreign key/i.test(message)) {
    return 'Referência inválida — o item relacionado pode ter sido removido. Recarregue a página.';
  }

  // NOT NULL
  if (code === '23502' || /null value in column/i.test(message)) {
    return 'Preencha todos os campos obrigatórios antes de salvar.';
  }

  // Não autenticado
  if (/jwt|not authenticated|unauthorized/i.test(message)) {
    return 'Sessão expirada. Faça login novamente.';
  }

  // Network / 5xx
  if (/network|fetch failed|503|504/i.test(message)) {
    return 'Erro de conexão. Verifique sua internet e tente novamente.';
  }

  // Fallback: mostra a mensagem original (já é em inglês mas pelo menos não é genérica)
  return message;
}

/** Helper pra quando o caller só quer um Error com mensagem amigável. */
export function toFriendlyError(error: unknown, contexto?: string): Error {
  return new Error(humanizeSupabaseError(error, contexto));
}
