import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import PageHeader from '../components/PageHeader';
import SuperAdminMfaGate from '../components/SuperAdminMfaGate';
import { maskMoeda, parseMoeda } from '../utils/masks';
import {
  Calculator, Settings, FileText, Plus, Trash2, Pencil, Save, Download,
  Loader2, X, Check, DollarSign, Users, Calendar, Wifi, ClipboardList,
  Sparkles, ListChecks,
} from 'lucide-react';

/**
 * Ferramenta INTERNA (Super Admin) de cotação avulsa do Terminal de Júri +
 * Operador CoreoHub — venda fora do modelo de comissão padrão, pra produtor
 * cujo evento roda em outra plataforma. Não é formulário público: só quem
 * tem acesso ao Super Admin preenche, com os dados que o produtor passou.
 *
 * Deslocamento/hospedagem NÃO entra no cálculo — cidade/estado é só
 * informativo (produtor paga a própria passagem, decisão de produto
 * 2026-07-27). Escopo desta v1 é só terminal_operador — proposta de governo
 * é modelo de preço próprio ainda não decidido (quote_type reservado).
 */

interface PricingConfigRow {
  id: string;
  categoria: 'terminal' | 'operador' | 'setup';
  chave: string | null;
  label: string;
  qty_min: number | null;
  qty_max: number | null;
  valor_min: number;
  valor_max: number;
  unidade: string;
  ativo: boolean;
  ordem: number;
}

interface QuoteRow {
  id: string;
  status: 'rascunho' | 'enviado' | 'fechado' | 'perdido';
  nome_responsavel: string | null;
  nome_evento: string | null;
  email: string | null;
  whatsapp: string | null;
  cidade: string | null;
  estado: string | null;
  datas_evento: string | null;
  qtd_apresentacoes: number | null;
  qtd_jurados: number | null;
  qtd_dias_competicao: number | null;
  operador_modalidade: 'remoto' | 'presencial' | 'nenhum' | null;
  operador_dias: number | null;
  qtd_tablets_produtor: number | null;
  tem_internet_local: boolean | null;
  tem_planilha_pronta: boolean | null;
  tem_regulamento: boolean | null;
  lista_jurados_texto: string | null;
  pretende_migrar: boolean | null;
  valor_terminal: number | null;
  valor_setup: number | null;
  valor_operador: number | null;
  valor_total: number | null;
  observacoes: string | null;
  created_at: string;
}

const STATUS_META: Record<QuoteRow['status'], { label: string; color: string }> = {
  rascunho: { label: 'Rascunho', color: 'bg-slate-500/15 text-slate-400' },
  enviado:  { label: 'Enviado',  color: 'bg-sky-500/15 text-sky-500' },
  fechado:  { label: 'Fechado',  color: 'bg-emerald-500/15 text-emerald-500' },
  perdido:  { label: 'Perdido',  color: 'bg-rose-500/15 text-rose-500' },
};

const emptyQuoteForm = {
  nome_responsavel: '',
  nome_evento: '',
  email: '',
  whatsapp: '',
  cidade: '',
  estado: '',
  datas_evento: '',
  qtd_apresentacoes: '' as string | number,
  qtd_jurados: '' as string | number,
  qtd_dias_competicao: '' as string | number,
  operador_modalidade: 'presencial' as 'remoto' | 'presencial' | 'nenhum',
  operador_dias: '' as string | number,
  qtd_tablets_produtor: '' as string | number,
  tem_internet_local: false,
  tem_planilha_pronta: false,
  tem_regulamento: false,
  lista_jurados_texto: '',
  pretende_migrar: false,
  observacoes: '',
};

