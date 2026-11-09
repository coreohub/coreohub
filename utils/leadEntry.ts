import { supabase } from '../services/supabase';

/**
 * Evento de origem do cadastro (profiles.entry_event_id).
 *
 * Por que existe: a captura ficava só na tela de login e exigia conta com menos
 * de 10 min. Quem confirma o e-mail (link vai direto pra página do evento, sem
 * passar pelo login) ou demora a confirmar nunca era gravado — a partir de
 * 13/10/2026 nenhum cadastro novo ficou com o evento de origem, e o Início do
 * inscrito não sabia de qual festival a pessoa veio (caso real Compete'art,
 * 2026-11-09). Agora o evento é lembrado ao ver a página/inscrição do evento e
 * gravado assim que há sessão, em qualquer tela.
 *
 * Regras: só grava com `entry_event_id IS NULL` (nunca sobrescreve) e só pra
 * conta criada há no máximo 7 dias (não rotula usuário antigo que só passou por
 * uma vitrine). Best-effort: nunca bloqueia auth.
 */
const KEY = 'coreohub_lead_entry_event_id';
const AT = 'coreohub_lead_entry_at';
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const clear = () => {
  try { localStorage.removeItem(KEY); localStorage.removeItem(AT); } catch { /* sem storage */ }
};

export const rememberEntryEvent = (eventId?: string | null): void => {
  if (!eventId) return;
  try {
    localStorage.setItem(KEY, eventId);
    localStorage.setItem(AT, String(Date.now()));
  } catch { /* localStorage off — ignora */ }
};

export const claimEntryEvent = async (userId: string, userCreatedAtIso?: string | null): Promise<void> => {
  try {
    const eventId = localStorage.getItem(KEY);
    if (!eventId) return;

    const rememberedAt = Number(localStorage.getItem(AT) ?? 0);
    if (!rememberedAt || Date.now() - rememberedAt > WINDOW_MS) { clear(); return; }
    if (userCreatedAtIso && Date.now() - new Date(userCreatedAtIso).getTime() > WINDOW_MS) { clear(); return; }

    const { error } = await supabase
      .from('profiles')
      .update({ entry_event_id: eventId })
      .eq('id', userId)
      .is('entry_event_id', null);
    if (error) { console.error('[leadEntry] não gravou entry_event_id:', error.message); return; } // mantém a chave pra tentar de novo
    clear();
  } catch (e: any) {
    console.error('[leadEntry]', e?.message ?? e);
  }
};
