import React, { useState, useEffect } from 'react';
import { Ticket, ExternalLink, Info, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';

const Ingressos = () => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase.from('configuracoes').select('url_ingressos').eq('id', 1).single();
        if (data?.url_ingressos) setUrl(data.url_ingressos);
      } catch (err) {
        console.error('Erro ao buscar URL de ingressos:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[#ff0068] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
          Garanta seu <span className="text-[#ff0068]">Ingresso</span>
        </h1>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Acesso ao Festival Dance Pró</p>
      </div>

      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-[2.5rem] p-8 lg:p-12 shadow-xl shadow-slate-200/50 dark:shadow-none relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#ff0068]/5 blur-[80px] rounded-full -mr-32 -mt-32 group-hover:bg-[#ff0068]/10 transition-all duration-700" />

        <div className="relative z-10 flex flex-col items-center text-center space-y-6">
          <div className="w-20 h-20 bg-[#ff0068]/10 rounded-3xl flex items-center justify-center text-[#ff0068] shadow-inner">
            <Ticket size={40} strokeWidth={1.5} />
          </div>

          <div className="space-y-3 max-w-md">
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Vendas Oficiais via Sympla</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
              Para sua segurança e comodidade, as vendas de ingressos para o festival são realizadas exclusivamente através da nossa ticketeira oficial.
            </p>
          </div>

          <div className="w-full pt-4">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#ff0068] text-white py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-[#ff0068]/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                Ir para o Sympla <ExternalLink size={16} />
              </a>
            ) : (
              <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-2xl border border-dashed border-slate-300 dark:border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vendas ainda não iniciadas</p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 text-left">
            <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[9px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-widest leading-relaxed">
              Crianças até 5 anos não pagam. Estudantes e idosos possuem direito a meia-entrada mediante apresentação de documento.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Ingressos;