const Cotacoes: React.FC = () => {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'nova' | 'lista' | 'config'>('nova');

  const [config, setConfig] = useState<PricingConfigRow[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);

  const [form, setForm] = useState(emptyQuoteForm);
  const [valorTerminalText, setValorTerminalText] = useState('');
  const [valorSetupText, setValorSetupText] = useState('');
  const [valorOperadorText, setValorOperadorText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  /* ── acesso ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_super_admin, role')
        .eq('id', user.id)
        .single();
      setAuthorized(Boolean(profile?.is_super_admin) || profile?.role === 'COREOHUB_ADMIN');
    })();
  }, [navigate]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const { data, error } = await supabase
      .from('standalone_pricing_config')
      .select('*')
      .order('categoria')
      .order('ordem');
    if (error) console.error('Erro ao carregar config de preço:', error);
    setConfig((data as PricingConfigRow[]) ?? []);
    setConfigLoading(false);
  }, []);

  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true);
    const { data, error } = await supabase
      .from('standalone_quotes')
      .select('id, nome_evento, nome_responsavel, cidade, estado, qtd_apresentacoes, qtd_jurados, valor_total, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) console.error('Erro ao carregar cotações:', error);
    setQuotes((data as QuoteRow[]) ?? []);
    setQuotesLoading(false);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    loadConfig();
    loadQuotes();
  }, [authorized, loadConfig, loadQuotes]);

  /* ── cálculo sugerido ── */
  const pickTerminalTier = (qtd: number) =>
    config.find(c => c.categoria === 'terminal' && c.ativo &&
      (c.qty_min == null || qtd >= c.qty_min) &&
      (c.qty_max == null || qtd <= c.qty_max));

  const pickByChave = (chave: string) => config.find(c => c.chave === chave && c.ativo);

  const midpoint = (row?: PricingConfigRow) => row ? (row.valor_min + row.valor_max) / 2 : 0;

  const suggestion = useMemo(() => {
    const qtd = Number(form.qtd_apresentacoes) || 0;
    const terminalRow = qtd > 0 ? pickTerminalTier(qtd) : undefined;
    const setupRow = pickByChave('setup_cadastro');
    const operadorRow = form.operador_modalidade === 'nenhum'
      ? undefined
      : pickByChave(form.operador_modalidade === 'remoto' ? 'operador_remoto' : 'operador_presencial');
    const dias = Number(form.operador_dias) || 1;
    return {
      terminalRow,
      setupRow,
      operadorRow,
      valorTerminal: midpoint(terminalRow),
      valorSetup: midpoint(setupRow),
      valorOperadorDia: midpoint(operadorRow),
      valorOperador: form.operador_modalidade === 'nenhum' ? 0 : midpoint(operadorRow) * dias,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, form.qtd_apresentacoes, form.operador_modalidade, form.operador_dias]);

  const applySuggestion = () => {
    setValorTerminalText(suggestion.valorTerminal ? maskMoeda(String(Math.round(suggestion.valorTerminal * 100))) : '');
    setValorSetupText(suggestion.valorSetup ? maskMoeda(String(Math.round(suggestion.valorSetup * 100))) : '');
    setValorOperadorText(suggestion.valorOperador ? maskMoeda(String(Math.round(suggestion.valorOperador * 100))) : '');
  };

  const valorTerminalFinal = parseMoeda(valorTerminalText);
  const valorSetupFinal = parseMoeda(valorSetupText);
  const valorOperadorFinal = parseMoeda(valorOperadorText);
  const valorTotalFinal = valorTerminalFinal + valorSetupFinal + valorOperadorFinal;

  const resetForm = () => {
    setForm(emptyQuoteForm);
    setValorTerminalText('');
    setValorSetupText('');
    setValorOperadorText('');
    setSaveError(null);
    setSavedOk(false);
  };

  const handleSaveQuote = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        quote_type: 'terminal_operador',
        status: 'rascunho',
        nome_responsavel: form.nome_responsavel || null,
        nome_evento: form.nome_evento || null,
        email: form.email || null,
        whatsapp: form.whatsapp || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        datas_evento: form.datas_evento || null,
        qtd_apresentacoes: form.qtd_apresentacoes ? Number(form.qtd_apresentacoes) : null,
        qtd_jurados: form.qtd_jurados ? Number(form.qtd_jurados) : null,
        qtd_dias_competicao: form.qtd_dias_competicao ? Number(form.qtd_dias_competicao) : null,
        operador_modalidade: form.operador_modalidade,
        operador_dias: form.operador_dias ? Number(form.operador_dias) : null,
        qtd_tablets_produtor: form.qtd_tablets_produtor ? Number(form.qtd_tablets_produtor) : null,
        tem_internet_local: form.tem_internet_local,
        tem_planilha_pronta: form.tem_planilha_pronta,
        tem_regulamento: form.tem_regulamento,
        lista_jurados_texto: form.lista_jurados_texto || null,
        pretende_migrar: form.pretende_migrar,
        valor_terminal: valorTerminalFinal || null,
        valor_setup: valorSetupFinal || null,
        valor_operador: valorOperadorFinal || null,
        valor_total: valorTotalFinal || null,
        observacoes: form.observacoes || null,
        created_by: user?.id ?? null,
      };
      const { error } = await supabase.from('standalone_quotes').insert(payload);
      if (error) throw error;
      setSavedOk(true);
      await loadQuotes();
    } catch (e: any) {
      setSaveError(e?.message ?? 'Falha ao salvar a cotação.');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(255, 0, 104);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Proposta — Terminal de Júri + Operador CoreoHub', 14, 13);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `${form.nome_evento || 'Evento'}${form.cidade ? ` · ${form.cidade}${form.estado ? '/' + form.estado : ''}` : ''}${form.datas_evento ? ` · ${form.datas_evento}` : ''}`,
      14, 21,
    );

    let y = 38;
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Escopo do evento', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    y += 6;
    const escopoLines = [
      `Responsável: ${form.nome_responsavel || '—'}`,
      `Apresentações/coreografias: ${form.qtd_apresentacoes || '—'}`,
      `Jurados: ${form.qtd_jurados || '—'}`,
      `Dias de competição: ${form.qtd_dias_competicao || '—'}`,
      `Suporte técnico: ${form.operador_modalidade === 'nenhum' ? 'Não incluído' : form.operador_modalidade === 'remoto' ? 'Remoto' : 'Presencial'}${form.operador_modalidade !== 'nenhum' ? ` (${form.operador_dias || 1} dia(s))` : ''}`,
    ];
    escopoLines.forEach(line => { doc.text(line, 14, y); y += 5.5; });

    y += 4;
    const rows: string[][] = [];
    if (valorTerminalFinal > 0) rows.push(['Terminal de Júri (licença por evento)', maskMoeda(String(Math.round(valorTerminalFinal * 100)))]);
    if (valorSetupFinal > 0) rows.push(['Setup / cadastro manual', maskMoeda(String(Math.round(valorSetupFinal * 100)))]);
    if (valorOperadorFinal > 0) rows.push([`Operador CoreoHub (${form.operador_modalidade === 'remoto' ? 'remoto' : 'presencial'}, ${form.operador_dias || 1} dia(s))`, maskMoeda(String(Math.round(valorOperadorFinal * 100)))]);

    autoTable(doc, {
      head: [['Item', 'Valor']],
      body: rows,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [26, 26, 26], textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9.5, textColor: 40 },
      columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
      foot: [['Total', maskMoeda(String(Math.round(valorTotalFinal * 100)))]],
      footStyles: { fillColor: [255, 240, 246], textColor: [255, 0, 104], fontStyle: 'bold', fontSize: 10.5 },
      margin: { left: 14, right: 14 },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Condições:', 14, finalY);
    const condicoes = [
      '- Deslocamento, passagem e hospedagem da equipe da CoreoHub, quando presencial, são por conta do contratante.',
      '- Produtor/equipe fornece a lista de coreografias, ordem de apresentação, jurados e critérios de avaliação.',
      '- Proposta válida por 15 dias a partir da data de emissão.',
    ];
    let cy = finalY + 5;
    condicoes.forEach(line => { doc.text(line, 14, cy); cy += 4.5; });
    doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, 14, cy + 4);

    const slug = (form.nome_evento || 'evento')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    doc.save(`proposta-terminal-juri-${slug || 'evento'}.pdf`);
  };

  const handleStatusChange = async (id: string, status: QuoteRow['status']) => {
    setQuotes(qs => qs.map(q => q.id === id ? { ...q, status } : q));
    const { error } = await supabase.from('standalone_quotes').update({ status }).eq('id', id);
    if (error) { console.error(error); loadQuotes(); }
  };

  const handleDeleteQuote = async (id: string) => {
    if (!confirm('Excluir esta cotação? Não pode ser desfeito.')) return;
    const { error } = await supabase.from('standalone_quotes').delete().eq('id', id);
    if (error) { alert('Falha ao excluir: ' + error.message); return; }
    setQuotes(qs => qs.filter(q => q.id !== id));
  };

  /* ── config CRUD ── */
  const updateConfigField = (id: string, patch: Partial<PricingConfigRow>) => {
    setConfig(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const saveConfigRow = async (row: PricingConfigRow) => {
    const { error } = await supabase.from('standalone_pricing_config').update({
      label: row.label,
      qty_min: row.qty_min,
      qty_max: row.qty_max,
      valor_min: row.valor_min,
      valor_max: row.valor_max,
      unidade: row.unidade,
      ativo: row.ativo,
      ordem: row.ordem,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) { alert('Falha ao salvar: ' + error.message); return; }
    setConfig(cs => cs.map(c => c.id === row.id ? row : c));
  };

  const addConfigRow = async (categoria: PricingConfigRow['categoria']) => {
    const { data, error } = await supabase.from('standalone_pricing_config').insert({
      categoria,
      chave: null,
      label: 'Nova faixa',
      qty_min: null,
      qty_max: null,
      valor_min: 0,
      valor_max: 0,
      unidade: categoria === 'operador' ? 'dia' : 'evento',
      ativo: true,
      ordem: config.filter(c => c.categoria === categoria).length + 1,
    }).select().single();
    if (error) { alert('Falha ao criar faixa: ' + error.message); return; }
    setConfig(cs => [...cs, data as PricingConfigRow]);
  };

  const deleteConfigRow = async (id: string) => {
    if (!confirm('Remover esta faixa de preço?')) return;
    const { error } = await supabase.from('standalone_pricing_config').delete().eq('id', id);
    if (error) { alert('Falha ao remover: ' + error.message); return; }
    setConfig(cs => cs.filter(c => c.id !== id));
  };

  if (authorized === null) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 size={32} className="animate-spin text-[#ff0068]" /></div>;
  }
  if (authorized === false) {
    return <div className="max-w-lg mx-auto py-16 text-center text-slate-500">Acesso restrito ao Super Admin.</div>;
  }

  return (
    <SuperAdminMfaGate>
      <div className="max-w-6xl mx-auto space-y-6 pb-20">
        <PageHeader
          icon={<div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Calculator size={22} /></div>}
          title="Cotações — Terminal de Júri"
          subtitle="Venda avulsa fora do modelo de comissão — ferramenta interna"
        />

        <nav aria-label="Cotações" className="flex gap-2 border-b border-slate-200 dark:border-white/10 pb-px">
          {([
            { id: 'nova', label: 'Nova Cotação', icon: Sparkles },
            { id: 'lista', label: 'Cotações', icon: ListChecks },
            { id: 'config', label: 'Configurar Valores', icon: Settings },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-black uppercase tracking-widest border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[#ff0068] text-[#ff0068]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </nav>

        {tab === 'nova' && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Users size={13} /> Identificação</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Nome do responsável">
                    <input value={form.nome_responsavel} onChange={e => setForm(f => ({ ...f, nome_responsavel: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="Nome do evento/festival">
                    <input value={form.nome_evento} onChange={e => setForm(f => ({ ...f, nome_evento: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="E-mail">
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="WhatsApp">
                    <input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} className={inputCls} />
                  </Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Calendar size={13} /> Local e logística (informativo — sem custo de deslocamento)</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Cidade"><input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className={inputCls} /></Field>
                  <Field label="Estado"><input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} className={inputCls} maxLength={2} /></Field>
                  <Field label="Datas do evento"><input value={form.datas_evento} onChange={e => setForm(f => ({ ...f, datas_evento: e.target.value }))} placeholder="ex: 12 a 14/09/2026" className={inputCls} /></Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><ClipboardList size={13} /> Escopo do evento</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Nº de apresentações"><input type="text" inputMode="numeric" value={form.qtd_apresentacoes} onChange={e => setForm(f => ({ ...f, qtd_apresentacoes: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                  <Field label="Nº de jurados"><input type="text" inputMode="numeric" value={form.qtd_jurados} onChange={e => setForm(f => ({ ...f, qtd_jurados: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                  <Field label="Dias de competição"><input type="text" inputMode="numeric" value={form.qtd_dias_competicao} onChange={e => setForm(f => ({ ...f, qtd_dias_competicao: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Wifi size={13} /> Operador + Infraestrutura</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Suporte técnico">
                    <select value={form.operador_modalidade} onChange={e => setForm(f => ({ ...f, operador_modalidade: e.target.value as any }))} className={inputCls}>
                      <option value="presencial">Presencial</option>
                      <option value="remoto">Remoto</option>
                      <option value="nenhum">Não incluído</option>
                    </select>
                  </Field>
                  <Field label="Dias de suporte"><input type="text" inputMode="numeric" value={form.operador_dias} onChange={e => setForm(f => ({ ...f, operador_dias: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                  <Field label="Tablets do produtor"><input type="text" inputMode="numeric" value={form.qtd_tablets_produtor} onChange={e => setForm(f => ({ ...f, qtd_tablets_produtor: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  <Checkbox checked={form.tem_internet_local} onChange={v => setForm(f => ({ ...f, tem_internet_local: v }))} label="Tem internet no local" />
                  <Checkbox checked={form.tem_planilha_pronta} onChange={v => setForm(f => ({ ...f, tem_planilha_pronta: v }))} label="Planilha de coreografias pronta" />
                  <Checkbox checked={form.tem_regulamento} onChange={v => setForm(f => ({ ...f, tem_regulamento: v }))} label="Regulamento com critérios definidos" />
                  <Checkbox checked={form.pretende_migrar} onChange={v => setForm(f => ({ ...f, pretende_migrar: v }))} label="Pretende migrar tudo pra CoreoHub" />
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Observações</h2>
                <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} rows={3} className={inputCls} />
              </section>
            </div>

            <div className="lg:sticky lg:top-4 h-fit space-y-4">
              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><DollarSign size={13} /> Valores</h2>
                  <button onClick={applySuggestion} className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline">
                    Sugerir da faixa
                  </button>
                </div>

                <MoneyField label="Terminal de Júri" value={valorTerminalText} onChange={setValorTerminalText}
                  hint={suggestion.terminalRow ? `Sugerido: ${suggestion.terminalRow.label}` : (Number(form.qtd_apresentacoes) > 0 ? 'Nenhuma faixa ativa cobre essa quantidade' : 'Informe o nº de apresentações')} />
                <MoneyField label="Setup / cadastro" value={valorSetupText} onChange={setValorSetupText} />
                <MoneyField label={`Operador (${form.operador_modalidade})`} value={valorOperadorText} onChange={setValorOperadorText}
                  disabled={form.operador_modalidade === 'nenhum'} />

                <div className="pt-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500">Total</span>
                  <span className="text-xl font-black text-[#ff0068]">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotalFinal)}
                  </span>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button onClick={handleGeneratePdf} disabled={valorTotalFinal <= 0}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/20 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
                    <Download size={14} /> Gerar PDF
                  </button>
                  <button onClick={handleSaveQuote} disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar cotação
                  </button>
                  <button onClick={resetForm} className="w-full text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-1">
                    Limpar formulário
                  </button>
                </div>

                {savedOk && <p className="text-[11px] text-emerald-500 flex items-center gap-1.5"><Check size={12} /> Cotação salva.</p>}
                {saveError && <p className="text-[11px] text-rose-500">{saveError}</p>}
              </section>
            </div>
          </div>
        )}

        {tab === 'lista' && (
          <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
            {quotesLoading ? (
              <div className="p-10 text-center"><Loader2 size={24} className="animate-spin mx-auto text-[#ff0068]" /></div>
            ) : quotes.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-500">Nenhuma cotação salva ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-3">Evento</th>
                      <th className="text-left px-4 py-3">Responsável</th>
                      <th className="text-left px-4 py-3">Cidade/UF</th>
                      <th className="text-left px-4 py-3">Escopo</th>
                      <th className="text-right px-4 py-3">Total</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => (
                      <tr key={q.id} className="border-t border-slate-100 dark:border-white/5">
                        <td className="px-4 py-3 font-bold">{q.nome_evento || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.nome_responsavel || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.cidade ? `${q.cidade}${q.estado ? '/' + q.estado : ''}` : '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.qtd_apresentacoes ?? '—'} apres. · {q.qtd_jurados ?? '—'} jurados</td>
                        <td className="px-4 py-3 text-right font-black">{q.valor_total != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(q.valor_total) : '—'}</td>
                        <td className="px-4 py-3">
                          <select
                            value={q.status}
                            onChange={e => handleStatusChange(q.id, e.target.value as QuoteRow['status'])}
                            aria-label="Status da cotação"
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-xl border-0 ${STATUS_META[q.status].color}`}
                          >
                            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDeleteQuote(q.id)} aria-label="Excluir cotação" className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'config' && (
          <div className="space-y-6">
            {(['terminal', 'operador', 'setup'] as const).map(categoria => (
              <section key={categoria} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    {categoria === 'terminal' ? 'Terminal de Júri (faixas por nº de apresentações)' : categoria === 'operador' ? 'Operador CoreoHub (diária)' : 'Setup / cadastro'}
                  </h2>
                  <button onClick={() => addConfigRow(categoria)} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline">
                    <Plus size={12} /> Nova faixa
                  </button>
                </div>

                {configLoading ? (
                  <Loader2 size={18} className="animate-spin text-[#ff0068]" />
                ) : (
                  <div className="space-y-2">
                    {config.filter(c => c.categoria === categoria).map(row => (
                      <ConfigRowEditor
                        key={row.id}
                        row={row}
                        onChange={patch => updateConfigField(row.id, patch)}
                        onSave={updated => saveConfigRow(updated)}
                        onDelete={() => deleteConfigRow(row.id)}
                      />
                    ))}
                    {config.filter(c => c.categoria === categoria).length === 0 && (
                      <p className="text-xs text-slate-500">Nenhuma faixa cadastrada.</p>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </SuperAdminMfaGate>
  );
};

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
    {children}
  </label>
);

const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded accent-[#ff0068]" />
    {label}
  </label>
);

const MoneyField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }> = ({ label, value, onChange, hint, disabled }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
    <input
      type="text"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={e => onChange(maskMoeda(e.target.value))}
      placeholder="R$ 0,00"
      className={`${inputCls} disabled:opacity-50`}
    />
    {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
  </label>
);

const ConfigRowEditor: React.FC<{
  row: PricingConfigRow;
  onChange: (patch: Partial<PricingConfigRow>) => void;
  onSave: (row: PricingConfigRow) => void;
  onDelete: () => void;
}> = ({ row, onChange, onSave, onDelete }) => {
  const [dirty, setDirty] = useState(false);
  const [minText, setMinText] = useState(maskMoeda(String(Math.round(row.valor_min * 100))));
  const [maxText, setMaxText] = useState(maskMoeda(String(Math.round(row.valor_max * 100))));

  const handleSaveClick = () => {
    const updated: PricingConfigRow = { ...row, valor_min: parseMoeda(minText), valor_max: parseMoeda(maxText) };
    onSave(updated);
    setDirty(false);
  };

  return (
    <div className="flex flex-wrap items-end gap-2 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
      <label className="flex-1 min-w-[160px] space-y-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Label</span>
        <input value={row.label} onChange={e => { onChange({ label: e.target.value }); setDirty(true); }} className={inputCls} />
      </label>
      {row.categoria === 'terminal' && (
        <>
          <label className="w-24 space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Qtd. mín.</span>
            <input type="text" inputMode="numeric" value={row.qty_min ?? ''} onChange={e => { onChange({ qty_min: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null }); setDirty(true); }} className={inputCls} />
          </label>
          <label className="w-24 space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Qtd. máx.</span>
            <input type="text" inputMode="numeric" value={row.qty_max ?? ''} onChange={e => { onChange({ qty_max: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null }); setDirty(true); }} className={inputCls} placeholder="sem teto" />
          </label>
        </>
      )}
      <label className="w-32 space-y-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Valor mín.</span>
        <input value={minText} onChange={e => { setMinText(maskMoeda(e.target.value)); setDirty(true); }} className={inputCls} />
      </label>
      <label className="w-32 space-y-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Valor máx.</span>
        <input value={maxText} onChange={e => { setMaxText(maskMoeda(e.target.value)); setDirty(true); }} className={inputCls} />
      </label>
      <Checkbox checked={row.ativo} onChange={v => { onChange({ ativo: v }); setDirty(true); }} label="Ativo" />
      <button
        onClick={handleSaveClick}
        disabled={!dirty}
        aria-label="Salvar faixa"
        className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-2xl disabled:opacity-30 transition-colors"
      >
        <Save size={16} />
      </button>
      <button onClick={onDelete} aria-label="Remover faixa" className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-colors">
        <Trash2 size={16} />
      </button>
    </div>
  );
};

export default Cotacoes;
