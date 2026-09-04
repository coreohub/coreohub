import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseUrl } from '../services/supabase';
import { UserRole } from '../types';
import { Trophy, Star, Music, Loader2, Volume2, Award, ChevronDown, ChevronUp, Search, Download, FileText, MessageSquare, Share2, Captions } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MyResultsProps {
  activeRole: UserRole;
}

interface MyRegistration {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  status: string;
  media_final?: number;
  classificacao_final?: number;
  resultado_publicado?: boolean;
  evaluations: {
    id: string;
    judge_name: string;
    scores: Record<string, number>;
    final: number;
    audio_url?: string;
    feedback_text?: string | null;
    audio_transcript?: string | null;
  }[];
}

const slugify = (s: string) =>
  (s || 'arquivo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'arquivo';

const ScoreBadge = ({ score }: { score: number }) => {
  const color = score >= 9
    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30'
    : score >= 7
      ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/30'
      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30';

  return (
    <span className={`px-3 py-1 rounded-xl border font-black text-lg italic ${color}`}>
      {score.toFixed(2)}
    </span>
  );
};

const MyResults: React.FC<MyResultsProps> = ({ activeRole }) => {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  // UX#12: erro silencioso virou erro visível.
  const [error, setError] = useState<string | null>(null);
  // UX#12: ref único pro Audio pra cleanup correto (antes vazava ao trocar de áudio rapidamente).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [downloadingAudio, setDownloadingAudio] = useState<string | null>(null);
  const [sharingAudio, setSharingAudio] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  // Transcrição em texto do áudio do jurado (planejado 2026-09-04) — sob
  // demanda, cacheada em evaluations.audio_transcript. Só disponível quando
  // o resultado já foi publicado (mesmo gate de sigilo do júri usado pro
  // nome do jurado); a edge function reforça essa checagem no servidor.
  const [transcribingId, setTranscribingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchMyResults = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Busca inscrições do usuário logado
        const { data: regs, error: regError } = await supabase
          .from('registrations')
          .select('*')
          .eq('user_id', user.id)
          .order('criado_em', { ascending: false });

        if (regError) throw regError;

        if (!regs || regs.length === 0) {
          setRegistrations([]);
          return;
        }

        // Busca avaliações de todas as inscrições numa query só (evita N+1).
        // Nota: evaluations.judge_id nunca teve FK pra judges.id no banco, então
        // o embed `judges(name)` do PostgREST sempre falhava com PGRST200
        // ("Could not find a relationship") — 2 queries em lote + merge
        // client-side evita depender dessa relação.
        const regIds = regs.map((reg) => reg.id);
        const { data: allEvals, error: evalError } = await supabase
          .from('evaluations')
          .select('*')
          .in('registration_id', regIds);

        if (evalError) console.error('Erro ao buscar avaliações:', evalError);

        const judgeIds = [...new Set((allEvals || []).map((e: any) => e.judge_id).filter(Boolean))];
        let judgeNameById: Record<string, string> = {};
        if (judgeIds.length > 0) {
          const { data: judgesData, error: judgesError } = await supabase
            .from('judges')
            .select('id, name')
            .in('id', judgeIds);
          if (judgesError) console.error('Erro ao buscar nomes dos jurados:', judgesError);
          judgeNameById = Object.fromEntries((judgesData || []).map((j: any) => [j.id, j.name]));
        }

        const evalsByRegId: Record<string, any[]> = {};
        (allEvals || []).forEach((e: any) => {
          (evalsByRegId[e.registration_id] ??= []).push(e);
        });

        const withEvals: MyRegistration[] = regs.map((reg) => {
          const evaluations = (evalsByRegId[reg.id] || []).map((e: any) => ({
            id: e.id,
            judge_name: judgeNameById[e.judge_id] || 'Jurado',
            scores: e.scores || {},
            final: Number(e.final_weighted_average) || 0,
            audio_url: e.audio_url,
            feedback_text: e.feedback_text ?? null,
            audio_transcript: e.audio_transcript ?? null,
          }));

          return {
            id: reg.id,
            nome_coreografia: reg.nome_coreografia || '—',
            estudio: reg.estudio || '—',
            estilo_danca: reg.estilo_danca || '—',
            categoria: reg.categoria || '—',
            status: reg.status_pagamento || '—',
            media_final: reg.media_final,
            classificacao_final: reg.classificacao_final,
            resultado_publicado: reg.resultado_publicado,
            evaluations,
          };
        });

        setRegistrations(withEvals);
      } catch (err: any) {
        console.error('MyResults error:', err);
        setError(err?.message ?? 'Erro ao carregar seus resultados.');
      } finally {
        setLoading(false);
      }
    };

    fetchMyResults();
  }, []);

  // UX#12: cleanup do áudio ao desmontar (antes vazava listener).
  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  const playAudio = (url: string) => {
    // Pausa qualquer áudio anterior (evita reproduções sobrepostas ao clicar várias vezes)
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (playingAudio === url) {
      setPlayingAudio(null);
      return;
    }
    setPlayingAudio(url);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => setPlayingAudio(null));
    audio.onended = () => setPlayingAudio(null);
  };

  /* Download do áudio do jurado. O atributo `download` é ignorado em URLs
     cross-origin (Supabase Storage), então buscamos o blob e geramos object URL. */
  const downloadAudio = async (url: string, regName: string, judgeName: string) => {
    setDownloadingAudio(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch falhou');
      const blob = await res.blob();
      const ext = (url.split('.').pop() || 'webm').split('?')[0];
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `feedback-${slugify(regName)}-${slugify(judgeName)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error('Erro ao baixar áudio:', err);
      setError('Falha ao baixar o áudio. Tente novamente.');
    } finally {
      setDownloadingAudio(null);
    }
  };

  /* Compartilha o áudio via Web Share API nativa (Android/iOS abrem o share
     sheet do sistema, com WhatsApp na lista). Desktop não suporta compartilhar
     arquivo por essa API — cai no download como fallback. */
  const shareAudio = async (url: string, regName: string, judgeName: string) => {
    setSharingAudio(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch falhou');
      const blob = await res.blob();
      const ext = (url.split('.').pop() || 'webm').split('?')[0];
      const fileName = `feedback-${slugify(regName)}-${slugify(judgeName)}.${ext}`;
      const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Comentário de ${judgeName}`,
          text: `Comentário em áudio de ${judgeName} sobre "${regName}"`,
        });
      } else {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Erro ao compartilhar áudio:', err);
        setError('Falha ao compartilhar o áudio. Tente novamente.');
      }
    } finally {
      setSharingAudio(null);
    }
  };

  /* Compartilha o comentário escrito do jurado via link wa.me (funciona em
     qualquer plataforma, abre o WhatsApp com o texto pré-preenchido). */
  const shareFeedbackText = (regName: string, judgeName: string, text: string) => {
    const message = `Comentário de ${judgeName} sobre "${regName}":\n\n"${text}"\n\n— via CoreoHub`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  /* Pede a transcrição em texto do áudio do jurado (Gemini, via edge
     function transcribe-judge-audio) e guarda no state local pra exibir sem
     precisar recarregar a página. */
  const transcribeAudio = async (evaluationId: string) => {
    setTranscribingId(evaluationId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${supabaseUrl}/functions/v1/transcribe-judge-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ evaluation_id: evaluationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Erro ao transcrever áudio');

      setRegistrations(regs => regs.map(reg => ({
        ...reg,
        evaluations: reg.evaluations.map(ev => ev.id === evaluationId ? { ...ev, audio_transcript: json.transcript } : ev),
      })));
    } catch (err) {
      console.error('Erro ao transcrever áudio:', err);
      setError(err instanceof Error ? err.message : 'Falha ao transcrever o áudio. Tente novamente.');
    } finally {
      setTranscribingId(null);
    }
  };

  /* Gera PDF do scoresheet (notas por quesito + comentário escrito) de uma
     inscrição. Inclui todos os jurados. Disponível quando o resultado já foi
     publicado (contém notas). Padrão CompetitionSuite/DanceBug. */
  const downloadPdf = async (reg: MyRegistration) => {
    setGeneratingPdf(reg.id);
    try {
      const { default: jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Cabeçalho
      doc.setFillColor(255, 0, 104);
      doc.rect(0, 0, pageWidth, 42, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('Folha de Avaliação', pageWidth / 2, 20, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(reg.nome_coreografia.toUpperCase(), pageWidth / 2, 30, { align: 'center' });
      doc.setFontSize(9);
      doc.text(`${reg.estudio} • ${reg.categoria} • ${reg.estilo_danca}`, pageWidth / 2, 37, { align: 'center' });

      doc.setTextColor(40, 40, 40);
      let cursorY = 54;

      const overallAvg = reg.evaluations.length > 0
        ? reg.evaluations.reduce((a, b) => a + b.final, 0) / reg.evaluations.length
        : 0;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`Média geral: ${overallAvg.toFixed(2)}`, 20, cursorY);
      if (reg.classificacao_final) {
        doc.text(`Classificação: ${reg.classificacao_final}° lugar`, pageWidth - 20, cursorY, { align: 'right' });
      }
      cursorY += 8;

      reg.evaluations.forEach((ev) => {
        if (cursorY > pageHeight - 50) { doc.addPage(); cursorY = 20; }

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 0, 104);
        doc.text(`${ev.judge_name}`, 20, cursorY);
        doc.setTextColor(40, 40, 40);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Média: ${ev.final.toFixed(2)}`, pageWidth - 20, cursorY, { align: 'right' });
        cursorY += 3;

        const scoreRows = Object.entries(ev.scores).map(([crit, val]) => [crit, Number(val).toFixed(1)]);
        if (scoreRows.length > 0) {
          autoTable(doc, {
            head: [['Quesito', 'Nota']],
            body: scoreRows,
            startY: cursorY,
            theme: 'striped',
            headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 9, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: 40 },
            alternateRowStyles: { fillColor: [248, 248, 250] },
            columnStyles: { 1: { cellWidth: 24, halign: 'center', fontStyle: 'bold' } },
            margin: { left: 20, right: 20 },
          });
          cursorY = (doc as any).lastAutoTable.finalY + 5;
        }

        if (ev.feedback_text && ev.feedback_text.trim()) {
          if (cursorY > pageHeight - 40) { doc.addPage(); cursorY = 20; }
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(120, 120, 120);
          doc.text('COMENTÁRIO DO JURADO', 20, cursorY);
          cursorY += 4;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(40, 40, 40);
          const lines = doc.splitTextToSize(ev.feedback_text.trim(), pageWidth - 40);
          doc.text(lines, 20, cursorY);
          cursorY += lines.length * 4.5 + 4;
        }

        if (ev.audio_url) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(120, 120, 120);
          doc.text('Há comentário em áudio disponível no app (botão "Baixar áudio").', 20, cursorY);
          doc.setTextColor(40, 40, 40);
          cursorY += 6;
        }

        cursorY += 4;
      });

      // Rodapé
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(140, 140, 140);
        const dateStr = `${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR').slice(0, 5)}`;
        doc.text(`Gerado em ${dateStr} • CoreoHub`, 20, pageHeight - 8);
        doc.text(`Página ${i} de ${totalPages}`, pageWidth - 20, pageHeight - 8, { align: 'right' });
      }

      doc.save(`avaliacao-${slugify(reg.nome_coreografia)}.pdf`);
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      setError('Falha ao gerar o PDF. Tente novamente.');
    } finally {
      setGeneratingPdf(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-[#ff0068] animate-spin" />
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Buscando seus resultados...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
          Meus <span className="text-[#ff0068]">Resultados</span>
        </h1>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
          Avaliações e notas das suas inscrições
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <Music size={64} className="text-slate-300 dark:text-slate-700" />
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">Nenhum resultado ainda</h2>
            <p className="text-slate-500 text-sm mt-2 max-w-md">
              Quando você tiver inscrições avaliadas em festivais, as notas e feedback aparecem aqui.
            </p>
          </div>
          <Link
            to="/festivais"
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all"
          >
            <Search size={14} /> Ver festivais disponíveis
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {registrations.map((reg, idx) => {
            const overallAvg = reg.evaluations.length > 0
              ? reg.evaluations.reduce((a, b) => a + b.final, 0) / reg.evaluations.length
              : null;
            const isPublished = reg.resultado_publicado;
            const isExpanded = expandedId === reg.id;

            return (
              <motion.div
                key={reg.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                className={`bg-white dark:bg-white/5 border rounded-3xl overflow-hidden transition-all shadow-sm ${
                  isExpanded
                    ? 'border-[#ff0068]/40'
                    : 'border-slate-200 dark:border-white/10'
                }`}
              >
                {/* Card header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isPublished ? 'bg-[#ff0068]/10 dark:bg-[#ff0068]/20 text-[#ff0068]' : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600'}`}>
                    {isPublished ? <Trophy size={24} /> : <Music size={24} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{reg.nome_coreografia}</p>
                    <p className="text-[9px] font-bold text-slate-500 uppercase">{reg.estudio} • {reg.categoria} • {reg.estilo_danca}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {isPublished && overallAvg != null ? (
                      <div className="text-right">
                        <ScoreBadge score={overallAvg} />
                        {reg.classificacao_final && (
                          <p className="text-[9px] font-black text-slate-500 uppercase mt-1">
                            {reg.classificacao_final}° lugar
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                        {reg.evaluations.length > 0 ? 'Aguardando publicação' : 'Sem avaliação'}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>

                {/* Expanded evaluations */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-slate-200 dark:border-white/10"
                    >
                      <div className="p-6 space-y-4">
                        {reg.evaluations.length === 0 ? (
                          <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest text-center py-4">
                            Nenhuma avaliação registrada ainda
                          </p>
                        ) : (
                          reg.evaluations.map((ev, i) => (
                            <div key={i} className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/5 rounded-2xl p-4 space-y-3">
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Award size={14} className="text-[#ff0068]" />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">{ev.judge_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {ev.audio_url && (
                                    <>
                                      <button
                                        onClick={() => playAudio(ev.audio_url!)}
                                        aria-label={playingAudio === ev.audio_url ? 'Pausar comentário em áudio' : 'Reproduzir comentário em áudio do jurado'}
                                        className={`p-2.5 rounded-xl transition-all ${playingAudio === ev.audio_url ? 'bg-[#ff0068] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-[#ff0068]'}`}
                                      >
                                        <Volume2 size={14} />
                                      </button>
                                      <button
                                        onClick={() => downloadAudio(ev.audio_url!, reg.nome_coreografia, ev.judge_name)}
                                        disabled={downloadingAudio === ev.audio_url}
                                        aria-label="Baixar comentário em áudio do jurado"
                                        title="Baixar áudio"
                                        className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-[#ff0068] transition-all disabled:opacity-50"
                                      >
                                        {downloadingAudio === ev.audio_url
                                          ? <Loader2 size={14} className="animate-spin" />
                                          : <Download size={14} />
                                        }
                                      </button>
                                      <button
                                        onClick={() => shareAudio(ev.audio_url!, reg.nome_coreografia, ev.judge_name)}
                                        disabled={sharingAudio === ev.audio_url}
                                        aria-label="Compartilhar comentário em áudio do jurado"
                                        title="Compartilhar"
                                        className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-[#ff0068] transition-all disabled:opacity-50"
                                      >
                                        {sharingAudio === ev.audio_url
                                          ? <Loader2 size={14} className="animate-spin" />
                                          : <Share2 size={14} />
                                        }
                                      </button>
                                      {isPublished && !ev.audio_transcript && (
                                        <button
                                          onClick={() => transcribeAudio(ev.id)}
                                          disabled={transcribingId === ev.id}
                                          aria-label="Transcrever comentário em áudio pra texto"
                                          title="Transcrever pra texto (IA)"
                                          className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-[#ff0068] transition-all disabled:opacity-50"
                                        >
                                          {transcribingId === ev.id
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Captions size={14} />
                                          }
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {isPublished && <ScoreBadge score={ev.final} />}
                                </div>
                              </div>

                              {isPublished && Object.keys(ev.scores).length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                  {Object.entries(ev.scores).map(([criterion, val]) => (
                                    <div key={criterion} className="flex justify-between items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2">
                                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-widest">{criterion}</span>
                                      <span className="text-sm font-black text-slate-900 dark:text-white">{Number(val).toFixed(1)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {ev.feedback_text && ev.feedback_text.trim() && (
                                <div className="flex gap-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5">
                                  <MessageSquare size={13} className="text-[#ff0068] shrink-0 mt-0.5" />
                                  <p className="flex-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{ev.feedback_text.trim()}</p>
                                  <button
                                    onClick={() => shareFeedbackText(reg.nome_coreografia, ev.judge_name, ev.feedback_text!.trim())}
                                    aria-label="Compartilhar comentário do jurado no WhatsApp"
                                    title="Compartilhar"
                                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-[#ff0068] transition-all"
                                  >
                                    <Share2 size={13} />
                                  </button>
                                </div>
                              )}

                              {/* Transcrição do áudio — cacheada em audio_transcript, gerada
                                  sob demanda pelo botão de legenda ao lado do player. */}
                              {ev.audio_transcript && ev.audio_transcript.trim() && (
                                <div className="flex gap-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5">
                                  <Captions size={13} className="text-[#ff0068] shrink-0 mt-0.5" />
                                  <div className="flex-1">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Transcrição do áudio (IA)</p>
                                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{ev.audio_transcript.trim()}</p>
                                  </div>
                                  <button
                                    onClick={() => shareFeedbackText(reg.nome_coreografia, ev.judge_name, ev.audio_transcript!.trim())}
                                    aria-label="Compartilhar transcrição do áudio no WhatsApp"
                                    title="Compartilhar"
                                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-[#ff0068] transition-all"
                                  >
                                    <Share2 size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}

                        {/* Baixar folha de avaliação (PDF) — só com resultado publicado,
                            já que o PDF contém as notas por quesito. */}
                        {isPublished && reg.evaluations.length > 0 && (
                          <button
                            onClick={() => downloadPdf(reg)}
                            disabled={generatingPdf === reg.id}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                          >
                            {generatingPdf === reg.id
                              ? <><Loader2 size={14} className="animate-spin" /> Gerando PDF...</>
                              : <><FileText size={14} /> Baixar folha de avaliação (PDF)</>
                            }
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyResults;
