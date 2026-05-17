import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Music2, Calendar, ArrowRight, Home, Receipt } from 'lucide-react';
import { supabase } from '../services/supabase';
import AsaasBadge from '../components/AsaasBadge';
import { trackPurchase } from '../services/producerAnalytics';
import ProducerPixels from '../components/ProducerPixels';

interface DetalheInscricao {
  nome: string;
  formacao?: string | null;
  tipo_apresentacao?: string | null;
  event_id?: string | null;
  eventName?: string | null;
  /** Slug do evento — usado pra trackPurchase identificar o festival. */
  eventSlug?: string | null;
  /** GA4/Pixel do produtor — usados pra montar <ProducerPixels /> nesta tela. */
  producerGa4Id?: string | null;
  producerMetaPixelId?: string | null;
  /** Valor pago — captado de registrations.event_data.mod_fee ou similar. */
  paidValue?: number;
}

const PagamentoSucesso = () => {
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registration_id');
  const navigate = useNavigate();

  const [detalhe, setDetalhe]           = useState<DetalheInscricao | null>(null);
  const [pendentes, setPendentes]       = useState<number>(0);
  // Fase 4B — só dispara purchase quando pagamento confirmado E pixels prontos.
  // Validação de status evita conversões fantasma (user acessa URL antes de
  // pagar ou após estorno); pixelsReady evita race com o config do produtor.
  const [paymentApproved, setPaymentApproved] = useState(false);
  const [pixelsReady, setPixelsReady]         = useState(false);
  const [purchaseTracked, setPurchaseTracked] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // Detalhe da inscrição que acabou de pagar (se tiver id na URL).
      if (registrationId) {
        const { data: coreo } = await supabase
          .from('registrations')
          .select('event_id, tipo_apresentacao, nome:nome_coreografia, formacao:formato_participacao, event_data, status_pagamento')
          .eq('id', registrationId)
          .single();

        if (coreo) {
          let eventName: string | null = null;
          let eventSlug: string | null = null;
          let producerGa4Id: string | null = null;
          let producerMetaPixelId: string | null = null;
          if (coreo.event_id) {
            const { data: ev } = await supabase
              .from('events')
              .select('name, slug, producer_ga4_id, producer_meta_pixel_id')
              .eq('id', coreo.event_id)
              .single();
            eventName           = ev?.name ?? null;
            eventSlug           = (ev as any)?.slug ?? null;
            producerGa4Id       = (ev as any)?.producer_ga4_id ?? null;
            producerMetaPixelId = (ev as any)?.producer_meta_pixel_id ?? null;
          }
          const paidValue = Number((coreo as any).event_data?.mod_fee ?? 0) || 0;
          setDetalhe({
            ...coreo,
            eventName,
            eventSlug,
            producerGa4Id,
            producerMetaPixelId,
            paidValue,
          });
          // Marca aprovado só quando Asaas/webhook já confirmou. Mantém o resto
          // da página renderizando normalmente — só o tracking depende disso.
          if ((coreo as any).status_pagamento === 'APROVADO') {
            setPaymentApproved(true);
          }
        }
      }

      // Conta quantas outras inscrições ainda estão pendentes para esse usuário.
      if (user) {
        const { count } = await supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .neq('status_pagamento', 'APROVADO')
          .in('status', ['RASCUNHO', 'PRONTA', 'PRONTO', 'AGUARDANDO_PAGAMENTO']);

        setPendentes(count ?? 0);
      }
    };
    load();
  }, [registrationId]);

  // Fase 4B — dispara purchase quando: detalhe carregou, pagamento aprovado
  // (evita conversão fantasma), pixels prontos (evita race), e ainda não
  // tracked (evita duplicar se algum dep mudar). Endereça master + produtor
  // explicitamente pra não vazar pra pixel de outro festival na mesma sessão.
  useEffect(() => {
    if (!detalhe || !paymentApproved || !pixelsReady || purchaseTracked) return;
    if (!registrationId) return;
    trackPurchase(
      {
        transaction_id: registrationId,
        event_slug:     detalhe.eventSlug ?? detalhe.event_id ?? 'unknown',
        event_name:     detalhe.eventName ?? 'Festival',
        value:          detalhe.paidValue ?? 0,
      },
      {
        ga4:   detalhe.producerGa4Id,
        pixel: detalhe.producerMetaPixelId,
      },
    );
    setPurchaseTracked(true);
  }, [detalhe, paymentApproved, pixelsReady, purchaseTracked, registrationId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      {/* Pixels do produtor — só renderizam quando o detalhe carrega (precisa
          dos IDs reais). `onReady` libera o disparo do purchase no useEffect
          acima, garantindo que o stream do produtor já está configurado. */}
      {detalhe && (
        <ProducerPixels
          ga4Id={detalhe.producerGa4Id}
          metaPixelId={detalhe.producerMetaPixelId}
          onReady={() => setPixelsReady(true)}
        />
      )}
      <div className="max-w-md w-full space-y-6 text-center">

        {/* Ícone animado */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle size={48} className="text-emerald-500" />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Pagamento Confirmado</p>
          <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-2 italic">
            Inscrição <span className="text-emerald-500">Aprovada!</span>
          </h1>
          <p className="text-slate-500 mt-3 text-sm">
            Seu pagamento foi processado com sucesso. Você está inscrito no evento!
          </p>
        </div>

        {/* Detalhes da coreografia paga */}
        {detalhe && (
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 text-left space-y-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Detalhes da Inscrição</p>
            <div className="flex items-center gap-3">
              <Music2 size={16} className="text-[#ff0068] shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-slate-500">Coreografia</p>
                <p className="font-black text-sm text-slate-900 dark:text-white truncate">{detalhe.nome}</p>
                {(detalhe.tipo_apresentacao || detalhe.formacao) && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {detalhe.tipo_apresentacao || detalhe.formacao}
                  </p>
                )}
              </div>
            </div>
            {detalhe.eventName && (
              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-[#ff0068] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500">Evento</p>
                  <p className="font-black text-sm text-slate-900 dark:text-white truncate">{detalhe.eventName}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Se ainda houver pendentes, incentiva continuar */}
        {pendentes > 0 && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4 text-left flex items-start gap-3">
            <Receipt size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                Você ainda tem {pendentes} {pendentes === 1 ? 'inscrição pendente' : 'inscrições pendentes'}
              </p>
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
                Finalize os pagamentos para garantir todas as suas vagas.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {pendentes > 0 ? (
            <button
              onClick={() => navigate('/pagamento')}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
            >
              Pagar próxima inscrição <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={() => navigate('/minhas-coreografias')}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
            >
              Ver Minhas Inscrições <ArrowRight size={16} />
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center justify-center gap-2 py-3 border border-slate-200 dark:border-white/10 text-slate-500 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
          >
            <Home size={14} /> Ir para o Início
          </button>
        </div>

        {/* Selo BaaS Asaas — playbook pág. 3 exige em comprovantes de pagamento */}
        <div className="pt-4 flex justify-center">
          <AsaasBadge variant="compact" />
        </div>
      </div>
    </div>
  );
};

export default PagamentoSucesso;
