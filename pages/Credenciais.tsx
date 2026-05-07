import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Loader2, Printer, Users, Gavel, GraduationCap, Sparkles,
  ClipboardList, ChevronDown, Eye, X, Download,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import {
  CredentialItem,
  CredentialType,
  generateCredentialPdf,
} from '../utils/credencialPdf';

type TabKey = 'INSCRITOS' | 'WORKSHOPS' | 'EQUIPE' | 'JURADOS' | 'TODOS';
type PrintMode = 'A6' | 'PIMACO_6280';

interface EventOption {
  id: string;
  name: string;
  edition_year: number | null;
  is_demo?: boolean;
}

const TYPE_DOT: Record<CredentialType, string> = {
  INSCRITO:    'bg-[#ff0068]',
  STAFF:       'bg-blue-600',
  JURADO:      'bg-amber-500',
  COORDENADOR: 'bg-violet-600',
};

const STAFF_ROLES = ['STAFF', 'MESARIO', 'SONOPLASTA', 'RECEPCAO', 'PALCO'];
const COORD_ROLES = ['COORDENADOR'];

const Credenciais: React.FC = () => {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [inscritos, setInscritos] = useState<CredentialItem[]>([]);
  const [workshops, setWorkshops] = useState<CredentialItem[]>([]);
  const [equipe, setEquipe] = useState<CredentialItem[]>([]);
  const [jurados, setJurados] = useState<CredentialItem[]>([]);

  const [tab, setTab] = useState<TabKey>('INSCRITOS');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<PrintMode>('A6');

  const [loading, setLoading] = useState(true);
  const [printJob, setPrintJob] = useState<CredentialItem[] | null>(null);
  const [printAction, setPrintAction] = useState<'preview' | 'download'>('download');
  const [printing, setPrinting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('');

  /* ── Eventos do produtor ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id,name,edition_year,is_demo,created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setEvents(data as EventOption[]);
        const demo = data.find((e: any) => e.is_demo);
        setSelectedEventId(demo?.id ?? data[0].id);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  /* ── Carrega dados quando evento muda ── */
  useEffect(() => {
    if (!selectedEventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [regsRes, wsRes, judgesRes] = await Promise.all([
          supabase
            .from('registrations')
            .select('id,nome_coreografia,estudio,estilo_danca,categoria,formato_participacao,status,status_pagamento')
            .eq('event_id', selectedEventId)
            .eq('status', 'APROVADA')
            .in('status_pagamento', ['CONFIRMADO', 'APROVADO'])
            .order('nome_coreografia'),
          supabase
            .from('workshops')
            .select('id,name')
            .eq('event_id', selectedEventId),
          supabase
            .from('judges')
            .select('id,name,competencias_formatos,is_active')
            .order('name'),
        ]);

        const inscritosList: CredentialItem[] = (regsRes.data || []).map((r: any) => ({
          id: `reg-${r.id}`,
          type: 'INSCRITO',
          name: r.nome_coreografia || 'Sem nome',
          subtitle: r.estudio || undefined,
          category: [r.formato_participacao, r.categoria].filter(Boolean).join(' · ') || undefined,
          qrValue: r.id,
        }));

        let workshopsList: CredentialItem[] = [];
        const workshopIds = (wsRes.data || []).map((w: any) => w.id);
        const workshopNames: Record<string, string> = {};
        (wsRes.data || []).forEach((w: any) => { workshopNames[w.id] = w.name; });

        if (workshopIds.length > 0) {
          const { data: wregs } = await supabase
            .from('workshop_registrations')
            .select('id,buyer_name,workshop_id,access_token,status_pagamento,attended')
            .in('workshop_id', workshopIds)
            .or('status_pagamento.eq.APROVADO,status_pagamento.eq.CORTESIA,status_pagamento.eq.GRATUITO,attended.eq.true');
          workshopsList = (wregs || []).map((w: any) => ({
            id: `ws-${w.id}`,
            type: 'INSCRITO',
            name: w.buyer_name || 'Comprador',
            subtitle: workshopNames[w.workshop_id] ? `Workshop · ${workshopNames[w.workshop_id]}` : 'Workshop',
            category: undefined,
            qrValue: w.access_token || w.id,
          }));
        }

        const { data: profsData } = await supabase
          .from('profiles')
          .select('id,full_name,role,cargo')
          .in('role', [...STAFF_ROLES, ...COORD_ROLES])
          .order('full_name');
        const equipeList: CredentialItem[] = (profsData || []).map((p: any) => {
          const isCoord = COORD_ROLES.includes(p.role);
          return {
            id: `eq-${p.id}`,
            type: (isCoord ? 'COORDENADOR' : 'STAFF') as CredentialType,
            name: p.full_name || 'Equipe',
            subtitle: p.cargo || (isCoord ? 'Coordenação' : 'Equipe'),
            category: undefined,
            qrValue: p.id,
          };
        });

        const juradosList: CredentialItem[] = (judgesRes.data || [])
          .filter((j: any) => j.is_active !== false)
          .map((j: any) => ({
            id: `jr-${j.id}`,
            type: 'JURADO' as CredentialType,
            name: j.name || 'Jurado',
            subtitle: 'Corpo de Jurados',
            category: Array.isArray(j.competencias_formatos) && j.competencias_formatos[0] || undefined,
            qrValue: j.id,
          }));

        if (cancelled) return;
        setInscritos(inscritosList);
        setWorkshops(workshopsList);
        setEquipe(equipeList);
        setJurados(juradosList);
        setSelected(new Set());
      } catch (e) {
        console.error('Erro ao carregar credenciais:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEventId]);

  const tabsItems: Record<TabKey, CredentialItem[]> = useMemo(() => ({
    INSCRITOS: inscritos,
    WORKSHOPS: workshops,
    EQUIPE:    equipe,
    JURADOS:   jurados,
    TODOS:     [...inscritos, ...workshops, ...equipe, ...jurados],
  }), [inscritos, workshops, equipe, jurados]);

  const currentItems = tabsItems[tab];
  const currentSelectedCount = currentItems.filter(i => selected.has(i.id)).length;
  const allCurrentSelected = currentItems.length > 0 && currentSelectedCount === currentItems.length;

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllCurrent = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allCurrentSelected) {
        currentItems.forEach(i => next.delete(i.id));
      } else {
        currentItems.forEach(i => next.add(i.id));
      }
      return next;
    });
  };

  /* ── Pré-visualizar e Imprimir: ambos passam pelo mesmo pipeline,
        diferenciados pelo printAction. ── */
  const triggerPrintJob = (action: 'preview' | 'download') => {
    const all = tabsItems.TODOS;
    const items = all.filter(i => selected.has(i.id));
    if (items.length === 0) return;
    setPrinting(true);
    setPrintAction(action);
    setPrintJob(items);
  };
  const handlePrint = () => triggerPrintJob('download');
  const handlePreview = () => triggerPrintJob('preview');

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFileName('');
  };

  const downloadFromPreview = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = previewFileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Não revoga aqui — modal continua aberto pro user revisar.
  };

  /* ── Após render do hidden container, captura QRs e gera PDF ──
     2 RAFs aninhados pra garantir que o React commit + paint do canvas
     concluíram antes de chamar toDataURL (importante pra batches grandes). */
  useEffect(() => {
    if (!printJob) return;
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          const qrDataUrls: Record<string, string> = {};
          for (const item of printJob) {
            const canvas = document.getElementById(`credqr-${item.id}`) as HTMLCanvasElement | null;
            if (canvas) qrDataUrls[item.id] = canvas.toDataURL('image/png');
          }
          const eventName = events.find(e => e.id === selectedEventId)?.name ?? 'Evento';
          const doc = generateCredentialPdf({
            items: printJob,
            qrDataUrls,
            eventName,
            mode,
          });
          // Filename amigável pra ordenar na pasta. Sanitiza caracteres
          // inválidos em filesystems (\ / : * ? " < > |) trocando por '-'.
          const tipoLabel = mode === 'A6' ? 'A6 cordão' : 'Adesivo';
          const sanitizedEvent = eventName.replace(/[\\/:*?"<>|]+/g, '-').trim();
          const fileName = `CoreoHub - Credenciais ${tipoLabel} (${printJob.length}) - ${sanitizedEvent}.pdf`;
          const blob = doc.output('blob');
          const url = URL.createObjectURL(blob);

          if (printAction === 'preview') {
            // Revoga url anterior se existir (caso de cliques sucessivos).
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(url);
            setPreviewFileName(fileName);
          } else {
            // Anchor programático — passa em popup blockers que recusam
            // window.open() async.
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }
        } catch (e) {
          console.error('Erro ao gerar PDF:', e);
          alert('Erro ao gerar PDF. Veja o console.');
        } finally {
          setPrintJob(null);
          setPrinting(false);
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [printJob, mode, events, selectedEventId]);

  const TAB_DEFS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'INSCRITOS', label: 'Inscritos', icon: ClipboardList },
    { key: 'WORKSHOPS', label: 'Workshops', icon: GraduationCap },
    { key: 'EQUIPE',    label: 'Equipe',    icon: Users },
    { key: 'JURADOS',   label: 'Jurados',   icon: Gavel },
    { key: 'TODOS',     label: 'Todos',     icon: Sparkles },
  ];

  const totalSelected = selected.size;

  return (
    <div className="space-y-6 pb-32 sm:pb-28 animate-in fade-in duration-700">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Credenciais
          </h1>
          <p className="text-xs text-slate-500 font-bold mt-1">
            Imprima credenciais de todos os tipos. Modelo A6 com cordão ou adesivo Pimaco 6280.
          </p>
        </div>

        {events.length > 1 ? (
          <div className="relative shrink-0">
            <select
              value={selectedEventId ?? ''}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full sm:w-auto appearance-none pl-4 pr-9 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 cursor-pointer truncate dark:[color-scheme:dark]"
            >
              {events.map(ev => (
                <option key={ev.id} value={ev.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                  {ev.name}{ev.edition_year ? ` · ${ev.edition_year}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        ) : events.length === 1 ? (
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 shrink-0">
            {events[0].name}
            {events[0].edition_year ? ` · ${events[0].edition_year}` : ''}
          </div>
        ) : null}
      </div>

      {/* Tabs — em mobile vira scroll horizontal pra caber em 1 linha (padrão
          iOS/Material). Em sm+ usa flex-wrap. */}
      <div className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 sm:pb-0">
        {TAB_DEFS.map(({ key, label, icon: Icon }) => {
          const count = tabsItems[key].length;
          const isActive = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isActive
                  ? 'bg-[#ff0068] text-white shadow-md'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-[#ff0068]/40'
              }`}
            >
              <Icon size={14} />
              {label}
              <span className={`ml-1 px-2 py-0.5 rounded-full text-[9px] tabular-nums ${
                isActive ? 'bg-white/25' : 'bg-slate-100 dark:bg-white/10 text-slate-500'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Modo de impressão — antes da lista pra ficar sempre visível
          (vai junto com o botão sticky bottom). */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Modo de impressão</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            onClick={() => setMode('A6')}
            className={`text-left p-4 rounded-2xl border-2 transition-all ${
              mode === 'A6'
                ? 'border-[#ff0068] bg-[#ff0068]/5'
                : 'border-slate-200 dark:border-white/10 hover:border-[#ff0068]/40'
            }`}
          >
            <p className="text-sm font-black text-slate-900 dark:text-white">A6 cordão</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              105×148mm · 4 por folha A4 · papel cartão 250g · você corta e fura
            </p>
          </button>
          <button
            onClick={() => setMode('PIMACO_6280')}
            className={`text-left p-4 rounded-2xl border-2 transition-all ${
              mode === 'PIMACO_6280'
                ? 'border-[#ff0068] bg-[#ff0068]/5'
                : 'border-slate-200 dark:border-white/10 hover:border-[#ff0068]/40'
            }`}
          >
            <p className="text-sm font-black text-slate-900 dark:text-white">Adesivo 99×33mm</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              14 por folha A4 (Pimaco 6280 ou similar) · cola em credencial pré-impressa
            </p>
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 dark:border-white/10">
          <button
            onClick={toggleAllCurrent}
            disabled={currentItems.length === 0}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-[#ff0068] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <input
              type="checkbox"
              checked={allCurrentSelected}
              readOnly
              className="accent-[#ff0068] cursor-pointer"
            />
            Selecionar todos da aba
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {currentSelectedCount} de {currentItems.length}
          </span>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 size={28} className="animate-spin text-[#ff0068]" />
          </div>
        ) : currentItems.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            Nenhum item nesta aba.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5 max-h-[55vh] overflow-y-auto">
            {currentItems.map(item => {
              const checked = selected.has(item.id);
              return (
                <li key={item.id}>
                  <label className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItem(item.id)}
                      className="accent-[#ff0068]"
                    />
                    <span className={`w-2 h-2 rounded-full ${TYPE_DOT[item.type]}`} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {[item.subtitle, item.category].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sticky bottom action bar — sempre visível durante scroll. Em mobile
          posiciona acima do BottomNavBar (que tem 64px de altura). */}
      <div className="fixed left-0 right-0 bottom-16 sm:bottom-0 lg:left-64 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <div className="flex flex-col min-w-0 flex-1 sm:flex-none">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 leading-tight truncate">
              Modo · {mode === 'A6' ? 'A6 cordão' : 'Pimaco 6280'}
            </p>
            <p className="text-[10px] font-black text-slate-700 dark:text-slate-300 tabular-nums">
              {totalSelected} {totalSelected === 1 ? 'selecionado' : 'selecionados'}
            </p>
          </div>
          <button
            onClick={handlePreview}
            disabled={totalSelected === 0 || printing}
            className="shrink-0 sm:ml-auto flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:border-[#ff0068]/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Pré-visualizar antes de baixar"
          >
            <Eye size={14} />
            <span className="hidden sm:inline">Pré-visualizar</span>
          </button>
          <button
            onClick={handlePrint}
            disabled={totalSelected === 0 || printing}
            className="shrink-0 flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 hover:scale-[1.01] active:scale-[0.99] transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {printing ? (
              <><Loader2 size={14} className="animate-spin" /> Gerando PDF…</>
            ) : totalSelected === 0 ? (
              <><Printer size={14} /> Selecione 1+</>
            ) : (
              <><Printer size={14} /> Imprimir ({totalSelected})</>
            )}
          </button>
        </div>
      </div>

      {/* Modal de pré-visualização do PDF — iframe nativo do browser pra
          renderizar o PDF gerado em memória. User confirma antes de baixar. */}
      {previewUrl && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-5xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pré-visualização</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate" title={previewFileName}>
                  {previewFileName}
                </p>
              </div>
              <button
                onClick={closePreview}
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shrink-0"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <iframe
              src={previewUrl}
              className="flex-1 w-full bg-slate-100 dark:bg-slate-950 min-h-[50vh]"
              title="Pré-visualização do PDF"
            />
            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={closePreview}
                className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Fechar
              </button>
              <button
                onClick={downloadFromPreview}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 hover:scale-[1.01] active:scale-[0.99] transition-transform"
              >
                <Download size={14} /> Baixar e imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden offscreen QR canvases — capturados pelo gerador de PDF */}
      {printJob && (
        <div style={{ position: 'absolute', left: -99999, top: -99999, width: 1, height: 1, overflow: 'hidden' }} aria-hidden>
          {printJob.map(item => (
            <QRCodeCanvas
              key={item.id}
              id={`credqr-${item.id}`}
              value={item.qrValue}
              size={256}
              level="H"
              fgColor="#000000"
              bgColor="#ffffff"
              marginSize={0}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Credenciais;
