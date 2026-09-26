import React from 'react';
import { CalendarClock, CalendarX } from 'lucide-react';

/**
 * Faixa de sessão adiada/cancelada (Decreto 13.108/2026, arts. 20-22). Aparece na
 * vitrine, no checkout e na página do ingresso. Sessão "agendada" não renderiza
 * nada (é o estado normal, não um componente escondido).
 */
export interface SessionStatusInfo {
  sessao_status?: string | null;
  sessao_motivo?: string | null;
  sessao_data_original?: string | null;
  sessao_hora_original?: string | null;
}

/** "2026-12-20" (+ "19:30") -> "Dom, 20 de dezembro de 2026 · 19:30". */
export function formatSessaoDia(iso?: string | null, hora?: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', '');
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const h = hora && /^\d{1,2}:\d{2}/.test(hora) ? ` · ${hora.slice(0, 5)}` : '';
  return `${cap}, ${dia}${h}`;
}

interface Props extends SessionStatusInfo {
  /** Data/hora ATUAIS do evento (após adiamento = a nova). */
  dataAtual?: string | null;
  horaAtual?: string | null;
  /** 'ingresso' mostra a orientação de restituição/crédito para quem já comprou. */
  context?: 'vitrine' | 'checkout' | 'ingresso';
  /** 'light' pra usar sobre fundo branco (página do ingresso). */
  theme?: 'dark' | 'light';
  className?: string;
}

const SessionStatusBanner: React.FC<Props> = ({
  sessao_status, sessao_motivo, sessao_data_original, sessao_hora_original,
  dataAtual, horaAtual, context = 'vitrine', theme = 'dark', className = '',
}) => {
  if (sessao_status !== 'adiada' && sessao_status !== 'cancelada') return null;
  const cancelada = sessao_status === 'cancelada';
  const nova = formatSessaoDia(dataAtual, horaAtual);
  const antiga = formatSessaoDia(sessao_data_original, sessao_hora_original);

  return (
    <div
      role="alert"
      className={`rounded-2xl border p-4 flex items-start gap-3 text-sm ${
        theme === 'light'
          ? (cancelada ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-amber-50 border-amber-300 text-amber-900')
          : (cancelada ? 'bg-rose-500/10 border-rose-500/40 text-rose-200' : 'bg-amber-500/10 border-amber-500/40 text-amber-100')
      } ${className}`}
    >
      {cancelada ? <CalendarX size={20} className="shrink-0 mt-0.5" aria-hidden="true" /> : <CalendarClock size={20} className="shrink-0 mt-0.5" aria-hidden="true" />}
      <div className="space-y-1 min-w-0">
        <p className="font-black uppercase tracking-tight">
          {cancelada ? 'Sessão cancelada' : 'Sessão adiada'}
        </p>
        {!cancelada && nova && (
          <p>Nova data: <strong>{nova}</strong>{antiga && <span className="opacity-80"> (antes: {antiga})</span>}</p>
        )}
        {cancelada && nova && <p className="opacity-90">Era em {nova}.</p>}
        {sessao_motivo && <p className="opacity-90">Motivo informado pelo organizador: {sessao_motivo}</p>}
        {cancelada && context !== 'ingresso' && <p className="opacity-90">As vendas desta sessão estão encerradas.</p>}
        {context === 'ingresso' && (
          <p className="opacity-90">
            {cancelada
              ? 'Este ingresso não vale para entrada. Você tem direito à restituição integral, com as taxas, ou a crédito para outra sessão. Escolha logo abaixo.'
              : 'Seu ingresso continua valendo para a nova data. Você pode mantê-lo, converter em crédito para outra sessão ou pedir a restituição integral, com as taxas. Escolha logo abaixo.'}{' '}
            Dúvidas: <a href="mailto:contato@coreohub.com" className="underline font-bold">contato@coreohub.com</a>.
          </p>
        )}
      </div>
    </div>
  );
};

export default SessionStatusBanner;
