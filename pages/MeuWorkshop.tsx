/**
 * MeuWorkshop — Página pública (sem login) que exibe a inscrição em workshop.
 * Acessada por link no email pós-pagamento ou após GRATUITO: /meu-workshop/<access_token>
 *
 * Espelha MeuIngresso. Lookup via RPC `get_workshop_registration_by_token`
 * (security definer, mascara email).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowLeft, Loader2, AlertCircle, Calendar, MapPin, Download, Share2, GraduationCap,
  CheckCircle, Clock, ExternalLink, Sparkles, User as UserIcon,
} from 'lucide-react';
import { supabase } from '../services/supabase';

interface WorkshopRegistration {
  id: string;
  workshop_id: string;
  workshop_name: string;
  workshop_slug: string | null;
  workshop_data_inicio: string | null;
  workshop_data_fim: string | null;
  workshop_local: string | null;
  workshop_modalidade: string | null;
  workshop_nivel: string | null;
  workshop_cover_url: string | null;
  workshop_professor_name: string | null;
  workshop_event_id: string | null;
  buyer_name: string;
  buyer_email_masked: string;
  preco_pago: number;
  status_pagamento: string;
  payment_url: string | null;
  paid_at: string | null;
  attended: boolean;
  attended_at: string | null;
  access_token: string;
  is_combo: boolean;
  created_at: string;
}

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDENTE:   { label: 'Aguardando pagamento', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  APROVADO:   { label: 'Confirmado',           cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  GRATUITO:   { label: 'Grátis · Confirmado',  cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  CORTESIA:   { label: 'Cortesia',             cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  CANCELADO:  { label: 'Cancelado',            cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  VENCIDO:    { label: 'Vencido',              cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  ESTORNADO:  { label: 'Estornado',            cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

const MeuWorkshop: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [reg, setReg] = useState<WorkshopRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Token não informado'); setLoading(false); return; }
    let active = true;
    const fetchReg = async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_workshop_registration_by_token', { p_token: token });
      if (!active) return;
      if (rpcErr) {
        console.error('[MeuWorkshop] RPC erro:', rpcErr);
        setError('Inscrição não encontrada. Verifique o link recebido por email.');
        setLoading(false);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setError('Inscrição não encontrada.'); setLoading(false); return; }
      setReg(row as WorkshopRegistration);
      setLoading(false);
    };
    fetchReg();
    return () => { active = false; };
  }, [token]);

  // Polling de status (5s pendente, 30s aprovado pra detectar attended)
  // Audit T2.5: pára em estados terminais (CANCELADO/VENCIDO/ESTORNADO) — antes
  // continuava rodando pra sempre.
  useEffect(() => {
    if (!token || !reg) return;
    const isPendente = reg.status_pagamento === 'PENDENTE';
    const isTerminal = ['CANCELADO', 'VENCIDO', 'ESTORNADO'].includes(reg.status_pagamento);
    if (reg.attended || isTerminal) return; // estado terminal
    const interval = isPendente ? 5_000 : 30_000;
    const t = setInterval(async () => {
      const { data } = await supabase.rpc('get_workshop_registration_by_token', { p_token: token });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setReg(row as WorkshopRegistration);
    }, interval);
    return () => clearInterval(t);
  }, [token, reg]);

  // Wakelock — tela ligada enquanto QR estiver visível
  useEffect(() => {
    let wakeLock: any = null;
    (async () => {
      try {
        if ('wakeLock' in navigator) wakeLock = await (navigator as any).wakeLock.request('screen');
      } catch { /* ignore */ }
    })();
    return () => { try { wakeLock?.release(); } catch { /* ignore */ } };
  }, []);

  const handleSaveImage = () => {
    const canvas = document.getElementById('workshop-qr') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `workshop-${reg?.workshop_name?.replace(/\s+/g, '-') ?? 'coreohub'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleShare = async () => {
    const url = window.location.href;
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({
          title: `Workshop: ${reg?.workshop_name}`,
          text: `Minha inscrição confirmada no workshop com ${reg?.workshop_professor_name}`,
          url,
        });
      } catch { /* ignore */ }
    } else {
      navigator.clipboard.writeText(url);
      alert('Link copiado!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  if (error || !reg) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white/5 border border-rose-500/30 rounded-2xl p-6 text-center">
          <AlertCircle className="text-rose-400 mx-auto mb-3" size={32} />
          <p className="text-white font-bold mb-2">Não foi possível carregar</p>
          <p className="text-sm text-slate-400 mb-4">{error}</p>
          <button onClick={() => navigate('/')} className="text-xs font-black text-[#ff0068] uppercase tracking-widest">← Início</button>
        </div>
      </div>
    );
  }

  const status = STATUS_BADGE[reg.status_pagamento] ?? STATUS_BADGE.PENDENTE;
  const isTerminal = ['CANCELADO', 'VENCIDO', 'ESTORNADO'].includes(reg.status_pagamento);
  const isConfirmed = ['APROVADO', 'GRATUITO', 'CORTESIA'].includes(reg.status_pagamento);
  const isPendente  = reg.status_pagamento === 'PENDENTE';

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-white pb-12">
      {/* Cover */}
      <div className="relative h-32 md:h-48 overflow-hidden">
        {reg.workshop_cover_url ? (
          <img src={reg.workshop_cover_url} alt="" className="w-full h-full object-cover opacity-40" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#ff0068] via-purple-700 to-[#0b0b0f]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0b0f]" />
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-8 relative">
        <button onClick={() => navigate(`/workshop/${reg.workshop_slug ?? reg.workshop_id}`)} className="inline-flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] mb-4">
          <ArrowLeft size={14} /> Detalhes do workshop
        </button>

        <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-[#ff0068]/20 text-[#ff0068] px-2.5 py-1 rounded-full mb-2">
          <GraduationCap size={11} />Inscrição em workshop
        </div>
        <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase mb-1">{reg.workshop_name}</h1>
        <p className="text-sm text-slate-400 mb-2">com <strong className="text-white">{reg.workshop_professor_name}</strong></p>

        <div className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest border rounded-full px-3 py-1 mb-6 ${status.cls}`}>
          {isConfirmed && <CheckCircle size={11} />}
          {isPendente && <Clock size={11} />}
          {isTerminal && <AlertCircle size={11} />}
          {status.label}
          {reg.is_combo && <span className="ml-1 inline-flex items-center gap-1"><Sparkles size={10} />Combo</span>}
        </div>

        {/* QR — só aparece confirmado e não-terminal */}
        {isConfirmed && !isTerminal && (
          <div className="bg-white rounded-2xl p-6 mb-4 flex flex-col items-center">
            <QRCodeCanvas
              id="workshop-qr"
              value={reg.access_token}
              size={224}
              level="H"
              fgColor="#0b0b0f"
              includeMargin={false}
            />
            <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-700">{reg.buyer_name}</p>
            <p className="text-[10px] text-slate-500 font-mono break-all max-w-xs text-center mt-1">{reg.access_token.slice(0, 13)}...</p>
            {reg.attended && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
                <CheckCircle size={11} />Presença registrada · {fmtDateTime(reg.attended_at)}
              </div>
            )}
          </div>
        )}

        {/* CTA pagar (só se PENDENTE) */}
        {isPendente && reg.payment_url && (
          <a
            href={reg.payment_url}
            className="block w-full text-center rounded-xl bg-[#ff0068] px-4 py-3.5 mb-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] transition"
          >
            <span className="inline-flex items-center justify-center gap-2"><ExternalLink size={14} />Continuar pagamento</span>
          </a>
        )}

        {/* Info do workshop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <InfoBox icon={Calendar} label="Quando" value={fmtDateTime(reg.workshop_data_inicio)} />
          {reg.workshop_local && (
            <InfoBox icon={MapPin} label="Onde" value={reg.workshop_local} />
          )}
        </div>

        {/* Resumo */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4 space-y-1.5 text-sm">
          <Row label="Comprador" value={reg.buyer_name} />
          <Row label="Email" value={reg.buyer_email_masked} />
          {reg.workshop_modalidade && <Row label="Modalidade" value={reg.workshop_modalidade} />}
          <Row label="Valor pago" value={reg.preco_pago === 0 ? 'Grátis' : `R$ ${Number(reg.preco_pago).toFixed(2).replace('.', ',')}`} />
          {reg.paid_at && <Row label="Pago em" value={fmtDateTime(reg.paid_at)} />}
        </div>

        {/* Ações */}
        {isConfirmed && !isTerminal && (
          <div className="flex items-center gap-2">
            <button onClick={handleSaveImage} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-white/5 transition">
              <Download size={14} />Salvar QR
            </button>
            <button onClick={handleShare} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-white/5 transition">
              <Share2 size={14} />Compartilhar
            </button>
          </div>
        )}

        {isTerminal && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-sm text-rose-200 mt-4">
            <p className="font-bold mb-1">Inscrição não está mais ativa</p>
            <p className="text-xs opacity-80">
              {reg.status_pagamento === 'CANCELADO' && 'Esta inscrição foi cancelada.'}
              {reg.status_pagamento === 'VENCIDO' && 'O prazo de pagamento expirou. Volte ao workshop para fazer uma nova inscrição.'}
              {reg.status_pagamento === 'ESTORNADO' && 'O pagamento foi estornado.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const InfoBox: React.FC<{ icon: any; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 inline-flex items-center gap-1.5">
      <Icon size={10} />{label}
    </p>
    <p className="text-sm font-bold text-white">{value}</p>
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-slate-400 text-xs">{label}</span>
    <span className="font-bold text-white text-right">{value}</span>
  </div>
);

export default MeuWorkshop;
