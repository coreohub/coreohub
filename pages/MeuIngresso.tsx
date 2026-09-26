/**
 * MeuIngresso — Página pública (sem login) que exibe o ingresso comprado.
 * Acessada por link no email pós-pagamento: /meu-ingresso/<access_token>
 *
 * Tier 1 paid tickets. Reaproveita layout de Credencial.tsx (QR + info).
 * Lookup via RPC `get_audience_ticket_by_token_v3` (security definer, mascara CPF/email).
 */

import React, { useEffect, useState } from 'react';
import { fetchSeatTipo, SEAT_TIPO_LABEL } from '../utils/seatTipo';
import type { SeatTipo } from '../utils/seatSelection';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Loader2, AlertCircle, Sun, Calendar, MapPin, ExternalLink, Download, Share2, ChevronLeft, ChevronRight, Users, Printer, Send } from 'lucide-react';
import { supabase } from '../services/supabase';
import InstallPWAButton from '../components/InstallPWAButton';
import AsaasBadge from '../components/AsaasBadge';
import SessionStatusBanner, { type SessionStatusInfo } from '../components/SessionStatusBanner';
import SessionChoicePanel from '../components/SessionChoicePanel';
import TransferTicketPanel from '../components/TransferTicketPanel';

interface Sibling {
  id: string;
  access_token: string;
  ticket_type_nome: string;
  status_pagamento: string;
  check_in_status: string;
  position: number;
  total: number;
}

interface Ticket {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string | null;
  event_start_date: string | null;
  event_end_date: string | null;
  event_time: string | null;
  event_location: string | null;
  event_city: string | null;
  event_uf: string | null;
  seat_id: string | null;
  event_cover_url: string | null;
  ticket_type_nome: string;
  ticket_type_kind: string;
  preco: number;
  buyer_name: string;
  buyer_email_masked: string;
  status_pagamento: string;
  payment_url: string | null;
  paid_at: string | null;
  check_in_status: string;
  check_in_at: string | null;
  access_token: string;
  created_at: string;
  qr_code: string | null;
  transfer_count: number;
  transferred_at: string | null;
}

