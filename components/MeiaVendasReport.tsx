import React, { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { supabase } from '../services/supabase';

/**
 * Relatório de meia-entrada da venda encerrada (Decreto 13.108/2026 art. 11 p.ú. e
 * Decreto 8.537/2015 art. 12): total vendido, quantos como meia e o percentual, sem
 * dado pessoal. Publicado desde o dia seguinte ao fim do evento (prazo legal: 30 dias)
 * e nunca retirado. Vitrine pública em fundo escuro. Sempre renderiza (empty state visível).
 */
interface Report {
  event_end: string;
  total_vendidos: number;
  meia_vendidos: number;
  percentual: number | string;
  por_tipo: Array<{ nome: string; meia: boolean; quantidade: number }>;
  cortesias: number;
  gerado_em: string;
}

const fmtDay = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const MeiaVendasReport: React.FC<{ eventId: string }> = ({ eventId }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_meia_report', { p_event_id: eventId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.warn('[MeiaVendasReport] get_meia_report:', error.message); setState('unavailable'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) { setReport(row as Report); setState('ready'); } else setState('unavailable');
    });
    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <section aria-labelledby="meia-report-title" className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <h3 id="meia-report-title" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
        <BarChart3 size={14} className="text-[#1de7f2]" /> Relatório de meia-entrada
      </h3>
      {state === 'loading' && <p className="mt-2 text-xs text-slate-400">Carregando relatório...</p>}
      {state === 'unavailable' && (
        <p className="mt-2 text-xs text-slate-400">O relatório da venda de ingressos deste evento não está disponível no momento.</p>
      )}
      {state === 'ready' && report && (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">
            Encerrado em {fmtDay(report.event_end)}: foram vendidos <strong>{report.total_vendidos}</strong> ingressos, sendo{' '}
            <strong>{report.meia_vendidos}</strong> de meia-entrada (<strong>{String(report.percentual).replace('.', ',')}%</strong> das vendas).
          </p>
          {report.por_tipo.length > 0 && (
            <ul className="divide-y divide-white/5 text-xs text-slate-300">
              {report.por_tipo.map(t => (
                <li key={t.nome} className="flex items-center justify-between py-1.5">
                  <span>{t.nome}{t.meia ? ' (meia-entrada)' : ''}</span>
                  <span className="tabular-nums font-bold">{t.quantidade}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-slate-500 leading-snug">
            Contam ingressos vendidos e confirmados; estornados e convertidos em crédito ficam de fora
            {report.cortesias > 0 ? `, e ${report.cortesias} cortesia(s) não entram como venda` : ''}. Relatório sem dados pessoais,
            conforme o Decreto nº 13.108/2026, art. 11, parágrafo único.
          </p>
        </div>
      )}
    </section>
  );
};

export default MeiaVendasReport;
