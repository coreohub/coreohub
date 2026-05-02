import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Download, Share2, Sun, Loader2, AlertCircle, FileDown } from 'lucide-react';
import { supabase } from '../services/supabase';

/**
 * Credencial digital do inscrito (Backlog Opção A — QR pra credenciamento +
 * setores). Tela standalone, otimizada pra ser exibida no celular do inscrito
 * ao chegar no evento. UX research-backed:
 *
 *   - QR grande (256+ px) com level='H' (30% error correction) — sobrevive a
 *     lentes/sol/dedos sujos.
 *   - Background branco puro + foreground preto puro pra contraste maximo
 *     em ambientes claros (ginasio com sol).
 *   - Wakelock automatico mantem tela ligada enquanto a tela esta visivel.
 *   - Codigo numerico fallback (ultimos 6 digitos do UUID) caso scanner falhe.
 *   - Botao salvar imagem pra galeria + compartilhar nativo (WhatsApp).
 *   - Sem PII visivel no QR — payload é o UUID puro da registration; nome
 *     e estudio aparecem so no card decorativo.
 */

interface Credencial {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string | null;
  categoria: string | null;
  formato_participacao: string | null;
  status: string;
  status_pagamento: string;
  event: { name: string; edition_year: number | null; cover_url: string | null } | null;
}

