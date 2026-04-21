import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Music2, Calendar, ArrowRight, Home, Receipt } from 'lucide-react';
import { supabase } from '../services/supabase';

interface DetalheInscricao {
  nome: string;
  modalidade?: string | null;
  tipo_apresentacao?: string | null;
  event_id?: string | null;
  eventName?: string | null;
}

const PagamentoSucesso = () => {
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registration_id');
  const navigate = useNavigate();

  const [detalhe, setDetalhe]           = useState<DetalheInscricao | null>(null);
  const [pendentes, setPendentes]       = useState<number>(0);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // Detalhe da coreografia que acabou de pagar (se tiver id na URL).
      if (registrationId) {
        const { data: coreo } = await supabase
          .from('coreografias')
          .select('nome, modalidade, tipo_apresentacao, event_id')
          .eq('id', registrationId)
          .single();

        if (coreo) {
          let eventName: string | null = null;
          if (coreo.event_id) {
            const { data: ev } = await supabase
              .from('events')
              .select('name')
              .eq('id', coreo.event_id)
              .single();
            eventName = ev?.name ?? null;
          }
          setDetalhe({ ...coreo, eventName });
        }
      }

      // Conta quantas outras coreografias ainda estão pendentes para esse usuário.
      if (user) {
        const { count } = await supabase
          .from('coreografias')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .neq('status_pagamento', 'APROVADO')
          .in('status', ['RASCUNHO', 'PRONTA', 'PRONTO', 'AGUARDANDO_PAGAMENTO']);

        setPendentes(count ?? 0);
      }
    };
    load();
  }, [registrationId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
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
                {(detalhe.tipo_apresentacao || detalhe.modalidade) && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {detalhe.tipo_apresentacao || detalhe.modalidade}
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
      </div>
    </div>
  );
};

export default PagamentoSucesso;
