import React from 'react';
import { MessageCircle } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

interface Props {
  /** Número do WhatsApp do evento (events.whatsapp_event). Sem número, não renderiza. */
  whatsapp: string | null | undefined;
  eventName: string;
  /** Onde o botão está: 'login' ou 'inscricao_passo_N'. Vai na mensagem e no analytics. */
  origem: string;
  className?: string;
}

const ORIGEM_LABEL = (origem: string) => {
  if (origem === 'login') return 'entrar (login)';
  const m = origem.match(/^inscricao_passo_(\d)$/);
  return m ? `inscrição, passo ${m[1]}` : 'inscrição';
};

/**
 * Ajuda por WhatsApp da organização do evento. Só é montado por telas de
 * eventos com easy_login_enabled = true (hoje só a Tamoios).
 */
const HelpWhatsappButton: React.FC<Props> = ({ whatsapp, eventName, origem, className }) => {
  const digits = (whatsapp ?? '').replace(/\D/g, '');
  if (!digits) return null;

  const text = `Oi! Preciso de ajuda para me inscrever na ${eventName.trim()}. Estou na tela: ${ORIGEM_LABEL(origem)}.`;
  const href = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent('help_whatsapp_click', { event_name: eventName, origem })}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-500/20 ${className ?? ''}`}
    >
      <MessageCircle size={16} />
      Precisa de ajuda? Fale no WhatsApp
    </a>
  );
};

export default HelpWhatsappButton;
