import React, { useState } from 'react';
import { Bell, CheckCircle2, CalendarClock } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';

interface Props {
  eventId: string;
  /** ISO (UTC) da abertura das vendas. */
  opensAt: string;
}

/** "Dom, 20 de dezembro de 2026 às 19:30" no fuso do Brasil (datas públicas sempre com dia da semana). */
export function formatOpensAt(iso: string): string {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(d);
  const diaFmt = dia.charAt(0).toUpperCase() + dia.slice(1).replace('.,', ',').replace(/^(\w{3})\./, '$1');
  return `${diaFmt} às ${hora}`;
}

/**
 * Vendas com abertura programada: mostra quando abrem e deixa o visitante pedir um aviso
 * por e-mail (lista opt-in, com consentimento explícito e link de saída no e-mail).
 */
const SalesOpenReminder: React.FC<Props> = ({ eventId, opensAt }) => {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (!consent) { setError('Marque a caixinha para receber o aviso por e-mail.'); return; }
    setSending(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke('subscribe-sales-open', {
        body: { event_id: eventId, email: email.trim(), consent: true },
      });
      if (fnErr) {
        setError(await edgeErrorMessage(fnErr, 'Não foi possível cadastrar agora. Tente de novo.'));
        return;
      }
      setDone(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <CalendarClock size={22} className="text-[#ff0068] shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">As vendas ainda não abriram</p>
          <p className="text-base font-black text-white mt-1">Abertura: {formatOpensAt(opensAt)}</p>
        </div>
      </div>

      {done ? (
        <p role="status" className="flex items-start gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
          Combinado. Vamos avisar por e-mail assim que as vendas abrirem.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <label htmlFor="sales-open-email" className="text-xs font-black text-slate-200 flex items-center gap-2">
            <Bell size={14} aria-hidden="true" /> Quer ser avisado quando abrir?
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="sales-open-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={ev => setEmail(ev.target.value)}
              placeholder="seu@email.com"
              className="flex-1 min-w-0 bg-black/30 border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#ff0068]"
            />
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="px-5 py-3 rounded-xl bg-[#ff0068] hover:bg-[#ff1a7d] text-white text-xs font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              {sending ? 'Enviando...' : 'Avise-me'}
            </button>
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={ev => setConsent(ev.target.checked)}
              className="mt-0.5 accent-[#ff0068]"
            />
            <span>Aceito receber 1 e-mail da CoreoHub avisando que as vendas deste evento abriram. Uso o e-mail só para isso e posso sair da lista pelo link do próprio e-mail.</span>
          </label>
          {error && <p role="alert" className="text-xs font-bold text-rose-400">{error}</p>}
        </form>
      )}
    </div>
  );
};

export default SalesOpenReminder;