const MeuIngresso: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);

  // Carga inicial + recarrega quando o token muda
  useEffect(() => {
    if (!token) { setError('Token não informado'); setLoading(false); return; }
    let active = true;
    const fetchTicket = async () => {
      const [{ data, error: rpcErr }, sibRes] = await Promise.all([
        supabase.rpc('get_audience_ticket_by_token_v3', { p_token: token }),
        supabase.rpc('get_audience_ticket_siblings', { p_token: token }),
      ]);
      if (!active) return;
      if (rpcErr) {
        console.error('[MeuIngresso] RPC erro:', rpcErr);
        setError('Ingresso não encontrado. Verifique o link recebido por email.');
        setLoading(false);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setError('Ingresso não encontrado. Verifique o link recebido por email.'); setLoading(false); return; }
      setTicket(row as Ticket);
      if (Array.isArray(sibRes.data)) setSiblings(sibRes.data as Sibling[]);
      setLoading(false);
    };
    fetchTicket();
    return () => { active = false; };
  }, [token]);

  // Polling pra atualizar status do pagamento + check-in sem F5.
  // Real-time via Supabase channel não funciona bem aqui (tabela protegida por
  // RLS, anon não recebe updates). Polling 5s enquanto pendente, 30s quando
  // aprovado (pra detectar check-in feito no portão).
  useEffect(() => {
    if (!token || !ticket) return;
    const isPendente = ticket.status_pagamento === 'PENDENTE';
    const isCheckedIn = ticket.check_in_status === 'OK';
    if (isCheckedIn) return; // estado terminal, para de pollar
    const interval = isPendente ? 5_000 : 30_000;
    const t = setInterval(async () => {
      // Re-fetch silencioso
      const { data } = await supabase.rpc('get_audience_ticket_by_token_v3', { p_token: token });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTicket(row as Ticket);
      else { setTicket(null); setError('Este link deixou de valer: o ingresso foi transferido para outro titular. Quem recebeu o ingresso tem o link novo.'); }
    }, interval);
    return () => clearInterval(t);
  }, [token, ticket]);

  // Wakelock pra tela ficar ligada quando exibindo QR
  useEffect(() => {
    let wakeLock: any = null;
    (async () => {
      try {
        if ('wakeLock' in navigator) wakeLock = await (navigator as any).wakeLock.request('screen');
      } catch { /* ignore */ }
    })();
    return () => { try { wakeLock?.release(); } catch { /* ignore */ } };
  }, []);

  // ─── Impressão (venda presencial): ?print=1 é o link aberto pelo operador
  // logo após confirmar uma venda no balcão (VendasIngressos.tsx). Dispara o
  // diálogo de impressão do navegador 1x quando o ingresso confirma como pago
  // — layout @media print abaixo esconde tudo que não serve pro papel.
  const autoPrinted = React.useRef(false);
  useEffect(() => {
    if (searchParams.get('print') !== '1') return;
    if (!ticket || ticket.status_pagamento !== 'APROVADO') return;
    if (autoPrinted.current) return;
    autoPrinted.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [searchParams, ticket]);

  // ─── Salvar imagem do QR (canvas → png download) ──────────────────────────
  const handleSaveImage = () => {
    const canvas = document.getElementById('ticket-qr') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `ingresso-${ticket?.event_name?.replace(/\s+/g, '-') ?? 'coreohub'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // ─── Compartilhar (Web Share API → fallback WhatsApp) ─────────────────────
  const handleShare = async () => {
    if (!ticket) return;
    const url = window.location.href;
    const text = `Meu ingresso pra ${ticket.event_name} — ${ticket.ticket_type_nome}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Meu ingresso CoreoHub', text, url });
        return;
      }
    } catch { /* user canceled — segue pra fallback se quiser */ }
    // Fallback: abre WhatsApp web/app com mensagem pré-preenchida
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  // ── Hooks SEMPRE antes dos return antecipados (loading/erro): mudar a ordem de hooks
  // entre renders derruba a página com "Rendered more hooks than during the previous render".
  // Sessão adiada/cancelada (Decreto 13.108 arts. 20-22): busca o status público do evento.
  const [sessionInfo, setSessionInfo] = useState<SessionStatusInfo | null>(null);
  useEffect(() => {
    if (!ticket?.event_id) return;
    let cancel = false;
    void supabase.rpc('get_event_session_status', { p_event_id: ticket.event_id }).then(({ data, error: sErr }) => {
      if (sErr) { console.warn('[MeuIngresso] get_event_session_status:', sErr.message); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!cancel && row) setSessionInfo(row as SessionStatusInfo);
    });
    return () => { cancel = true; };
  }, [ticket?.event_id]);

  // Tipo do assento (etiqueta PCD/acompanhante).
  const [seatTipo, setSeatTipo] = useState<SeatTipo>('comum');
  useEffect(() => {
    if (!ticket?.event_id || !ticket.seat_id) { setSeatTipo('comum'); return; }
    let cancel = false;
    void fetchSeatTipo(ticket.event_id, ticket.seat_id).then(t => { if (!cancel) setSeatTipo(t); });
    return () => { cancel = true; };
  }, [ticket?.event_id, ticket?.seat_id]);
  const seatTipoLabel = SEAT_TIPO_LABEL[seatTipo];

  if (transferredTo) {
    return (
      <div role="status" className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="inline-flex p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-3xl">
            <Send size={32} className="text-emerald-500" />
          </div>
          <p className="text-base font-black uppercase tracking-tight text-slate-800 dark:text-white">Ingresso transferido</p>
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xs mx-auto">
            O ingresso agora é de {transferredTo}. Enviamos o ingresso para o e-mail dessa pessoa e uma confirmação para o seu.
          </p>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">O QR e o link que você tinha deixaram de funcionar.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-label="Carregando ingresso" className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="inline-flex p-4 bg-rose-500/10 border border-rose-500/30 rounded-3xl">
            <AlertCircle size={32} className="text-rose-500" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-white">{error ?? 'Ingresso não encontrado'}</p>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Confira o link recebido por email após a compra. Se persistir, responda o email da confirmação.
          </p>
        </div>
      </div>
    );
  }

  const isPago = ticket.status_pagamento === 'APROVADO';
  const isPendente = ticket.status_pagamento === 'PENDENTE';
  const isCheckedIn = ticket.check_in_status === 'OK';
  // Status terminais que invalidam o ingresso — QR não vale mais pra entrada
  const isInvalid = ['CANCELADO', 'VENCIDO', 'ESTORNADO', 'CREDITO'].includes(ticket.status_pagamento);
  const invalidLabel = ticket.status_pagamento === 'ESTORNADO' ? 'Estornado'
    : ticket.status_pagamento === 'CREDITO' ? 'Convertido em crédito'
    : ticket.status_pagamento === 'VENCIDO' ? 'Vencido'
    : 'Cancelado';
  // QR: o id do ingresso; depois de uma transferência, o qr_code novo (o id antigo deixa de valer no check-in).
  const qrValue = ticket.qr_code ?? ticket.id;
  const fallbackCode = qrValue.replace(/-/g, '').slice(-6).toUpperCase();

  // Bug clássico: Date('YYYY-MM-DD') interpreta como UTC e em pt-BR mostra 1 dia atras.
  // Adicionando T12:00:00 forçamos meio-dia local, neutralizando offset de timezone.
  const fmtDay = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', '');
    const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
    return `${cap}, ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`;
  };
  const eventDate = ticket.event_start_date
    ? (ticket.event_end_date && ticket.event_end_date !== ticket.event_start_date
        ? `${fmtDay(ticket.event_start_date)} a ${fmtDay(ticket.event_end_date)}`
        : fmtDay(ticket.event_start_date))
    : null;
  const eventTime = ticket.event_time ? ticket.event_time.slice(0, 5) : null;
  // Endereço completo + link do Maps (busca por texto, sem depender de lat/lng).
  const fullAddress = [ticket.event_location, [ticket.event_city?.trim(), ticket.event_uf].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' — ');
  const mapsUrl = fullAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
    : null;

  // Assento "A-1" -> Fileira A · Nº 1
  const seatLabel = (() => {
    if (!ticket.seat_id) return null;
    const i = ticket.seat_id.lastIndexOf('-');
    if (i < 0) return ticket.seat_id;
    return `Fileira ${ticket.seat_id.slice(0, i)} · Nº ${ticket.seat_id.slice(i + 1)}`;
  })();
  // "Adicionar ao calendário": .ics gerado no cliente (sem lat/lng nem fuso próprio;
  // horário local flutuante, o que é o correto pra evento presencial).
  const handleAddToCalendar = () => {
    if (!ticket.event_start_date) return;
    const day = ticket.event_start_date.replace(/-/g, '');
    const endDay = (ticket.event_end_date ?? ticket.event_start_date).replace(/-/g, '');
    const hhmm = eventTime ? eventTime.replace(':', '') + '00' : null;
    const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CoreoHub//Ingresso//PT-BR', 'BEGIN:VEVENT',
      `UID:${ticket.id}@coreohub.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      hhmm ? `DTSTART:${day}T${hhmm}` : `DTSTART;VALUE=DATE:${day}`,
      // Sem horário de término no cadastro: assume 2h de duração; sem horário nenhum, dia inteiro (DTEND omitido).
      hhmm ? `DTEND:${endDay}T${String(Math.min(23, parseInt(hhmm.slice(0, 2), 10) + 2)).padStart(2, '0')}${hhmm.slice(2)}` : '',
      `SUMMARY:${esc(ticket.event_name)}`,
      fullAddress ? `LOCATION:${esc(fullAddress)}` : '',
      `DESCRIPTION:${esc(`${ticket.ticket_type_nome}${seatLabel ? ' - ' + seatLabel : ''}. Ingresso: ${window.location.href}`)}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean);
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ingresso-${(ticket.event_slug ?? 'evento')}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col print:min-h-0 print:bg-white">
      {/* Página transacional/pessoal: fora do índice de busca (também via X-Robots-Tag no vercel.json). */}
      <meta name="robots" content="noindex, nofollow" />
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between print:hidden">
        <a
          href={`/`}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft size={14} /> CoreoHub
        </a>
        {isPago && !isCheckedIn && (
          <div className="inline-flex items-center gap-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
            <Sun size={12} /> Aumente o brilho
          </div>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-6 print:block print:p-0">
        <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden print:max-w-full print:rounded-none print:shadow-none print:mx-auto">
          {sessionInfo && (sessionInfo.sessao_status === 'adiada' || sessionInfo.sessao_status === 'cancelada') && (
            <div className="p-3 print:hidden">
              <SessionStatusBanner {...sessionInfo} dataAtual={ticket.event_start_date} horaAtual={ticket.event_time} context="ingresso" theme="light" />
              <div className="mt-3">
                {ticket.transfer_count > 0 ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
                    Este ingresso foi transferido. O crédito ou a restituição é escolhido por quem fez a compra, pelo ingresso que continua com essa pessoa.
                  </p>
                ) : (
                <SessionChoicePanel
                  token={token!}
                  sessaoStatus={sessionInfo.sessao_status as 'adiada' | 'cancelada'}
                  statusPagamento={ticket.status_pagamento}
                  checkedIn={isCheckedIn}
                  onChanged={() => { void supabase.rpc('get_audience_ticket_by_token_v3', { p_token: token }).then(({ data }) => { const row = Array.isArray(data) ? data[0] : data; if (row) setTicket(row as Ticket); }); }}
                />
                )}
              </div>
            </div>
          )}
          {/* Family ticket nav (Tier 2): aparece quando há múltiplos tickets na compra */}
          {siblings.length > 1 && (() => {
            const current = siblings.find(s => s.access_token === token);
            const idx = current?.position ?? 1;
            const total = current?.total ?? siblings.length;
            const prev = siblings[idx - 2];
            const next = siblings[idx];
            return (
              <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest print:hidden">
                <button
                  type="button"
                  onClick={() => prev && navigate(`/meu-ingresso/${prev.access_token}`)}
                  disabled={!prev}
                  className="inline-flex items-center gap-1 disabled:opacity-30 hover:text-[#ff0068]"
                >
                  <ChevronLeft size={12} /> Anterior
                </button>
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <Users size={12} /> Ingresso {idx} de {total}
                </span>
                <button
                  type="button"
                  onClick={() => next && navigate(`/meu-ingresso/${next.access_token}`)}
                  disabled={!next}
                  className="inline-flex items-center gap-1 disabled:opacity-30 hover:text-[#ff0068]"
                >
                  Próximo <ChevronRight size={12} />
                </button>
              </div>
            );
          })()}

          {/* Faixa colorida — vermelho se inválido, rosa default */}
          <div className={`px-6 py-4 flex items-center justify-between text-white ${
            isInvalid ? 'bg-slate-700' : 'bg-[#ff0068]'
          }`}>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-80">Ingresso</p>
              <p className="text-sm font-black uppercase tracking-tight italic">CoreoHub</p>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              {isInvalid ? (
                <span className="text-[9px] font-black uppercase tracking-widest bg-rose-300 text-rose-900 px-2 py-0.5 rounded-full">
                  ✕ {invalidLabel}
                </span>
              ) : isCheckedIn ? (
                <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-300 text-emerald-900 px-2 py-0.5 rounded-full">
                  ✓ Check-in OK
                </span>
              ) : isPago ? (
                <span className="text-[9px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                  ✓ Confirmado
                </span>
              ) : (
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-300 text-amber-900 px-2 py-0.5 rounded-full">
                  ⚠ Pagamento pendente
                </span>
              )}
            </div>
          </div>

          {/* Status terminal inválido: ingresso não vale mais pra entrada */}
          {isInvalid ? (
            <div className="px-6 py-8 flex flex-col items-center text-center space-y-4">
              <div className="inline-flex p-4 bg-rose-100 rounded-full">
                <AlertCircle size={40} className="text-rose-600" />
              </div>
              <div>
                <p className="text-base font-black uppercase tracking-tight text-slate-900">
                  Ingresso {invalidLabel.toLowerCase()}
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-[280px]">
                  {ticket.status_pagamento === 'ESTORNADO'
                    ? 'O reembolso foi processado. O QR deste ingresso não é mais válido pra entrada.'
                    : ticket.status_pagamento === 'CREDITO'
                      ? 'Este ingresso foi convertido em crédito. O QR não é mais válido pra entrada; use o cupom exibido acima em outra sessão.'
                    : ticket.status_pagamento === 'VENCIDO'
                      ? 'O prazo de pagamento expirou. Faça uma nova compra se quiser participar.'
                      : 'Este ingresso foi cancelado. Em caso de dúvidas, entre em contato com o organizador.'}
                </p>
              </div>
            </div>
          ) : isPendente && ticket.payment_url ? (
            <div className="px-6 py-8 flex flex-col items-center text-center space-y-4">
              <AlertCircle size={48} className="text-amber-500" />
              <div>
                <p className="text-base font-black uppercase tracking-tight text-slate-900">
                  Pagamento pendente
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Conclua o pagamento pra liberar o ingresso. PIX, cartão ou boleto.
                </p>
              </div>
              <a
                href={ticket.payment_url}
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] text-white rounded-2xl font-black text-xs uppercase tracking-widest"
              >
                Pagar agora <ExternalLink size={14} />
              </a>
              <p className="text-[10px] text-slate-400">
                Esta página é atualizada automaticamente após a confirmação do pagamento.
              </p>
            </div>
          ) : (
            <>
              {/* QR */}
              <div className="px-6 pt-6 pb-4 flex flex-col items-center">
                <div className="bg-white p-3 rounded-2xl border-2 border-slate-100">
                  <QRCodeCanvas
                    id="ticket-qr"
                    value={qrValue}
                    size={256}
                    level="H"
                    fgColor={isCheckedIn ? '#94a3b8' : '#000000'}
                    bgColor="#ffffff"
                    includeMargin={false}
                  />
                </div>
                <div className="mt-4 w-full text-center">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">
                    Código manual
                  </p>
                  <p className="text-2xl font-black tracking-[0.4em] text-slate-900 tabular-nums">
                    {fallbackCode}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 italic">
                    Use se o leitor não reconhecer o QR
                  </p>
                </div>

                {/* Ações: salvar imagem + compartilhar (paridade com Credencial.tsx) */}
                {!isCheckedIn && (
                  <div className="mt-4 flex items-center gap-2 w-full print:hidden">
                    <button
                      type="button"
                      onClick={handleSaveImage}
                      className="flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-2 whitespace-nowrap bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-tight transition-colors"
                      aria-label="Salvar imagem do QR"
                    >
                      <Download size={12} /> Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-2 whitespace-nowrap bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-tight transition-colors"
                      aria-label="Imprimir ingresso"
                    >
                      <Printer size={12} /> Imprimir
                    </button>
                    <button
                      type="button"
                      onClick={handleShare}
                      className="flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-2 whitespace-nowrap bg-[#ff0068]/10 hover:bg-[#ff0068]/20 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-tight transition-colors"
                      aria-label="Compartilhar ingresso"
                    >
                      <Share2 size={12} /> Compartilhar
                    </button>
                  </div>
                )}

                {/* Convite pra instalar o app — aparece só se o navegador suporta
                    (Chrome/Android) ou se é iOS Safari (mostra instruções). Padrão
                    Strava/Sympla: oferece app no momento de maior engajamento
                    (logo após receber o ingresso). */}
                {!isCheckedIn && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col items-center gap-1.5 print:hidden">
                    <p className="text-[10px] text-slate-500 text-center">
                      Acesso rápido ao seu ingresso
                    </p>
                    <InstallPWAButton />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Info do evento + comprador */}
          <div className="px-6 py-4 border-t border-slate-100 space-y-2">
            <p className="text-base font-black uppercase tracking-tight text-slate-900 leading-tight">
              {ticket.event_name}
            </p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              {ticket.ticket_type_nome}
            </p>

            <div className="space-y-1.5 pt-2">
              {eventDate && (
                <div className="flex items-start gap-2 text-[11px] text-slate-600">
                  <Calendar size={12} className="text-[#ff0068] mt-0.5 shrink-0" />
                  <span>{eventDate}{eventTime ? ` · ${eventTime}h` : ''}</span>
                </div>
              )}
              {fullAddress && (
                <div className="flex items-start gap-2 text-[11px] text-slate-600">
                  <MapPin size={12} className="text-[#ff0068] mt-0.5 shrink-0" />
                  <span>
                    {fullAddress}
                    {mapsUrl && (
                      <>
                        {' '}
                        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] font-bold underline print:hidden">
                          Ver no mapa
                        </a>
                      </>
                    )}
                  </span>
                </div>
              )}
              {seatLabel && (
                <div className="mt-1 rounded-xl bg-slate-900 text-white px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-400">Seu lugar</p>
                  <p className="text-sm font-black uppercase tracking-tight">{seatLabel}</p>
                  {seatTipoLabel && (
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-sky-300">
                      {seatTipoLabel} · comprovação na portaria
                    </p>
                  )}
                </div>
              )}
              {eventDate && (
                <button
                  type="button"
                  onClick={handleAddToCalendar}
                  className="cursor-pointer mt-1 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#ff0068] print:hidden"
                >
                  <Calendar size={12} /> Adicionar ao calendário
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 pt-2 mt-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Comprador</p>
              <p className="text-[11px] font-bold text-slate-700 mt-0.5">{ticket.buyer_name}</p>
              <p className="text-[10px] text-slate-500">{ticket.buyer_email_masked}</p>
            </div>

            {ticket.ticket_type_kind === 'meia' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                <p className="text-[9px] text-amber-800 font-bold uppercase tracking-widest mb-1">
                  Meia-entrada
                </p>
                <p className="text-[10px] text-amber-700 leading-snug">
                  Apresente documento que comprove o benefício na entrada (ID estudantil, ID jovem, idoso, PCD).
                </p>
              </div>
            )}

            {isCheckedIn && ticket.check_in_at && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-2">
                <p className="text-[9px] text-emerald-800 font-bold uppercase tracking-widest mb-0.5">
                  Check-in realizado
                </p>
                <p className="text-[10px] text-emerald-700">
                  {new Date(ticket.check_in_at).toLocaleString('pt-BR')}
                </p>
              </div>
            )}
          </div>

          {ticket.transfer_count > 0 && ticket.transferred_at && (
            <div className="px-6 py-2 border-t border-slate-100 print:hidden">
              <p className="text-[10px] text-slate-500">
                Ingresso transferido em {new Date(ticket.transferred_at).toLocaleString('pt-BR')}.
              </p>
            </div>
          )}

          {(isPago || ticket.status_pagamento === 'CORTESIA') && !isCheckedIn && sessionInfo?.sessao_status !== 'cancelada' && (
            <TransferTicketPanel
              token={token!}
              isMeia={ticket.ticket_type_kind === 'meia'}
              hasSeat={!!ticket.seat_id}
              onTransferred={setTransferredTo}
            />
          )}

          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
            <p className="text-[9px] text-slate-400 text-center leading-relaxed">
              Este ingresso é nominativo. Apresente o QR na entrada. Em caso de dúvidas, entre em contato com o organizador.
            </p>
          </div>

          {/* Selo Asaas — exigência regulatória do BaaS. Comprovante de pagamento
              é ponto de contato obrigatório conforme Playbook Asaas.
              theme='auto' acompanha toggle de dark mode da app. Escondido na
              impressão — não serve pra conferência na portaria. */}
          <div className="px-6 py-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-white/10 flex flex-col items-center gap-1 print:hidden">
            <AsaasBadge variant="compact" width={100} height={30} />
            <p className="text-[8px] text-slate-400 dark:text-slate-500 text-center max-w-md leading-snug">
              Pagamento processado pelo ASAAS GESTÃO FINANCEIRA S.A., instituição de pagamento autorizada pelo Banco Central do Brasil.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeuIngresso;
