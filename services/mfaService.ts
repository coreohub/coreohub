/**
 * MFA TOTP (Time-based One-Time Password) — wrapper sobre supabase.auth.mfa.
 *
 * Usado pelo gate de /super-admin pra forçar 2FA antes de acessar dados
 * sensíveis (comissões, tokens CAPI, impersonate de produtor, etc).
 *
 * Fluxo:
 * - Enroll: user que ainda não tem fator TOTP cadastra usando app
 *   Authenticator (Google Auth/Authy/1Password/etc). Supabase retorna QR
 *   code + secret base32. User confirma com 6 dígitos pra ativar.
 * - Challenge: a cada login em surface protegida, pede 6 dígitos. Se OK,
 *   a sessão sobe pra AAL2 (Authenticator Assurance Level 2). RLS pode
 *   checar `auth.jwt() ->> 'aal' = 'aal2'` pra bloquear queries sensíveis.
 *
 * Recovery codes: Supabase NÃO gera códigos de recuperação nativos pra TOTP.
 * Se user perde o celular, super admin do banco (postgres) tem que deletar
 * o fator manualmente via SQL. Documentamos isso no enroll pra ele saber.
 */

import { supabase } from './supabase';

export interface MfaFactor {
  id:           string;
  factor_type:  'totp' | 'phone';
  friendly_name: string | null;
  status:       'unverified' | 'verified';
  created_at:   string;
}

export interface EnrollResult {
  factorId: string;
  /** Data URI do QR code pra exibir no <img>. */
  qrCode:   string;
  /** Secret base32 — caso user prefira digitar no app em vez de scan. */
  secret:   string;
  /** URI otpauth:// pra deep link em apps Authenticator. */
  uri:      string;
}

/** Lista fatores MFA do user atual. Vazio se nunca cadastrou. */
export async function listMfaFactors(): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  // listFactors retorna { all, totp, phone } — pegamos TOTP que é o que
  // suportamos. Filtro por verified pra ignorar enrolls abandonados.
  return (data?.totp ?? []) as unknown as MfaFactor[];
}

/** Tem fator TOTP verificado? Usado pra decidir se mostra enroll ou challenge. */
export async function hasVerifiedTotp(): Promise<boolean> {
  const factors = await listMfaFactors();
  return factors.some(f => f.status === 'verified');
}

/** Inicia enroll de um fator TOTP novo. Retorna QR + secret pra UI mostrar. */
export async function startTotpEnroll(friendlyName = 'CoreoHub Super Admin'): Promise<EnrollResult> {
  // Limpa fatores não verificados antigos pra não acumular lixo
  // (cada tentativa de enroll abandonada cria uma row em auth.mfa_factors).
  const existing = await listMfaFactors();
  for (const f of existing.filter(x => x.status === 'unverified')) {
    try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch { /* ignore */ }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType:   'totp',
    friendlyName,
  });
  if (error) throw error;
  if (!data) throw new Error('Resposta vazia do Supabase ao iniciar enroll.');
  return {
    factorId: data.id,
    qrCode:   data.totp.qr_code,
    secret:   data.totp.secret,
    uri:      data.totp.uri,
  };
}

/** Confirma o enroll com o código de 6 dígitos do app. Marca fator como verified. */
export async function verifyTotpEnroll(factorId: string, code: string): Promise<void> {
  // Verify do enroll precisa de um challenge intermediário
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  if (!ch?.id) throw new Error('Challenge sem ID');

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.id,
    code,
  });
  if (error) throw error;
}

/** Sessão atual está em AAL2 (passou pelo 2º fator)? */
export async function isAal2(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data?.currentLevel === 'aal2';
}

/** Desafio TOTP em sessão já logada (sobe AAL1 -> AAL2). Retorna challengeId. */
export async function createChallenge(factorId: string): Promise<string> {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  if (!data?.id) throw new Error('Challenge sem ID');
  return data.id;
}

/** Valida o código 6 dígitos do challenge. Sucesso → sessão vira AAL2. */
export async function verifyChallenge(factorId: string, challengeId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
  if (error) throw error;
}

/** Remove um fator TOTP (super admin que perdeu o celular contata suporte
 *  e o super admin do banco deleta via SQL, NÃO via este método pq ele
 *  exige sessão do próprio user). */
export async function unenrollFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
