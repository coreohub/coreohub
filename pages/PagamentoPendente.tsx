import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw, Home } from 'lucide-react';

const PagamentoPendente = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6 text-center">

        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
            <Clock size={48} className="text-amber-500" />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Aguardando Confirmação</p>
          <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-2 italic">
            Pagamento <span className="text-amber-500">Pendente</span>
          </h1>
          <p className="text-slate-500 mt-3 text-sm">
            Seu pagamento está sendo processado. Isso pode levar alguns instantes. Você receberá a confirmação assim que o pagamento for aprovado.
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4 text-left">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">O que pode estar acontecendo?</p>
          <ul className="text-xs text-amber-600 dark:text-amber-500 space-y-1 list-disc list-inside">
            <li>Pagamento via boleto aguardando compensação (até 3 dias úteis)</li>
            <li>Pagamento Pix em análise</li>
            <li>Análise de segurança do Mercado Pago</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => navigate('/pagamento')}
            className="w-full flex items-center justify-center gap-2 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all"
          >
            <RefreshCw size={16} /> Verificar Status
          </button>
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

export default PagamentoPendente;
