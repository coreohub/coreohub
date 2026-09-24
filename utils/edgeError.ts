/**
 * Erro real de uma Edge Function.
 *
 * `supabase.functions.invoke` devolve, em resposta não-2xx, um FunctionsHttpError
 * cuja `message` é sempre o genérico "Edge Function returned a non-2xx status code".
 * O que o servidor mandou está no corpo da resposta (`error.context`, um Response)
 * — padrão oficial do supabase-js. Aqui lemos esse corpo.
 */

/** Corpo JSON da resposta de erro, ou null se não houver/legível. */
export async function edgeErrorBody(err: unknown): Promise<Record<string, any> | null> {
  try {
    const ctx = (err as { context?: unknown } | null)?.context;
    if (ctx && typeof (ctx as Response).clone === 'function') {
      const body = await (ctx as Response).clone().json();
      if (body && typeof body === 'object') return body as Record<string, any>;
    }
  } catch {
    /* corpo não era JSON */
  }
  return null;
}

/** Mensagem legível (`error`/`message`/`detail` do corpo) ou o fallback. */
export async function edgeErrorMessage(err: unknown, fallback: string): Promise<string> {
  const body = await edgeErrorBody(err);
  if (body) {
    for (const key of ['error', 'message', 'detail']) {
      const v = body[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  const msg = (err as { message?: string } | null)?.message;
  return msg && !/non-2xx status code/i.test(msg) ? msg : fallback;
}
