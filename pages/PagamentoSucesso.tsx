import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, Loader2, Music2, Calendar } from 'lucide-react';
import { supabase } from '../services/supabase';

const PagamentoSucesso = () => {
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registration_id');
  const navigate = useNavigate();
  const [registration, setRegistration] = useState<any>(null);

  useEffect(() => {
    if (!registrationId) return;
    const load = async () => {
      const { data } = await supabase
        .from('registrations')
        .select('choreography_name, modality, category, events(name, start_date)')
        .eq('id', registrationId)
        .single();
      setRegistration(data);
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

        {/* Detalhes da inscrição */}
        {registration && (
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 text-left space-y-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Detalhes da Inscrição</p>
            <div className="flex items-center gap-3">
              <Music2 size={16} className="text-[#ff0068] shrink-0" />
              <div>
                <p className="text-[10px] text-slate-500">Coreografia</p>
                <p className="font-black text-sm text-slate-900 dark:text-white">{registration.choreography_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar size={16} className="text-[#ff0068] shrink-0" />
              <div>
                <p className="text-[10px] text-slate-500">Evento</p>
                <p className="font-black text-sm text-slate-900 dark:text-white">{registration.events?.name}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => navigate('/minhas-coreografias')}
            className="w-full py-4 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            Ver Minhas Inscrições
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 border border-slate-200 dark:border-white/10 text-slate-500 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
          >
            Ir para o Início
          </button>
        </div>
      </div>
    </div>
  );
};

export default PagamentoSucesso;
