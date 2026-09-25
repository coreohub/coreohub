import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export interface PendingPlanFeeEvent {
  id: string;
  name: string;
  billing_plan: 'essencial' | 'escala';
  /** Fim da tolerância pra pagar (events.billing_plan_fee_due_at). */
  lockAt: number;
  /** Já passou do prazo → o painel trava (PlanFeeGateModal). */
  locked: boolean;
  /** Vendas fechadas AGORA. Espelha a RPC plan_fee_sales_blocked (fonte de
   *  verdade, no servidor) só pra texto do aviso — a trava real não depende disto. */
  salesClosed: boolean;
}

/** Mesma tolerância de create-plan-fixed-fee-payment (GRACE_DAYS). Só é usada
 *  como fallback pra evento pendente sem billing_plan_fee_due_at. */
export const PLAN_FEE_GRACE_DAYS = 7;
/** Corte do fluxo novo — mesmo valor da migration 20260925b. */
const NEW_FLOW_CUTOFF = new Date('2026-09-25T10:00:00-03:00').getTime();

export const PLAN_FIXED_FEE: Record<string, number> = { essencial: 250, escala: 1490 };
export const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', escala: 'Escala' };

/**
 * Eventos do produtor com a taxa fixa do plano (Essencial/Escala) ainda pendente.
 * Reconsulta a cada `pollMs` pra destravar/atualizar sozinho quando o webhook
 * grava billing_plan_fixed_fee_paid_at.
 */
export function usePlanFeePending(producerId: string | undefined, pollMs = 6000) {
  const [pending, setPending] = useState<PendingPlanFeeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchPending = useCallback(async (): Promise<PendingPlanFeeEvent[] | null> => {
    if (!producerId) return [];
    const { data, error } = await supabase
      .from('events')
      .select('id, name, billing_plan, billing_plan_set_at, billing_plan_fee_due_at')
      .eq('created_by', producerId)
      .eq('is_demo', false)
      .in('billing_plan', ['essencial', 'escala'])
      .is('billing_plan_fixed_fee_paid_at', null);
    if (error) {
      console.error('[usePlanFeePending] erro ao consultar eventos pendentes:', error);
      return null;
    }
    const now = Date.now();
    return (data ?? [])
      .map((ev: any) => {
        const setAt = ev.billing_plan_set_at ? new Date(ev.billing_plan_set_at).getTime() : null;
        const dueAt = ev.billing_plan_fee_due_at ? new Date(ev.billing_plan_fee_due_at).getTime() : null;
        const lockAt = dueAt
          ?? (setAt !== null ? setAt + PLAN_FEE_GRACE_DAYS * 86_400_000 : Number.POSITIVE_INFINITY); // sem data nenhuma: nunca trava por engano
        const locked = lockAt <= now;
        const salesClosed = locked || (dueAt !== null && setAt !== null && setAt >= NEW_FLOW_CUTOFF);
        return { id: ev.id, name: ev.name, billing_plan: ev.billing_plan, lockAt, locked, salesClosed } as PendingPlanFeeEvent;
      })
      .sort((a, b) => a.lockAt - b.lockAt);
  }, [producerId]);

  useEffect(() => {
    if (!producerId) { setLoaded(true); return; }
    let cancelled = false;
    const run = async () => {
      const list = await fetchPending();
      if (cancelled) return;
      if (list) setPending(list);
      setLoaded(true);
    };
    run();
    const t = setInterval(run, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [producerId, fetchPending, pollMs]);

  return { pending, loaded };
}

/**
 * "Pagar agora": chama create-plan-fixed-fee-payment (idempotente — devolve a
 * fatura em aberto ou gera outra se a anterior venceu) e abre a fatura numa
 * aba nova. Abre a aba ANTES do await: popup aberto depois de chamada
 * assíncrona costuma ser bloqueado pelo navegador (perde o "gesto do usuário").
 * Lança Error com mensagem pronta pra mostrar ao produtor.
 */
export async function openPlanFeeInvoice(eventId: string, plano: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const { data, error } = await supabase.functions.invoke('create-plan-fixed-fee-payment', {
      body: { event_id: eventId, plano },
    });
    if (error || data?.error || !data?.invoice_url) {
      // A edge devolve o motivo real no corpo (status 400 + { error }); o
      // supabase-js só expõe uma frase genérica em inglês em error.message.
      let serverMsg: string | undefined = data?.error;
      if (!serverMsg && (error as any)?.context?.json) {
        try { serverMsg = (await (error as any).context.json())?.error; } catch { /* corpo não-JSON */ }
      }
      throw new Error(serverMsg ?? 'Não foi possível abrir a fatura agora. Tente de novo em instantes ou fale com o suporte.');
    }
    if (win) {
      win.opener = null;
      win.location.href = data.invoice_url;
    } else {
      window.location.href = data.invoice_url;
    }
  } catch (e: any) {
    win?.close();
    throw new Error(
      e?.message && !/Edge Function/i.test(e.message)
        ? e.message
        : 'Não foi possível abrir a fatura agora. Tente de novo em instantes ou fale com o suporte.',
    );
  }
}
