/**
 * Banner amarelo que aparece em telas internas quando o produtor está
 * num evento demo (events.is_demo = true).
 *
 * Pattern Stripe Test Mode: sempre visível pra evitar que produtor confunda
 * dados demo com dados reais. Não dismissível (research-backed).
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useNavigate } from 'react-router-dom';

const DemoBanner: React.FC = () => {
  const [isDemo, setIsDemo] = useState(false);
  const [eventName, setEventName] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: ev } = await supabase
          .from('events')
          .select('id, name, is_demo')
          .eq('created_by', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (alive && ev?.is_demo) {
          setIsDemo(true);
          setEventName(ev.name);
        }
      } catch { /* silencioso */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!isDemo) return null;

  return (
    <div className="bg-amber-100 dark:bg-amber-500/15 border-b-2 border-amber-300 dark:border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 truncate">
          <strong className="font-black uppercase tracking-widest text-[10px]">Modo Demonstração:</strong>{' '}
          <span className="hidden sm:inline">você está num evento de demonstração ({eventName}). Mudanças aqui não afetam dados reais.</span>
          <span className="sm:hidden">Evento de demonstração. Sem efeitos reais.</span>
        </p>
      </div>
      <button
        onClick={() => navigate('/account-settings')}
        className="shrink-0 text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2 transition-colors"
      >
        Gerenciar
      </button>
    </div>
  );
};

export default DemoBanner;
