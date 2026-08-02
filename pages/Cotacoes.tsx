import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import PageHeader from '../components/PageHeader';
import SuperAdminMfaGate from '../components/SuperAdminMfaGate';
import { maskMoeda, parseMoeda } from '../utils/masks';
import { formatEventWhatsApp } from '../utils/formatters';
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
  categoria: 'terminal' | 'operador' | 'setup' | 'setup_gratis';
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
  created_by: string | null;
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
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [loadingQuoteEdit, setLoadingQuoteEdit] = useState(false);
  const [currentUserName, setCurrentUserName] = useState('');
  // Resolve created_by (UUID) -> nome. standalone_quotes.created_by referencia
  // auth.users, não public.profiles diretamente — sem FK declarada pra
  // PostgREST fazer embed automático, então busca em separado (mesmo padrão
  // já usado em Registrations.tsx pra hidratar coupon_code por id).
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});

  // [color-scheme:dark] no <select> não pinta o popup nativo de <option> no
  // Chrome/Windows (mesmo achado do JudgeMicCheck.tsx) — precisa estilizar
  // cada <option> na mão. Diferente do terminal do jurado (sempre escuro),
  // esta página segue o tema do app, então precisa saber em tempo real se
  // está em dark mode (observa a classe `dark` no <html>, que o toggle do
  // Header liga/desliga).
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const optionStyle = isDark ? { backgroundColor: '#0f172a', color: '#fff' } : undefined;

  /* ── acesso ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_super_admin, role, full_name')
        .eq('id', user.id)
        .single();
      setAuthorized(Boolean(profile?.is_super_admin) || profile?.role === 'COREOHUB_ADMIN');
      setCurrentUserName(profile?.full_name ?? user.email ?? '');
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
      .select('id, nome_evento, nome_responsavel, cidade, estado, qtd_apresentacoes, qtd_jurados, valor_total, status, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) console.error('Erro ao carregar cotações:', error);
    const rows = (data as QuoteRow[]) ?? [];
    setQuotes(rows);
    setQuotesLoading(false);

    const ids = Array.from(new Set(rows.map(r => r.created_by).filter((id): id is string => Boolean(id))));
    if (ids.length > 0) {
      const { data: profs, error: profErr } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      if (profErr) { console.error('Erro ao resolver autores das cotações:', profErr); return; }
      setCreatorNames(prev => {
        const next = { ...prev };
        (profs ?? []).forEach((p: any) => { next[p.id] = p.full_name ?? '—'; });
        return next;
      });
    }
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
  // Arredonda a soma pra 2 casas — evita resíduo de ponto flutuante
  // (ex: 0.1 + 0.2) aparecendo no total exibido/salvo/impresso no PDF.
  const valorTotalFinal = Math.round((valorTerminalFinal + valorSetupFinal + valorOperadorFinal) * 100) / 100;

  const resetForm = () => {
    if (!confirm('Limpar o formulário? Os dados preenchidos serão perdidos.')) return;
    setForm(emptyQuoteForm);
    setValorTerminalText('');
    setValorSetupText('');
    setValorOperadorText('');
    setEditingQuoteId(null);
    setSaveError(null);
    setSavedOk(false);
  };

  // Reabre uma cotação salva no formulário de Nova Cotação pra editar.
  // Busca a linha completa sob demanda (a lista só carrega colunas
  // resumidas, ver loadQuotes) em vez de manter tudo em memória à toa.
  const openQuoteForEdit = async (id: string) => {
    setLoadingQuoteEdit(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const { data, error } = await supabase.from('standalone_quotes').select('*').eq('id', id).single();
      if (error) throw error;
      const q = data as any;
      setForm({
        nome_responsavel: q.nome_responsavel ?? '',
        nome_evento: q.nome_evento ?? '',
        email: q.email ?? '',
        whatsapp: q.whatsapp ?? '',
        cidade: q.cidade ?? '',
        estado: q.estado ?? '',
        datas_evento: q.datas_evento ?? '',
        qtd_apresentacoes: q.qtd_apresentacoes ?? '',
        qtd_jurados: q.qtd_jurados ?? '',
        qtd_dias_competicao: q.qtd_dias_competicao ?? '',
        operador_modalidade: q.operador_modalidade ?? 'presencial',
        operador_dias: q.operador_dias ?? '',
        qtd_tablets_produtor: q.qtd_tablets_produtor ?? '',
        tem_internet_local: Boolean(q.tem_internet_local),
        tem_planilha_pronta: Boolean(q.tem_planilha_pronta),
        tem_regulamento: Boolean(q.tem_regulamento),
        lista_jurados_texto: q.lista_jurados_texto ?? '',
        pretende_migrar: Boolean(q.pretende_migrar),
        observacoes: q.observacoes ?? '',
      });
      setValorTerminalText(q.valor_terminal ? maskMoeda(String(Math.round(q.valor_terminal * 100))) : '');
      setValorSetupText(q.valor_setup ? maskMoeda(String(Math.round(q.valor_setup * 100))) : '');
      setValorOperadorText(q.valor_operador ? maskMoeda(String(Math.round(q.valor_operador * 100))) : '');
      setEditingQuoteId(id);
      setTab('nova');
    } catch (e: any) {
      alert('Falha ao abrir a cotação: ' + (e?.message ?? 'erro desconhecido'));
    } finally {
      setLoadingQuoteEdit(false);
    }
  };

  const handleSaveQuote = async () => {
    if (!form.nome_evento.trim()) {
      setSaveError('Preencha o nome do evento antes de salvar.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const basePayload = {
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
      };

      if (editingQuoteId) {
        // Update não mexe em status/quote_type — quem controla status é o
        // select da lista, editar o formulário não deve resetar o funil.
        const { error } = await supabase.from('standalone_quotes').update(basePayload).eq('id', editingQuoteId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('standalone_quotes').insert({
          ...basePayload,
          quote_type: 'terminal_operador',
          status: 'rascunho',
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
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

    // Referência do orçamento — estável quando a cotação já foi salva
    // (reusa o id, então gerar o PDF de novo pra mesma cotação repete o
    // mesmo número); pra cotação ainda não salva, gera um sufixo novo.
    const refDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const refSuffix = (editingQuoteId ?? crypto.randomUUID()).replace(/-/g, '').slice(0, 4).toUpperCase();
    const quoteRef = `COT-${refDate}-${refSuffix}`;

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
    doc.setFontSize(8);
    doc.text(quoteRef, pageWidth - 14, 13, { align: 'right' });

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
      `Apresentações informadas: ${form.qtd_apresentacoes || '—'}`,
      // Mostra a FAIXA contratada (o que ele efetivamente está comprando —
      // uma licença "até N apresentações"), não só o número cru que ele
      // informou. Evita confusão tipo "informei 40, mas paguei por 50" —
      // o produtor precisa entender que a licença cobre uma faixa, não uma
      // contagem exata cravada no dia do evento.
      `Faixa contratada (Terminal de Júri): ${suggestion.terminalRow?.label ?? '—'}`,
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

    const validadeDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR');

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Condições:', 14, finalY);
    const condicoes = [
      '- Deslocamento, passagem e hospedagem da equipe da CoreoHub, quando presencial, são por conta do contratante.',
      '- Produtor/equipe fornece a lista de coreografias, ordem de apresentação, jurados e critérios de avaliação.',
      `- Proposta válida até ${validadeDate}.`,
    ];
    let cy = finalY + 5;
    condicoes.forEach(line => { doc.text(line, 14, cy); cy += 4.5; });
    const emissorLine = currentUserName ? `Emitido por ${currentUserName} em ${new Date().toLocaleDateString('pt-BR')}` : `Emitido em ${new Date().toLocaleDateString('pt-BR')}`;
    doc.text(emissorLine, 14, cy + 4);

    cy += 12;
    doc.setDrawColor(230, 230, 230);
    doc.line(14, cy, pageWidth - 14, cy);
    cy += 5;
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('CoreoHub — Gestão Inteligente para Festivais de Dança', 14, cy);
    doc.text(`coreohub.com  ·  contato@coreohub.com  ·  WhatsApp ${formatEventWhatsApp('5517997936169')}`, 14, cy + 4.5);

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
      label: categoria === 'terminal' ? computeTierLabel(null, null)
           : categoria === 'setup_gratis' ? computeTierLabel(null, null, 'inscrições')
           : 'Nova faixa',
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

        <nav aria-label="Cotações" className="flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-white/10 pb-px">
          {([
            { id: 'nova', label: 'Nova Cotação', icon: Sparkles },
            { id: 'lista', label: 'Cotações', icon: ListChecks },
            { id: 'config', label: 'Configurar Valores', icon: Settings },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-black uppercase tracking-widest border-b-2 whitespace-nowrap shrink-0 transition-colors ${
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
          <div className="space-y-4">
            {editingQuoteId && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 rounded-2xl">
                <p className="text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center gap-2">
                  <Pencil size={13} /> Editando cotação salva — "Salvar" atualiza este registro em vez de criar um novo.
                </p>
                <button onClick={resetForm} className="text-[10px] font-black uppercase tracking-widest text-sky-700 dark:text-sky-300 hover:underline shrink-0">
                  Cancelar e começar nova
                </button>
              </div>
            )}
            {loadingQuoteEdit && (
              <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Carregando cotação...</div>
            )}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Users size={13} /> Identificação</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Nome do responsável">
                    <input value={form.nome_responsavel} maxLength={100} onChange={e => setForm(f => ({ ...f, nome_responsavel: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="Nome do evento/festival">
                    <input value={form.nome_evento} maxLength={100} onChange={e => setForm(f => ({ ...f, nome_evento: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="E-mail">
                    <input type="email" value={form.email} maxLength={120} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
                  </Field>
                  <Field label="WhatsApp">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatEventWhatsApp(form.whatsapp)}
                      onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value.replace(/\D/g, '').slice(0, 13) }))}
                      placeholder="(47) 99999-8888"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Calendar size={13} /> Local e logística (informativo — sem custo de deslocamento)</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Cidade"><input value={form.cidade} maxLength={80} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className={inputCls} /></Field>
                  <Field label="Estado">
                    <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} className={inputCls}>
                      <option value="" style={optionStyle}>—</option>
                      {UFS.map(uf => <option key={uf} value={uf} style={optionStyle}>{uf}</option>)}
                    </select>
                  </Field>
                  <Field label="Datas do evento"><input value={form.datas_evento} maxLength={30} onChange={e => setForm(f => ({ ...f, datas_evento: e.target.value }))} placeholder="ex: 12 a 14/09/2026" className={inputCls} /></Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><ClipboardList size={13} /> Escopo do evento</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Nº de apresentações"><input type="text" inputMode="numeric" maxLength={4} placeholder="ex: 120" value={form.qtd_apresentacoes} onChange={e => setForm(f => ({ ...f, qtd_apresentacoes: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                  <Field label="Nº de jurados"><input type="text" inputMode="numeric" maxLength={2} placeholder="ex: 4" value={form.qtd_jurados} onChange={e => setForm(f => ({ ...f, qtd_jurados: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                  <Field label="Dias de competição"><input type="text" inputMode="numeric" maxLength={2} placeholder="ex: 3" value={form.qtd_dias_competicao} onChange={e => setForm(f => ({ ...f, qtd_dias_competicao: e.target.value.replace(/\D/g, '') }))} className={inputCls} /></Field>
                </div>
              </section>

              <section className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Wifi size={13} /> Operador + Infraestrutura</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Suporte técnico">
                    <select value={form.operador_modalidade} onChange={e => setForm(f => ({ ...f, operador_modalidade: e.target.value as any }))} className={inputCls}>
                      <option value="presencial" style={optionStyle}>Presencial</option>
                      <option value="remoto" style={optionStyle}>Remoto</option>
                      <option value="nenhum" style={optionStyle}>Não incluído</option>
                    </select>
                  </Field>
                  <Field label="Dias de suporte" hint="Nº de dias, não uma data">
                    <input type="text" inputMode="numeric" maxLength={2} placeholder="ex: 2" value={form.operador_dias} onChange={e => setForm(f => ({ ...f, operador_dias: e.target.value.replace(/\D/g, '') }))} className={inputCls} />
                  </Field>
                  <Field label="Tablets disponíveis no evento" hint="0 se não tiver nenhum — cada jurado precisa de 1">
                    <input type="text" inputMode="numeric" maxLength={2} placeholder="ex: 4" value={form.qtd_tablets_produtor} onChange={e => setForm(f => ({ ...f, qtd_tablets_produtor: e.target.value.replace(/\D/g, '') }))} className={inputCls} />
                  </Field>
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
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editingQuoteId ? 'Atualizar cotação' : 'Salvar cotação'}
                  </button>
                  <button onClick={resetForm} className="w-full text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-1">
                    Limpar formulário
                  </button>
                </div>

                {savedOk && <p className="text-[11px] text-emerald-500 flex items-center gap-1.5"><Check size={12} /> {editingQuoteId ? 'Cotação atualizada.' : 'Cotação salva.'}</p>}
                {saveError && <p className="text-[11px] text-rose-500">{saveError}</p>}
              </section>
            </div>
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
                      <th className="text-left px-4 py-3">Emitido por</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => (
                      <tr
                        key={q.id}
                        onClick={() => openQuoteForEdit(q.id)}
                        className="border-t border-slate-100 dark:border-white/5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                        title="Clique pra abrir e editar"
                      >
                        <td className="px-4 py-3 font-bold">{q.nome_evento || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.nome_responsavel || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.cidade ? `${q.cidade}${q.estado ? '/' + q.estado : ''}` : '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{q.qtd_apresentacoes ?? '—'} apres. · {q.qtd_jurados ?? '—'} jurados</td>
                        <td className="px-4 py-3 text-right font-black">{q.valor_total != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(q.valor_total) : '—'}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <select
                            value={q.status}
                            onChange={e => handleStatusChange(q.id, e.target.value as QuoteRow['status'])}
                            aria-label="Status da cotação"
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-xl border-0 dark:[color-scheme:dark] ${STATUS_META[q.status].color}`}
                          >
                            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{q.created_by ? (creatorNames[q.created_by] ?? '...') : '—'}</td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openQuoteForEdit(q.id)} aria-label="Editar cotação" title="Editar" className="p-1.5 text-slate-400 hover:text-[#ff0068] transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDeleteQuote(q.id)} aria-label="Excluir cotação" title="Excluir" className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
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
            {(['terminal', 'operador', 'setup', 'setup_gratis'] as const).map(categoria => (
              <section key={categoria} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    {categoria === 'terminal' ? 'Terminal de Júri (faixas por nº de apresentações)'
                      : categoria === 'operador' ? 'Operador CoreoHub (diária)'
                      : categoria === 'setup_gratis' ? 'Taxa de Ativação — Evento Gratuito (faixas por nº de inscrições)'
                      : 'Setup / cadastro'}
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

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] dark:[color-scheme:dark]';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// Label das faixas do Terminal é DERIVADO de qty_min/qty_max, não texto
// livre — evita o que aconteceu na mão (2026-07-27): editar a faixa "Até
// 100" pra "51 a 100" exige lembrar de atualizar o texto separadamente do
// número, e as duas coisas podem ficar dessincronizadas silenciosamente.
function computeTierLabel(qtyMin: number | null, qtyMax: number | null, unidadeLabel = 'apresentações'): string {
  if ((qtyMin == null || qtyMin === 0) && qtyMax != null) return `Até ${qtyMax} ${unidadeLabel}`;
  if (qtyMin != null && qtyMax != null) return `${qtyMin} a ${qtyMax} ${unidadeLabel}`;
  if (qtyMin != null && qtyMax == null) return `${qtyMin}+ ${unidadeLabel}`;
  return 'Faixa incompleta';
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
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

  // Terminal (por apresentações) e Setup Gratuito (por inscrições) são as 2
  // categorias com faixa calculada a partir de qty_min/qty_max — Operador/
  // Setup avulso continuam com label livre (não são faixas por quantidade).
  const isTerminal   = row.categoria === 'terminal';
  const isSetupGratis = row.categoria === 'setup_gratis';
  const isTierByQty  = isTerminal || isSetupGratis;
  const unidadeLabel = isSetupGratis ? 'inscrições' : 'apresentações';

  const handleSaveClick = () => {
    const valorMin = parseMoeda(minText);
    const valorMax = parseMoeda(maxText);
    if (valorMin > valorMax) {
      alert('Valor mínimo não pode ser maior que o valor máximo.');
      return;
    }
    const updated: PricingConfigRow = {
      ...row,
      valor_min: valorMin,
      valor_max: valorMax,
      label: isTierByQty ? computeTierLabel(row.qty_min, row.qty_max, unidadeLabel) : row.label,
    };
    onSave(updated);
    setDirty(false);
  };

  return (
    <div className="flex flex-wrap items-end gap-2 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
      {isTierByQty ? (
        <div className="flex-1 min-w-[160px] space-y-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Faixa (calculada)</span>
          <p className={`${inputCls} flex items-center text-slate-500 dark:text-slate-400 cursor-default select-none`}>
            {computeTierLabel(row.qty_min, row.qty_max, unidadeLabel)}
          </p>
        </div>
      ) : (
        <label className="flex-1 min-w-[160px] space-y-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Label</span>
          <input value={row.label} onChange={e => { onChange({ label: e.target.value }); setDirty(true); }} className={inputCls} />
        </label>
      )}
      {isTierByQty && (
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
