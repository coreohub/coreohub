import React, { useEffect, useState, useMemo } from 'react';
import {
  Search, Download, RefreshCw,
  Trash2, Pencil, AlertTriangle, X, DollarSign,
  ShieldAlert, CheckCircle2, Clock, Users, Info,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { motion, AnimatePresence } from 'motion/react';

const Registrations = () => {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [filteredRegistrations, setFilteredRegistrations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [tab, setTab] = useState<'LIST' | 'TRIAGEM'>('LIST');
  const [reviewingReg, setReviewingReg] = useState<any>(null);

  /* tolerance + config loaded once */
  const [toleranceRule, setToleranceRule] = useState<{ mode: 'PERCENT' | 'COUNT'; value: number }>({ mode: 'PERCENT', value: 20 });
  const [ageRefMode, setAgeRefMode] = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefFixed, setAgeRefFixed] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [triageAction, setTriageAction] = useState<{ reg: any; decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY' } | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [
        { data, error },
        { data: cfg },
      ] = await Promise.all([
        supabase.from('registrations').select('*').order('criado_em', { ascending: false }),
        supabase.from('configuracoes').select('tolerancia,age_reference,age_reference_date,data_evento').eq('id', 1).single(),
      ]);
      if (error) throw error;
      setRegistrations(data || []);
      setFilteredRegistrations(data || []);

      if (cfg?.tolerancia) setToleranceRule(cfg.tolerancia);
      if (cfg?.age_reference) setAgeRefMode(cfg.age_reference as 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE');
      if (cfg?.age_reference_date) setAgeRefFixed(cfg.age_reference_date);
      if (cfg?.data_evento) setEventDate(cfg.data_evento);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    const { error } = await supabase.from('registrations').update({ status: 'APROVADA', status_pagamento: 'CONFIRMADO' }).eq('id', id);
    if (error) return;
    setRegistrations(prev => prev.map(reg => reg.id === id ? { ...reg, status: 'APROVADA', status_pagamento: 'CONFIRMADO' } : reg));
    setReviewingReg(null);
  };

  /* age-tolerance helpers */
  const resolveRefDate = (regEventDate?: string): string => {
    const base = regEventDate || eventDate || new Date().toISOString().slice(0, 10);
    if (ageRefMode === 'YEAR_END') {
      const year = new Date(base + 'T12:00:00').getFullYear();
      return `${year}-12-31`;
    }
    if (ageRefMode === 'FIXED_DATE' && ageRefFixed) return ageRefFixed;
    return base;
  };

  const calcAge = (dob: string, refDate: string) => {
    const birth = new Date(dob + 'T00:00:00');
    const ref = new Date(refDate + 'T00:00:00');
    let age = ref.getFullYear() - birth.getFullYear();
    const m = ref.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
    return age;
  };

  /**
   * Checks if a registration violates the age tolerance rule.
   * Returns { violates: boolean, outCount: number, totalCount: number, pct: number }
   */
  const checkViolation = (reg: any) => {
    const bailarinos: any[] = reg.bailarinos_detalhes || [];
    if (!bailarinos.length || !reg.cat_min_age || !reg.cat_max_age) {
      return { violates: false, outCount: 0, totalCount: bailarinos.length, pct: 0 };
    }
    const refDate = resolveRefDate(reg.event_data);
    const outOfRange = bailarinos.filter(b => {
      if (!b.data_nascimento) return false;
      const age = calcAge(b.data_nascimento, refDate);
      return age < reg.cat_min_age || age > reg.cat_max_age;
    });
    const outCount = outOfRange.length;
    const totalCount = bailarinos.length;
    const pct = totalCount > 0 ? (outCount / totalCount) * 100 : 0;

    let violates = false;
    if (toleranceRule.mode === 'PERCENT') violates = pct > toleranceRule.value;
    else violates = outCount > toleranceRule.value;

    return { violates, outCount, totalCount, pct, outOfRange };
  };

  /* registrations that actually have a violation */
  const violatingRegs = useMemo(() => {
    return registrations
      .filter(r => r.status_pagamento === 'CONFIRMADO')
      .filter(r => {
        const { violates } = checkViolation(r);
        return violates;
      })
      .map(r => ({ ...r, _violation: checkViolation(r) }));
  }, [registrations, toleranceRule, ageRefMode, ageRefFixed, eventDate]); // eslint-disable-line

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    let result = registrations;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(reg => reg.nome_coreografia?.toLowerCase().includes(term) || reg.estudio?.toLowerCase().includes(term));
    }
    if (paymentFilter !== 'ALL') {
      result = result.filter(reg => reg.status_pagamento === paymentFilter);
    }
    setFilteredRegistrations(result);
  }, [searchTerm, paymentFilter, registrations]);

  const handleTriageDecision = async (regId: string, decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY') => {
    let update: any = { penalidade_status: 'RESOLVIDO' };
    if (decision === 'APPROVE')     update = { ...update, penalidade_aplicada: 'NENHUMA' };
    if (decision === 'PENALIZE')    update = { ...update, penalidade_aplicada: 'DESCONTO_NOTA' };
    if (decision === 'DISQUALIFY')  update = { ...update, status: 'DESCLASSIFICADA', penalidade_aplicada: 'DESCLASSIFICACAO' };
    await supabase.from('registrations').update(update).eq('id', regId);
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, ...update } : r));
    setTriageAction(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONFIRMADO': return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
      case 'PENDENTE': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
      default: return 'bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">Gestão de <span className="text-[#ff0068]">Inscrições</span></h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Controle mestre do festival</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button className="px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20">
            <Download size={16} className="inline mr-2" /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex gap-4 border-b border-slate-200 dark:border-white/5">
        {['LIST', 'TRIAGEM'].map((t: any) => (
          <button key={t} onClick={() => setTab(t)} className={`pb-4 px-2 text-[10px] font-black uppercase tracking-widest transition-all relative ${tab === t ? 'text-[#ff0068]' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
            {t === 'LIST' ? 'Lista Geral' : 'Triagem de Regulamento'}
            {tab === t && <motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-1 bg-[#ff0068] rounded-full" />}
          </button>
        ))}
      </div>

      {tab === 'LIST' ? (
        <div className="space-y-6">
          <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-200 dark:border-white/5 flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input type="text" placeholder="Buscar coreografia ou estúdio..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]" />
            </div>
            <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068]">
              <option value="ALL">Pagamento: Todos</option>
              <option value="CONFIRMADO">Confirmado</option>
              <option value="PENDENTE">Pendente</option>
            </select>
          </div>

          <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm dark:shadow-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                  <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Coreografia</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Estúdio</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Categoria</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Pagamento</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {isLoading ? (
                  <tr><td colSpan={5} className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-[#ff0068]" size={32} /></td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr><td colSpan={5} className="py-20 text-center text-slate-500 font-black uppercase text-xs">Nenhuma inscrição encontrada</td></tr>
                ) : filteredRegistrations.map(reg => (
                  <tr key={reg.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                    <td className="px-8 py-6">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight">{reg.nome_coreografia}</p>
                      <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest">{reg.tipo_apresentacao}</p>
                    </td>
                    <td className="px-8 py-6 text-xs font-bold text-slate-600 dark:text-slate-300">{reg.estudio}</td>
                    <td className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">{reg.categoria}</td>
                    <td className="px-8 py-6 text-center">
                      <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusColor(reg.status_pagamento)}`}>{reg.status_pagamento}</span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex justify-end gap-2">
                        {reg.status_pagamento === 'PENDENTE' && <button onClick={() => setReviewingReg(reg)} className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-500 hover:text-white transition-all"><DollarSign size={16} /></button>}
                        <button className="p-2 text-slate-500 hover:text-[#ff0068] transition-all"><Pencil size={16} /></button>
                        <button className="p-2 text-slate-500 hover:text-rose-500 transition-all"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── TRIAGEM DE REGULAMENTO ── */
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
            <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Regra Ativa</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-300 mt-0.5">
                Tolerância: {toleranceRule.mode === 'PERCENT'
                  ? `até ${toleranceRule.value}% do grupo fora da faixa etária`
                  : `até ${toleranceRule.value} participante(s) fora da faixa etária`}
                {' · '}Referência: {ageRefMode === 'EVENT_DAY' ? 'data do evento' : ageRefMode === 'YEAR_END' ? '31/12 do ano' : ageRefFixed || 'data fixa'}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center"><RefreshCw className="animate-spin text-[#ff0068]" size={28} /></div>
          ) : violatingRegs.length === 0 ? (
            <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-[3rem]">
              <CheckCircle2 className="mx-auto text-emerald-500 mb-4" size={40} />
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhuma infração pendente de triagem</p>
              <p className="text-[10px] text-slate-400 mt-1">Todas as inscrições confirmadas estão dentro da tolerância configurada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                {violatingRegs.length} inscrição(ões) aguardando decisão
              </p>
              {violatingRegs.map(reg => (
                <div
                  key={reg.id}
                  className="bg-white dark:bg-slate-900/50 border border-amber-300/40 dark:border-amber-500/20 rounded-3xl p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-2xl flex items-center justify-center shrink-0">
                      <ShieldAlert size={18} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase truncate">{reg.nome_coreografia || '—'}</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest">{reg.estudio} · {reg.categoria}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Users size={10} className="text-amber-500" />
                        <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                          {reg._violation.outCount}/{reg._violation.totalCount} fora da faixa
                          {' '}({reg._violation.pct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'APPROVE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all"
                    >
                      <CheckCircle2 size={12} /> Aprovar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'PENALIZE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-amber-500 hover:text-white transition-all"
                    >
                      <Clock size={12} /> Penalizar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'DISQUALIFY' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all"
                    >
                      <AlertTriangle size={12} /> Desclassificar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {/* ── Triage decision modal ── */}
        {triageAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTriageAction(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
                  {triageAction.decision === 'APPROVE'    && <span className="text-emerald-500">Aprovar</span>}
                  {triageAction.decision === 'PENALIZE'   && <span className="text-amber-500">Penalizar</span>}
                  {triageAction.decision === 'DISQUALIFY' && <span className="text-rose-500">Desclassificar</span>}
                </h2>
                <button onClick={() => setTriageAction(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={20} /></button>
              </div>
              <div className="p-8 space-y-5">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                  <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest">Inscrição</p>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase mt-1">{triageAction.reg.nome_coreografia || '—'}</p>
                  <p className="text-[9px] text-amber-500 font-black uppercase mt-0.5">
                    {triageAction.reg._violation.outCount} fora da faixa etária
                    {' '}({triageAction.reg._violation.pct.toFixed(0)}%)
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {triageAction.decision === 'APPROVE'    && 'A inscrição será aprovada com exceção de tolerância registrada.'}
                  {triageAction.decision === 'PENALIZE'   && 'Uma penalidade de desconto de nota será aplicada na avaliação.'}
                  {triageAction.decision === 'DISQUALIFY' && 'A inscrição será desclassificada e não concorrerá a resultados.'}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setTriageAction(null)} className="flex-1 py-3 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleTriageDecision(triageAction.reg.id, triageAction.decision)}
                    className={`flex-1 py-3 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                      triageAction.decision === 'APPROVE'    ? 'bg-emerald-500 shadow-emerald-500/20 hover:scale-105' :
                      triageAction.decision === 'PENALIZE'   ? 'bg-amber-500 shadow-amber-500/20 hover:scale-105' :
                      'bg-rose-500 shadow-rose-500/20 hover:scale-105'
                    }`}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reviewingReg && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReviewingReg(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">Auditoria <span className="text-[#ff0068]">Financeira</span></h2>
                <button onClick={() => setReviewingReg(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Coreografia</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white uppercase">{reviewingReg.nome_coreografia}</p>
                </div>
                <div className="p-4 bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl flex justify-between items-center">
                  <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">Valor Total</span>
                  <span className="text-xl font-black text-[#ff0068]">R$ {reviewingReg.valor_total || '0,00'}</span>
                </div>
                <button onClick={() => handleApprove(reviewingReg.id)} className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl shadow-emerald-500/20">Confirmar Recebimento</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Registrations;