const Credencial: React.FC = () => {
  const navigate = useNavigate();
  const { registrationId } = useParams<{ registrationId: string }>();
  const [data, setData] = useState<Credencial | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registrationId) {
      setError('ID da inscrição não informado.');
      setLoading(false);
      return;
    }
    (async () => {
      const { data: row, error: dbErr } = await supabase
        .from('registrations')
        .select(`
          id, nome_coreografia, estudio, estilo_danca, categoria,
          formato_participacao, status, status_pagamento,
          events!inner(name, edition_year, cover_url)
        `)
        .eq('id', registrationId)
        .maybeSingle();
      if (dbErr) { setError(dbErr.message); setLoading(false); return; }
      if (!row) { setError('Inscrição não encontrada ou você não tem acesso.'); setLoading(false); return; }
      setData({
        ...(row as any),
        event: Array.isArray((row as any).events) ? (row as any).events[0] : (row as any).events,
      });
      setLoading(false);
    })();
  }, [registrationId]);

  // Wakelock: mantem tela ligada enquanto credencial visivel. Libera no unmount.
  useEffect(() => {
    let wakeLock: any = null;
    let active = true;
    (async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* permissao negada ou nao suportado */ }
    })();
    const onVisibility = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      try {
        if ('wakeLock' in navigator && !wakeLock) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* noop */ }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      try { wakeLock?.release(); } catch { /* noop */ }
    };
  }, []);

  // Codigo numerico de fallback (manual): ultimos 6 chars do UUID em maiusculas.
  // Equipe digita esse codigo em CheckIn quando camera/QR falha.
  const fallbackCode = useMemo(() => {
    if (!data?.id) return '';
    return data.id.replace(/-/g, '').slice(-6).toUpperCase();
  }, [data?.id]);

  const handleSaveImage = () => {
    const canvas = document.getElementById('credencial-qr') as HTMLCanvasElement | null;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `credencial-${(data?.nome_coreografia ?? 'inscricao').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // Gera PDF A4 portrait estilo carteirinha (Etapa 2 — Opção B do backlog QR).
  // Inclui QR grande, codigo manual, info da inscricao, evento. Lazy-import de jsPDF.
  const handleSavePDF = async () => {
    if (!data) return;
    const canvas = document.getElementById('credencial-qr') as HTMLCanvasElement | null;
    if (!canvas) return;
    const qrDataUrl = canvas.toDataURL('image/png');
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const w = doc.internal.pageSize.getWidth();

    // Banner topo rosa
    doc.setFillColor(255, 0, 104);
    doc.rect(0, 0, w, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('CREDENCIAL', w / 2, 14, { align: 'center' });
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('CoreoHub', w / 2, 24, { align: 'center' });
    if (data.event) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`${data.event.edition_year ? data.event.edition_year + ' · ' : ''}${data.event.name}`, w / 2, 31, { align: 'center' });
    }

    // QR grande centralizado
    const qrSize = 90;
    const qrX = (w - qrSize) / 2;
    const qrY = 50;
    doc.setFillColor(255, 255, 255);
    doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 'F');
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8);
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // Codigo manual
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text('CÓDIGO MANUAL', w / 2, qrY + qrSize + 12, { align: 'center' });
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(fallbackCode, w / 2, qrY + qrSize + 22, { align: 'center', charSpace: 3 });

    // Info da inscricao
    let cursorY = qrY + qrSize + 38;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(data.nome_coreografia.toUpperCase(), w / 2, cursorY, { align: 'center' });
    cursorY += 7;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(data.estudio, w / 2, cursorY, { align: 'center' });

    cursorY += 10;
    const tags = [data.estilo_danca, data.formato_participacao, data.categoria].filter(Boolean) as string[];
    if (tags.length > 0) {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(tags.join('  ·  '), w / 2, cursorY, { align: 'center' });
    }

    // Status
    cursorY += 14;
    if (isAprovada && isPago) {
      doc.setFillColor(34, 197, 94);
      doc.setTextColor(255, 255, 255);
      doc.roundedRect(w / 2 - 25, cursorY - 5, 50, 8, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text('LIBERADA', w / 2, cursorY, { align: 'center' });
    } else {
      doc.setFillColor(251, 191, 36);
      doc.setTextColor(120, 80, 0);
      doc.roundedRect(w / 2 - 35, cursorY - 5, 70, 8, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(!isPago ? 'PAGAMENTO PENDENTE' : 'APROVAÇÃO PENDENTE', w / 2, cursorY, { align: 'center' });
    }

    // Rodape
    doc.setTextColor(140, 140, 140);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('Apresente este código no credenciamento. Mantenha o brilho da tela alto se for ler do celular.', w / 2, 285, { align: 'center' });

    const slug = data.nome_coreografia.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    doc.save(`credencial-${slug}.pdf`);
  };

  const handleShare = async () => {
    const canvas = document.getElementById('credencial-qr') as HTMLCanvasElement | null;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], 'credencial.png', { type: 'image/png' });
      const shareData: any = {
        title: 'Minha Credencial CoreoHub',
        text: `${data?.nome_coreografia} · ${data?.estudio}`,
        files: [file],
      };
      try {
        if (navigator.canShare?.(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch { /* user cancelou ou erro */ }
      // Fallback: salva
      handleSaveImage();
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="inline-flex p-4 bg-rose-500/10 border border-rose-500/30 rounded-3xl">
            <AlertCircle size={32} className="text-rose-500" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-white">{error ?? 'Erro desconhecido'}</p>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            <ArrowLeft size={14} /> Voltar
          </button>
        </div>
      </div>
    );
  }

  const isPago = data.status_pagamento === 'CONFIRMADO' || data.status_pagamento === 'APROVADO';
  const isAprovada = data.status === 'APROVADA';

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
      {/* Header com voltar + dica de brilho */}
      <div className="px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft size={14} /> Voltar
        </button>
        <div className="inline-flex items-center gap-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
          <Sun size={12} />
          Aumente o brilho da tela
        </div>
      </div>

      {/* Card credencial */}
      <div className="flex-1 flex items-center justify-center px-4 pb-6">
        <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
          {/* Faixa rosa CoreoHub no topo */}
          <div className="bg-[#ff0068] px-6 py-4 flex items-center justify-between text-white">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-80">Credencial</p>
              <p className="text-sm font-black uppercase tracking-tight italic">CoreoHub</p>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              {isAprovada && isPago ? (
                <span className="text-[9px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                  ✓ Liberada
                </span>
              ) : (
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-300 text-amber-900 px-2 py-0.5 rounded-full">
                  ⚠ {!isPago ? 'Pagamento pendente' : 'Aprovação pendente'}
                </span>
              )}
            </div>
          </div>

          {/* QR */}
          <div className="px-6 pt-6 pb-4 flex flex-col items-center">
            <div className="bg-white p-3 rounded-2xl border-2 border-slate-100">
              <QRCodeCanvas
                id="credencial-qr"
                value={data.id}
                size={256}
                level="H"
                fgColor="#000000"
                bgColor="#ffffff"
                includeMargin={false}
              />
            </div>
            {/* Codigo fallback */}
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

          {/* Info da inscrição */}
          <div className="px-6 py-4 border-t border-slate-100 space-y-2">
            <p className="text-base font-black uppercase tracking-tight text-slate-900 leading-tight">
              {data.nome_coreografia}
            </p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              {data.estudio}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {data.estilo_danca && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {data.estilo_danca}
                </span>
              )}
              {data.formato_participacao && (
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {data.formato_participacao}
                </span>
              )}
              {data.categoria && (
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[9px] font-black uppercase tracking-wider">
                  {data.categoria}
                </span>
              )}
            </div>
          </div>

          {/* Evento */}
          {data.event && (
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
              <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Evento</p>
              <p className="text-xs font-black uppercase tracking-tight text-slate-700 mt-0.5">
                {data.event.edition_year ? `${data.event.edition_year} · ` : ''}{data.event.name}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Acoes */}
      <div className="px-4 pb-6 grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-sm mx-auto w-full">
        <button
          onClick={handleSaveImage}
          className="flex items-center justify-center gap-1.5 px-3 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-transform"
        >
          <Download size={12} /> Imagem
        </button>
        <button
          onClick={handleSavePDF}
          className="flex items-center justify-center gap-1.5 px-3 py-3 bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/15 active:scale-[0.98] transition-all"
        >
          <FileDown size={12} /> PDF
        </button>
        <button
          onClick={handleShare}
          className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 px-3 py-3 bg-[#ff0068] text-white rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-[#ff0068]/20"
        >
          <Share2 size={12} /> Compartilhar
        </button>
      </div>
    </div>
  );
};

export default Credencial;
