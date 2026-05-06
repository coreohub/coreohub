/**
 * MeusCertificados — Lista de certificados do inscrito logado.
 *
 * Etapa 2 — modelo lazy-cache:
 *   • RPC list_my_certificates retorna lista (sem PDF — só metadados).
 *   • Click "Baixar" → invoca get-certificate-pdf que gera (1ª vez) ou
 *     retorna signed URL cacheada.
 *   • bump_certificate_download é chamado após download bem-sucedido.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  Award, GraduationCap, Loader2, Download, ExternalLink, AlertCircle, CheckCircle, Calendar,
} from 'lucide-react';

interface MyCert {
  id: string;
  template_type: 'mostra' | 'workshop';
  recipient_name: string;
  evento_nome: string | null;
  evento_data: string | null;
  modalidade: string | null;
  classificacao: string | null;
  workshop_nome: string | null;
  has_pdf: boolean;
  validation_hash: string;
  issued_at: string;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const MeusCertificados: React.FC = () => {
  const [certs, setCerts]     = useState<MyCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setEmailVerified(!!user?.email_confirmed_at);
    const { data, error } = await supabase.rpc('list_my_certificates');
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
    } else {
      setCerts((data ?? []) as MyCert[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Q2.4 — bloqueio de download sem e-mail verificado.
   * Certificado tem validade pública (QR + nome). Garantir que o nome bate
   * com identidade verificada é razoável aqui — diferente de checkout puro. */
  const handleResendVerify = async () => {
    setResending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Usuário sem e-mail.');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: { emailRedirectTo: `${window.location.origin}/meus-certificados` },
      });
      if (error) throw error;
      setFeedback({ kind: 'ok', msg: 'Link de verificação reenviado pro seu e-mail.' });
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? 'Erro ao reenviar.' });
    } finally {
      setResending(false);
    }
  };

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4500);
    return () => clearTimeout(t);
  }, [feedback]);

  const downloadPdf = async (cert: MyCert) => {
    // M3: cobre null (loading) E false. Evita bypass por click rápido antes
    // de getUser concluir. Backend (get-certificate-pdf) deve garantir bloqueio.
    if (!emailVerified) {
      setFeedback({ kind: 'err', msg: 'Confirme seu e-mail antes de baixar o certificado. Enviamos o link pra você.' });
      return;
    }
    setDownloading(cert.id);
    try {
      const { data, error } = await supabase.functions.invoke('get-certificate-pdf', {
        body: { certificate_id: cert.id },
      });
      if (error) throw new Error(error.message ?? 'Erro');
      if (data?.error) throw new Error(data.error);
      if (!data?.signed_url) throw new Error('URL não retornada');

      // Trigger download
      const a = document.createElement('a');
      a.href = data.signed_url;
      a.download = `certificado-${cert.recipient_name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Bump telemetria
      await supabase.rpc('bump_certificate_download', { p_cert_id: cert.id });

      // Atualiza UI pra refletir has_pdf=true caso fosse 1ª vez
      setCerts(curr => curr.map(c => c.id === cert.id ? { ...c, has_pdf: true } : c));
      setFeedback({ kind: 'ok', msg: 'Download iniciado' });
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? String(e) });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b0b0f] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <Award className="text-[#ff0068]" size={28} />
            Meus certificados
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Certificados de mostras e workshops que você participou. Baixe quando quiser.
          </p>
        </div>

        {feedback && (
          <div className={`mb-4 rounded-xl border p-3 text-sm flex items-center gap-2 ${feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'}`}>
            {feedback.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {feedback.msg}
          </div>
        )}

        {/* Q2.4 — bloqueio só pra ações sensíveis. Mostra aviso quando user
            tem certificado disponível mas não verificou e-mail. */}
        {emailVerified === false && certs.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-black text-amber-800 dark:text-amber-200">
                  Confirme seu e-mail pra baixar certificado
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  O nome no certificado precisa bater com a identidade verificada — exigência pra validade pública.
                </p>
              </div>
            </div>
            <button
              onClick={handleResendVerify}
              disabled={resending}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {resending ? <Loader2 size={12} className="animate-spin" /> : 'Reenviar link'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
        ) : certs.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/10 p-12 text-center">
            <Award size={40} className="mx-auto text-slate-400 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-bold">Nenhum certificado disponível ainda</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Os certificados aparecem aqui depois que o produtor do evento emitir.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {certs.map(c => (
              <div key={c.id} className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${c.template_type === 'workshop' ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300' : 'bg-[#ff0068]/15 text-[#ff0068]'}`}>
                        {c.template_type === 'workshop' ? <GraduationCap size={11} /> : <Award size={11} />}
                        {c.template_type === 'workshop' ? 'Workshop' : 'Mostra'}
                      </span>
                      {c.classificacao && (
                        <span className="text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full">{c.classificacao}</span>
                      )}
                    </div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">{c.recipient_name}</h3>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {c.workshop_nome && <p>{c.workshop_nome}</p>}
                      {c.evento_nome && <p className="text-xs text-slate-500 dark:text-slate-500">{c.evento_nome}</p>}
                      {c.modalidade && <span className="text-xs text-slate-500">{c.modalidade}</span>}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 inline-flex items-center gap-1">
                      <Calendar size={11} />Emitido em {fmtDate(c.issued_at?.slice(0, 10))}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`/validar-certificado/${c.validation_hash}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      <ExternalLink size={12} />Validar
                    </a>
                    <button
                      onClick={() => downloadPdf(c)}
                      disabled={downloading === c.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0068] hover:bg-[#ff1a78] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {downloading === c.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {c.has_pdf ? 'Baixar' : 'Gerar e baixar'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MeusCertificados;
