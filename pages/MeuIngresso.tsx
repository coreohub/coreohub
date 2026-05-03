/**
 * MeuIngresso — Página pública (sem login) que exibe o ingresso comprado.
 * Acessada por link no email pós-pagamento: /meu-ingresso/<access_token>
 *
 * Tier 1 paid tickets. Reaproveita layout de Credencial.tsx (QR + info).
 * Lookup via RPC `get_audience_ticket_by_token` (security definer, mascara CPF/email).
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Loader2, AlertCircle, Sun, Calendar, MapPin, ExternalLink } from 'lucide-react';
import { supabase } from '../services/supabase';

interface Ticket {
  id: string;
  event_id: string;
  event_name: string;
  event_date: string | null;
  event_location: string | null;
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
}

const MeuIngresso: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carga inicial + recarrega quando o token muda
  useEffect(() => {
    if (!token) { setError('Token não informado'); setLoading(false); return; }
    let active = true;
    const fetchTicket = async () => {
      const { data, error: rpcErr } = await supabase
        .rpc('get_audience_ticket_by_token', { p_token: token });
      if (!active) return;
      if (rpcErr) {
        // Não vazar mensagem técnica — log no console, mostra genérico
        console.error('[MeuIngresso] RPC erro:', rpcErr);
        setError('Ingresso não encontrado. Verifique o link recebido por email.');
        setLoading(false);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setError('Ingresso não encontrado. Verifique o link recebido por email.'); setLoading(false); return; }
      setTicket(row as Ticket);
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
      const { data } = await supabase.rpc('get_audience_ticket_by_token', { p_token: token });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTicket(row as Ticket);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
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
  const fallbackCode = ticket.id.replace(/-/g, '').slice(-6).toUpperCase();

  // Bug clássico: Date('YYYY-MM-DD') interpreta como UTC e em pt-BR mostra 1 dia atras.
  // Adicionando T12:00:00 forçamos meio-dia local, neutralizando offset de timezone.
  const eventDate = ticket.event_date
    ? new Date(ticket.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
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

      <div className="flex-1 flex items-center justify-center px-4 pb-6">
        <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
          {/* Faixa rosa */}
          <div className="bg-[#ff0068] px-6 py-4 flex items-center justify-between text-white">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-80">Ingresso</p>
              <p className="text-sm font-black uppercase tracking-tight italic">CoreoHub</p>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              {isCheckedIn ? (
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

          {/* Pagamento pendente: mostra link pra retomar checkout */}
          {isPendente && ticket.payment_url ? (
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
                    value={ticket.id}
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
                  <p className="text-[8px] text-slate-400 mt-1 italic">
                    Use se o leitor não reconhecer o QR
                  </p>
                </div>
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

            <div className="space-y-1 pt-2">
              {eventDate && (
                <div className="flex items-center gap-2 text-[10px] text-slate-600">
                  <Calendar size={12} className="text-[#ff0068]" />
                  <span>{eventDate}</span>
                </div>
              )}
              {ticket.event_location && (
                <div className="flex items-center gap-2 text-[10px] text-slate-600">
                  <MapPin size={12} className="text-[#ff0068]" />
                  <span>{ticket.event_location}</span>
                </div>
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
                  Apresente documento que comprove o benefício no portão (ID estudantil, ID jovem, idoso, PCD).
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

          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
            <p className="text-[9px] text-slate-400 text-center leading-relaxed">
              Este ingresso é nominativo. Apresente o QR no portão. Em caso de dúvidas, entre em contato com o organizador.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeuIngresso;
