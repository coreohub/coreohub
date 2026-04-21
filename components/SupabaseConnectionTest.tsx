import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const SupabaseConnectionTest = () => {
  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [eventName, setEventName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('name')
          .limit(1)
          .maybeSingle();

        if (error) {
          setStatus('error');
          setErrorMessage(error.message);
          return;
        }

        setEventName(data ? `Evento: ${data.name}` : 'Conectado ao Supabase!');
        setStatus('connected');
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err.message);
      }
    };

    testConnection();
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className={`flex items-center gap-3 px-4 py-2 rounded-full shadow-2xl border backdrop-blur-md transition-all duration-500 ${
        status === 'connected' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' :
        status === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-600' :
        'bg-slate-900/10 border-slate-900/20 text-slate-600'
      }`}>
        {status === 'loading' ? <Loader2 size={16} className="animate-spin" /> :
         status === 'connected' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}

        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase tracking-widest leading-none mb-0.5">Supabase Status</span>
          <span className="text-[9px] font-bold opacity-80 truncate max-w-[250px]">
            {status === 'loading' ? 'Verificando...' : status === 'connected' ? eventName : `Erro: ${errorMessage}`}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SupabaseConnectionTest;
