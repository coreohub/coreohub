import { supabase } from './supabase';

const ORIGINAL_SESSION_KEY = 'coreohub_impersonate_original';
const IMPERSONATING_KEY = 'coreohub_impersonating';

export interface ImpersonationContext {
  target_id: string;
  target_email: string;
  target_name: string | null;
  target_role: string;
  started_at: string;
}

/** Inicia impersonate do target. Salva session original em localStorage,
    chama edge function pra obter token_hash, troca por session do target
    via verifyOtp. Após sucesso, recarregar a página é obrigatório pra
    todos os hooks/queries pegarem o novo auth.uid(). */
export async function startImpersonate(
  targetUserId: string,
): Promise<ImpersonationContext> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa pra impersonar.');

  const { data, error } = await supabase.functions.invoke('admin-impersonate', {
    body: { action: 'start', target_user_id: targetUserId },
  });
  if (error) throw new Error(error.message ?? 'Falha na edge function.');
  if (!data?.ok) {
    throw new Error(`Impersonate negado: ${data?.error ?? 'erro desconhecido'}`);
  }

  const { token_hash, target } = data as {
    token_hash: string;
    target: { id: string; email: string; full_name: string | null; role: string };
  };

  // Salva session original (admin) ANTES de trocar
  localStorage.setItem(
    ORIGINAL_SESSION_KEY,
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  );

  // Troca o hashed_token (gerado via admin.generateLink no backend) pelo
  // session do target. supabase-js v2 espera 'token_hash' (não 'token')
  // pra hash de magic link admin-generated. Formato com 'token' é só pra
  // OTP numérico de 6 dígitos enviado por email/SMS.
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash,
    type: 'magiclink',
  });
  if (verifyErr) {
    localStorage.removeItem(ORIGINAL_SESSION_KEY);
    throw verifyErr;
  }

  const ctx: ImpersonationContext = {
    target_id: target.id,
    target_email: target.email,
    target_name: target.full_name,
    target_role: target.role,
    started_at: new Date().toISOString(),
  };
  localStorage.setItem(IMPERSONATING_KEY, JSON.stringify(ctx));
  return ctx;
}

/** Restaura session do super admin original. Após sucesso, recarregar a
    página é obrigatório (igual ao start). */
export async function stopImpersonate(): Promise<void> {
  const raw = localStorage.getItem(ORIGINAL_SESSION_KEY);
  if (!raw) {
    // Sem session salva — força logout pra evitar estado inconsistente
    await supabase.auth.signOut();
    localStorage.removeItem(IMPERSONATING_KEY);
    return;
  }

  let original: { access_token: string; refresh_token: string };
  try {
    original = JSON.parse(raw);
  } catch {
    localStorage.removeItem(ORIGINAL_SESSION_KEY);
    localStorage.removeItem(IMPERSONATING_KEY);
    await supabase.auth.signOut();
    return;
  }

  const { error } = await supabase.auth.setSession(original);

  // Limpa flags antes de chamar audit log (caller já é admin agora)
  localStorage.removeItem(IMPERSONATING_KEY);
  localStorage.removeItem(ORIGINAL_SESSION_KEY);

  if (error) {
    // Refresh token expirou — força login novo
    await supabase.auth.signOut();
    throw error;
  }

  // Best-effort: fecha audit log (não bloqueia se falhar)
  try {
    await supabase.functions.invoke('admin-impersonate', {
      body: { action: 'stop' },
    });
  } catch (e) {
    console.error('[impersonate] falha ao fechar audit log:', e);
  }
}

export function getImpersonationContext(): ImpersonationContext | null {
  const raw = localStorage.getItem(IMPERSONATING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationContext;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return localStorage.getItem(IMPERSONATING_KEY) !== null;
}
