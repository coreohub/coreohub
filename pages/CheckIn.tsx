import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, CheckCircle2, User, QrCode, RefreshCw,
  X, AlertCircle, Clock, DollarSign, Music2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';

interface CheckInItem {
  id: string;
  nome_coreografia: string;
  estudio?: string;
  status_pagamento: string;
  status_trilha?: string;
  trilha_url?: string;
  check_in_status?: string;
  check_in_at?: string;
}

type FilterTab = 'TODOS' | 'PENDENTE' | 'OK';

const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
    ok ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  }`}>
    {label}
  </span>
);

const CheckIn = () => {
  const [items, setItems] = useState<CheckInItem[]>([]);
  const [filtered, setFiltered] = useState<CheckInItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('TODOS');

  /* QR scanner */
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'duplicate'; message: string; name?: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  /* ── fetch ── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('registrations')
        .select('id,nome_coreografia,estudio,status_pagamento,status_trilha,trilha_url,check_in_status,check_in_at')
        .order('nome_coreografia', { ascending: true });
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── filter ── */
  useEffect(() => {
    let list = items;
    if (search) {
      const t = search.toLowerCase();
      list = list.filter(i =>
        i.nome_coreografia?.toLowerCase().includes(t) ||
        i.estudio?.toLowerCase().includes(t)
      );
    }
    if (filterTab === 'OK')      list = list.filter(i => i.check_in_status === 'OK');
    if (filterTab === 'PENDENTE') list = list.filter(i => i.check_in_status !== 'OK');
    setFiltered(list);
  }, [items, search, filterTab]);

  /* ── manual check-in toggle ── */
  const handleToggle = async (item: CheckInItem) => {
    if (item.status_pagamento !== 'CONFIRMADO') return;
    const newStatus = item.check_in_status === 'OK' ? null : 'OK';
    const now = newStatus === 'OK' ? new Date().toISOString() : null;

    const { error } = await supabase
      .from('registrations')
      .update({ check_in_status: newStatus, check_in_at: now })
      .eq('id', item.id);
    if (error) { console.error(error); return; }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, check_in_status: newStatus ?? undefined, check_in_at: now ?? undefined } : i));
  };

  /* ── process QR result (UUID lookup em registrations OU audience_tickets) ── */
  const processQrId = useCallback(async (rawId: string) => {
    const id = rawId.trim();

    // 1) Tenta primeiro em registrations (inscrições) — comportamento legado
    const item = items.find(i => i.id === id);
    if (item) {
      if (item.check_in_status === 'OK') {
        const t = item.check_in_at ? new Date(item.check_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        setScanResult({ type: 'duplicate', message: `Já credenciado${t ? ' às ' + t : ''}.`, name: item.nome_coreografia });
        return;
      }
      if (item.status_pagamento !== 'CONFIRMADO') {
        setScanResult({ type: 'error', message: 'Pagamento não confirmado. Procure o coordenador.', name: item.nome_coreografia });
        return;
      }
      const now = new Date().toISOString();
      await supabase.from('registrations').update({ check_in_status: 'OK', check_in_at: now }).eq('id', id);
      setItems(prev => prev.map(i => i.id === id ? { ...i, check_in_status: 'OK', check_in_at: now } : i));
      setScanResult({ type: 'success', message: 'Check-in realizado!', name: item.nome_coreografia });
      return;
    }

    // 2) Fallback: pode ser ingresso de plateia (Tier 1)
    const { data: ticket } = await supabase
      .from('audience_tickets')
      .select('id, ticket_type_nome, ticket_type_kind, buyer_name, status_pagamento, check_in_status, check_in_at')
      .eq('id', id)
      .maybeSingle();

    if (!ticket) {
      setScanResult({ type: 'error', message: 'QR não encontrado (nem inscrição nem ingresso).' });
      return;
    }

    if (ticket.check_in_status === 'OK') {
      const t = ticket.check_in_at ? new Date(ticket.check_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      setScanResult({ type: 'duplicate', message: `Ingresso já usado${t ? ' às ' + t : ''}.`, name: ticket.buyer_name });
      return;
    }
    if (ticket.status_pagamento !== 'APROVADO' && ticket.status_pagamento !== 'CORTESIA') {
      setScanResult({ type: 'error', message: `Pagamento ${String(ticket.status_pagamento).toLowerCase()}. Procure o coordenador.`, name: ticket.buyer_name });
      return;
    }
    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('audience_tickets')
      .update({ check_in_status: 'OK', check_in_at: now })
      .eq('id', id);
    if (upErr) {
      setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: ticket.buyer_name });
      return;
    }
    const meiaSuffix = ticket.ticket_type_kind === 'meia' ? ' (verificar documento de meia)' : '';
    setScanResult({
      type: 'success',
      message: `Ingresso ${ticket.ticket_type_nome} liberado${meiaSuffix}!`,
      name: ticket.buyer_name,
    });
  }, [items]);

  /* ── QR scanner via BarcodeDetector or fallback ── */
  const startScanner = async () => {
    setScanResult(null);
    setScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BD = (window as any).BarcodeDetector;
      if (!BD) return; // fallback: user types manually
      const detector = new BD({ formats: ['qr_code'] });
      const scan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          scanLoopRef.current = requestAnimationFrame(scan);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            stopScanner();
            await processQrId(codes[0].rawValue);
          } else {
            scanLoopRef.current = requestAnimationFrame(scan);
          }
        } catch {
          scanLoopRef.current = requestAnimationFrame(scan);
        }
      };
      scanLoopRef.current = requestAnimationFrame(scan);
    } catch (e) {
      console.error('Camera error:', e);
    }
  };

  const stopScanner = useCallback(() => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScannerOpen(false);
  }, []);

  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  /* ── counts ── */
  const total     = items.length;
  const doneCount = items.filter(i => i.check_in_status === 'OK').length;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">

      {/* Header */}
      <div className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/5 px-4 pt-5 pb-4 space-y-4 sticky top-0 z-30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
              Creden<span className="text-[#ff0068]">ciamento</span>
            </h1>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
              {doneCount} / {total} credenciados
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={startScanner}
              className="flex items-center gap-2 px-4 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
            >
              <QrCode size={16} /> Escanear QR
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: total > 0 ? `${(doneCount / total) * 100}%` : '0%' }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            type="text"
            placeholder="Buscar coreografia ou estúdio..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50 transition-all"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-2xl">
          {(['TODOS', 'PENDENTE', 'OK'] as FilterTab[]).map(t => (
            <button
              key={t}
              onClick={() => setFilterTab(t)}
              className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                filterTab === t
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t === 'TODOS' ? `Todos (${total})` : t === 'OK' ? `Feitos (${doneCount})` : `Pendentes (${total - doneCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 px-4 pt-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#ff0068] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhuma inscrição encontrada</p>
          </div>
        ) : filtered.map(item => {
          const checkedIn   = item.check_in_status === 'OK';
          const pago        = item.status_pagamento === 'CONFIRMADO';
          const trilhaOk    = !!(item.trilha_url);
          const canCheckIn  = pago;

          return (
            <div
              key={item.id}
              className={`bg-white dark:bg-slate-900/50 border rounded-3xl p-4 flex items-center gap-3 transition-all ${
                checkedIn ? 'border-emerald-500/30' : 'border-slate-200 dark:border-white/5'
              }`}
            >
              {/* Avatar dot */}
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                checkedIn ? 'bg-emerald-500/10' : 'bg-slate-100 dark:bg-white/5'
              }`}>
                {checkedIn
                  ? <CheckCircle2 size={18} className="text-emerald-500" />
                  : <User size={18} className="text-slate-400" />
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate leading-tight">
                  {item.nome_coreografia}
                </p>
                {item.estudio && (
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">{item.estudio}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <StatusBadge ok={pago}     label={pago ? 'Pago' : 'Pendente'} />
                  <StatusBadge ok={trilhaOk} label={trilhaOk ? 'Trilha OK' : 'Sem Trilha'} />
                  {checkedIn && item.check_in_at && (
                    <span className="text-[8px] font-bold text-slate-400 uppercase">
                      {new Date(item.check_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Action */}
              <button
                onClick={() => handleToggle(item)}
                disabled={!canCheckIn}
                className={`shrink-0 w-16 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                  checkedIn
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 hover:bg-[#ff0068] hover:text-white hover:border-transparent'
                }`}
              >
                {checkedIn ? 'OK ✓' : 'Check'}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── QR Scanner modal ── */}
      <AnimatePresence>
        {scannerOpen && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col">
            <div className="flex items-center justify-between px-5 pt-6 pb-4">
              <div>
                <p className="text-white font-black uppercase text-lg tracking-tighter">Escanear QR Code</p>
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Aponte para o QR do grupo</p>
              </div>
              <button onClick={stopScanner} className="p-2 text-slate-400 hover:text-white transition-all">
                <X size={24} />
              </button>
            </div>

            {/* Camera */}
            <div className="flex-1 relative overflow-hidden">
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
              {/* Scan frame overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 h-64 relative">
                  <div className="absolute inset-0 border-2 border-white/20 rounded-3xl" />
                  <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#ff0068] rounded-tl-2xl" />
                  <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#ff0068] rounded-tr-2xl" />
                  <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#ff0068] rounded-bl-2xl" />
                  <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#ff0068] rounded-br-2xl" />
                  {/* Scan line */}
                  <motion.div
                    className="absolute left-2 right-2 h-0.5 bg-[#ff0068] opacity-70 rounded-full"
                    animate={{ top: ['10%', '90%', '10%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </div>
            </div>

            {/* Manual input fallback */}
            <div className="px-5 py-6 space-y-3 bg-slate-950">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">Ou insira o código manualmente</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Cole o UUID da inscrição..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-[#ff0068]/50"
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      stopScanner();
                      await processQrId(val);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Scan result toast ── */}
      <AnimatePresence>
        {scanResult && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-24 inset-x-4 z-[200] flex justify-center"
          >
            <div className={`w-full max-w-sm rounded-3xl p-5 shadow-2xl flex items-start gap-4 ${
              scanResult.type === 'success'   ? 'bg-emerald-500' :
              scanResult.type === 'duplicate' ? 'bg-amber-500'   : 'bg-rose-500'
            }`}>
              {scanResult.type === 'success'   && <CheckCircle2 size={24} className="text-white shrink-0 mt-0.5" />}
              {scanResult.type === 'duplicate' && <Clock         size={24} className="text-white shrink-0 mt-0.5" />}
              {scanResult.type === 'error'     && <AlertCircle   size={24} className="text-white shrink-0 mt-0.5" />}
              <div className="flex-1">
                {scanResult.name && (
                  <p className="text-white font-black text-sm uppercase tracking-tight leading-tight">{scanResult.name}</p>
                )}
                <p className="text-white/90 text-[11px] font-bold mt-0.5">{scanResult.message}</p>
              </div>
              <button onClick={() => setScanResult(null)} className="text-white/70 hover:text-white shrink-0">
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CheckIn;
