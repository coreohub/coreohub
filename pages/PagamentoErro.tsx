import React from 'react';
import { useNavigate } from 'react-router-dom';
import { XCircle, RefreshCw, ArrowLeft } from 'lucide-react';

const PagamentoErro = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6 text-center">

        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
            <XCircle size={48} className="text-red-500" />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Pagamento Recusado</p>
          <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-2 italic">
            Não foi <span className="text-red-500">desta vez</span>
          </h1>
          <p className="text-slate-500 mt-3 text-sm">
            Seu pagamento foi recusado. Sua inscrição continua salva — você pode tentar novamente com outro método de pagamento.
          </p>
        </div>

        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl p-4 text-left">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-400 mb-1">Possíveis motivos</p>
          <ul className="text-xs text-red-600 dark:text-red-500 space-y-1 list-disc list-inside">
            <li>Saldo insuficiente no cartão</li>
            <li>Cartão sem limite para compras online</li>
            <li>Dados do cartão incorretos</li>
            <li>Transação bloqueada pelo banco</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => navigate('/pagamento')}
            className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            <RefreshCw size={16} /> Tentar Novamente
          </button>
          <button
            onClick={() => navigate('/minhas-coreografias')}
            className="w-full flex items-center justify-center gap-2 py-3 border border-slate-200 dark:border-white/10 text-slate-500 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
          >
            <ArrowLeft size={14} /> Minhas Inscrições
          </button>
        </div>
      </div>
    </div>
  );
};

export default PagamentoErro;
