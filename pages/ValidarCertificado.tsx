/**
 * ValidarCertificado — Página pública (sem login) que valida autenticidade
 * de um certificado pelo hash. Acessada via QR no PDF: /validar-certificado/<uuid>
 *
 * Etapa 2 — RPC validate_certificate retorna dados não-sensíveis ou
 * { found: false } se o hash não existe no banco.
 *
 * Padrão Even3/Sympla/Doity: recrutador escaneia QR → vê dados públicos.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  CheckCircle, AlertCircle, Loader2, Calendar, Award, GraduationCap, Music2,
  ShieldCheck,
} from 'lucide-react';

interface ValidationResult {
  found: boolean;
  recipient_name: string | null;
  template_type: 'mostra' | 'workshop' | null;
  evento_nome: string | null;
  evento_data: string | null;
  modalidade: string | null;
  classificacao: string | null;
  professor_nome: string | null;
  workshop_nome: string | null;
  issued_at: string | null;
  validation_hash: string | null;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const ValidarCertificado: React.FC = () => {
  const { hash } = useParams<{ hash: string }>();
  const [result, setResult]   = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hash) {
      setLoading(false);
      setResult({ found: false } as ValidationResult);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc('validate_certificate', { p_hash: hash });
      if (error) {
        console.error(error);
        setResult({ found: false } as ValidationResult);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setResult(row as ValidationResult);
      }
      setLoading(false);
    })();
  }, [hash]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b0b0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  const valid = result?.found === true;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50/30 to-slate-50 dark:from-[#0b0b0f] dark:via-purple-950/20 dark:to-[#0b0b0f] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Brand */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <div className="bg-[#ff0068] p-1.5 rounded-lg text-white shadow-[0_0_15px_rgba(255,0,104,0.3)]">
              <Music2 size={16} />
            </div>
            <span className="tracking-tighter uppercase font-black text-base text-slate-900 dark:text-white">Coreo<span className="text-[#ff0068]">Hub</span></span>
          </Link>
          <p className="mt-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
            <ShieldCheck size={12} />Validação de certificado
          </p>
        </div>

        {valid ? (
          <div className="rounded-3xl bg-white dark:bg-white/5 border border-emerald-200 dark:border-emerald-500/30 shadow-xl overflow-hidden">
            {/* Header verde */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-8 text-white">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 backdrop-blur p-2.5 rounded-full">
                  <CheckCircle size={32} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest opacity-90">Certificado autêntico</p>
                  <h1 className="text-xl font-black mt-0.5">Documento validado pela CoreoHub</h1>
                </div>
              </div>
            </div>

            {/* Dados */}
            <div className="p-6 space-y-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Concedido a</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white">{result?.recipient_name ?? '—'}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Tipo" value={
                  result?.template_type === 'workshop'
                    ? <span className="inline-flex items-center gap-1"><GraduationCap size={13} />Workshop</span>
                    : <span className="inline-flex items-center gap-1"><Award size={13} />Mostra</span>
                } />
                {result?.evento_nome && <Field label="Evento" value={result.evento_nome} />}
                {result?.evento_data && <Field label="Data do evento" value={fmtDate(result.evento_data)} />}
                {result?.workshop_nome && <Field label="Workshop" value={result.workshop_nome} />}
                {result?.professor_nome && <Field label="Professor" value={result.professor_nome} />}
                {result?.modalidade && <Field label="Modalidade" value={result.modalidade} />}
                {result?.classificacao && <Field label="Classificação" value={result.classificacao} highlight />}
              </div>

              <div className="border-t border-slate-200 dark:border-white/10 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-0.5">Emitido em</p>
                  <p className="text-slate-700 dark:text-slate-300 font-bold inline-flex items-center gap-1.5">
                    <Calendar size={12} />{fmtDateTime(result?.issued_at ?? null)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-0.5">Código</p>
                  <p className="font-mono text-slate-700 dark:text-slate-300 break-all text-[11px]">{result?.validation_hash ?? '—'}</p>
                </div>
              </div>

              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-4 text-xs text-emerald-800 dark:text-emerald-200">
                <p className="font-bold mb-1">Como funciona a validação?</p>
                <p className="leading-relaxed">
                  Este certificado foi emitido pela plataforma CoreoHub a partir da inscrição confirmada do participante. O código único acima só existe se o documento for autêntico. Para confirmar a emissão, contate o produtor do evento.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl bg-white dark:bg-white/5 border border-rose-200 dark:border-rose-500/30 shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-rose-500 to-rose-600 px-6 py-8 text-white">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 backdrop-blur p-2.5 rounded-full">
                  <AlertCircle size={32} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest opacity-90">Certificado não encontrado</p>
                  <h1 className="text-xl font-black mt-0.5">Documento inválido ou inexistente</h1>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                O código informado não corresponde a nenhum certificado emitido pela CoreoHub.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                Possíveis causas: link com erro de digitação, hash incompleto, ou certificado falso.
                Se você recebeu este link de uma fonte oficial, entre em contato com o produtor do evento.
              </p>
              {hash && (
                <div className="mt-4 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 text-[11px]">
                  <p className="font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Código verificado</p>
                  <p className="font-mono text-slate-700 dark:text-slate-300 break-all">{hash}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-[10px] text-slate-500 dark:text-slate-500 mt-6">
          Validação fornecida por <Link to="/" className="text-[#ff0068] font-bold">CoreoHub</Link> · Gestão Inteligente para Festivais de Dança
        </p>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: React.ReactNode; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div>
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
    <p className={`text-sm font-bold ${highlight ? 'text-amber-600 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>{value}</p>
  </div>
);

export default ValidarCertificado;
