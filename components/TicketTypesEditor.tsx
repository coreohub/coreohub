import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import PrecoInput from './PrecoInput';
import SeatZonesEditor from './SeatZonesEditor';
import ZonePriceMatrix from './ZonePriceMatrix';
import { validateZonePricing, type SeatZone } from '../supabase/functions/_shared/seat-zone-pricing';

interface TicketLote { data_virada: string | null; preco: number; precos_por_zona?: Record<string, number> }
interface TicketType {
  nome: string;
  preco: number;
  obs?: string;
  link?: string;
  lotes?: TicketLote[];
  precos_por_zona?: Record<string, number>;
  quantidade_total?: number | null;
  promocional?: boolean;
  assento_tipo?: 'comum' | 'pcd' | 'obeso' | 'acompanhante';
}

interface Props {
  eventId: string;
  isAdmin: boolean;
  /** Chamado depois de salvar com sucesso (a tela de vendas recarrega os tipos). */
  onSaved?: () => void;
}

/**
 * Editor de tipos de ingresso, lotes, preço por zona e regras de venda de UM evento/sessão.
 * Salva sozinho: só as colunas de ingresso de `events` e o espelho legado em `configuracoes`
 * (nunca created_by/is_public). Salvar fica indisponível até a carga terminar, para o estado
 * padrão não sobrescrever o que está no banco.
 */
const TicketTypesEditor: React.FC<Props> = ({ eventId, isAdmin, onSaved }) => {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [politicaIngressos, setPoliticaIngressos] = useState<string>('NAO_DEFINIDO');
  const [ingressos, setIngressos] = useState<TicketType[]>([]);
  const [eventSeatMap, setEventSeatMap] = useState(false);
  const [seatZones, setSeatZones] = useState<SeatZone[]>([]);
  const [audienceSalesEnabled, setAudienceSalesEnabled] = useState(false);
  const [audienceCommissionPercent, setAudienceCommissionPercent] = useState(10);
  const [audienceCommissionPercentManual, setAudienceCommissionPercentManual] = useState(false);
  const [audienceFeeMode, setAudienceFeeMode] = useState<'repassar' | 'absorver'>('repassar');
  const [audienceMaxPerCpf, setAudienceMaxPerCpf] = useState(6);
  const [audienceMaxPerPurchase, setAudienceMaxPerPurchase] = useState(6);
  const [audienceReservationMinutes, setAudienceReservationMinutes] = useState(15);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    setLoadError(null);
    setMsg(null);
    const { data: ev, error } = await supabase
      .from('events')
      .select('politica_ingressos, ingressos_config, seat_map_enabled, seat_zones, audience_sales_enabled, audience_commission_percent, audience_commission_percent_manual, audience_fee_mode, audience_max_per_cpf, audience_max_per_purchase, audience_reservation_minutes')
      .eq('id', eventId)
      .maybeSingle();
    if (error || !ev) {
      console.error('[TicketTypesEditor] leitura do evento:', error?.message ?? 'evento não encontrado');
      setLoadError(error?.message ?? 'Evento não encontrado.');
      return;
    }
    // events é a fonte real; configuracoes (legado) só entra se events nunca teve a lista/política.
    const { data: cfg, error: cfgErr } = await supabase.from('configuracoes').select('ingressos_audiencia, politica_ingressos, url_ingressos').eq('id', eventId).maybeSingle();
    if (cfgErr) console.error('[TicketTypesEditor] leitura de configuracoes:', cfgErr.message);
    const list: TicketType[] = Array.isArray(ev.ingressos_config)
      ? (ev.ingressos_config as TicketType[])
      : (Array.isArray(cfg?.ingressos_audiencia) ? (cfg!.ingressos_audiencia as TicketType[]) : []);
    // Mesma regra de Configurações: events, depois configuracoes, depois deduz pelos dados.
    const politicaResolvida: string =
      (ev.politica_ingressos && ev.politica_ingressos !== 'NAO_DEFINIDO') ? (ev.politica_ingressos as string)
      : (cfg?.politica_ingressos && cfg.politica_ingressos !== 'NAO_DEFINIDO') ? (cfg.politica_ingressos as string)
      : list.length > 0 ? 'INTERNO'
      : cfg?.url_ingressos ? 'EXTERNO'
      : 'NAO_DEFINIDO';
    setIngressos(list);
    setPoliticaIngressos(politicaResolvida);
    setEventSeatMap(Boolean(ev.seat_map_enabled));
    setSeatZones(Array.isArray(ev.seat_zones) ? (ev.seat_zones as SeatZone[]) : []);
    setAudienceSalesEnabled(Boolean(ev.audience_sales_enabled));
    if (ev.audience_commission_percent != null) setAudienceCommissionPercent(Number(ev.audience_commission_percent));
    setAudienceCommissionPercentManual(Boolean(ev.audience_commission_percent_manual));
    if (ev.audience_fee_mode) setAudienceFeeMode(ev.audience_fee_mode as 'repassar' | 'absorver');
    if (ev.audience_max_per_cpf != null) setAudienceMaxPerCpf(Number(ev.audience_max_per_cpf));
    if (ev.audience_max_per_purchase != null) setAudienceMaxPerPurchase(Number(ev.audience_max_per_purchase));
    if (ev.audience_reservation_minutes != null) setAudienceReservationMinutes(Number(ev.audience_reservation_minutes));
    setLoaded(true);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!loaded || saving) return;
    setMsg(null);
    if (eventSeatMap && seatZones.length > 0) {
      const zoneErrors = validateZonePricing(seatZones, ingressos as any);
      if (zoneErrors.length > 0) {
        setMsg({ kind: 'err', text: `Preço por zona: ${zoneErrors[0]}${zoneErrors.length > 1 ? ` (e mais ${zoneErrors.length - 1})` : ''}` });
        return;
      }
    }
    if (ingressos.some(t => !String(t.nome ?? '').trim())) {
      setMsg({ kind: 'err', text: 'Dê um nome a todos os tipos de ingresso (ou remova o que está em branco).' });
      return;
    }
    setSaving(true);
    try {
      const eventPatch: Record<string, unknown> = {
        ingressos_config: ingressos,
        audience_sales_enabled: audienceSalesEnabled && politicaIngressos === 'INTERNO',
        audience_fee_mode: audienceFeeMode,
        audience_max_per_cpf: audienceMaxPerCpf,
        audience_max_per_purchase: audienceMaxPerPurchase,
        audience_reservation_minutes: audienceReservationMinutes,
        ...(isAdmin ? { audience_commission_percent: audienceCommissionPercent, audience_commission_percent_manual: audienceCommissionPercentManual } : {}),
      };
      const { data: updated, error: evErr } = await supabase.from('events').update(eventPatch).eq('id', eventId).select('id');
      if (evErr) throw evErr;
      if (!updated || updated.length === 0) throw new Error('Nada foi salvo (sem permissão neste evento).');

      // Espelho legado: configuracoes.ingressos_audiencia (mesma lista).
      const { data: cfgUpd, error: cfgErr } = await supabase
        .from('configuracoes')
        .update({ ingressos_audiencia: ingressos, atualizado_em: new Date().toISOString() })
        .eq('id', eventId)
        .select('id');
      if (cfgErr) throw cfgErr;
      if (!cfgUpd || cfgUpd.length === 0) console.warn('[TicketTypesEditor] sem linha em configuracoes para o evento; espelho legado não atualizado.');

      setMsg({ kind: 'ok', text: 'Tipos e preços salvos.' });
      onSaved?.();
    } catch (e: any) {
      console.error('[TicketTypesEditor] salvar:', e);
      setMsg({ kind: 'err', text: `Não foi possível salvar: ${e?.message ?? e}` });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" /> Não foi possível carregar os tipos de ingresso: {loadError}
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-[160px]">
        <Loader2 className="w-6 h-6 text-[#ff0068] animate-spin" />
      </div>
    );
  }
  if (politicaIngressos !== 'INTERNO') {
    return (
      <div className="bg-white dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-8 text-center space-y-2">
        <p className="text-sm font-bold text-slate-700 dark:text-white">
          {politicaIngressos === 'EXTERNO' ? 'Este evento vende por uma ticketeira externa.' : politicaIngressos === 'GRATUITO' ? 'Este evento tem entrada gratuita.' : 'A forma de venda de ingressos ainda não foi escolhida.'}
        </p>
        <p className="text-xs text-slate-500">Para cadastrar tipos e preços, escolha "Vender pela CoreoHub" em Configurações, na seção Ingressos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-6 md:p-8 rounded-3xl">
        <div className="flex items-center justify-end mb-3">
          <button
            onClick={() => setIngressos(t => [...t, { nome: '', preco: 0, obs: '' }])}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/20"
          >
            <Plus size={12} /> Adicionar Tipo
          </button>
        </div>
                  <div className="space-y-3">
                {ingressos.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-xs italic">Nenhum tipo. Ex: "Meia Entrada R$10" ou "Inteira R$20".</p>
                ) : (
                  ingressos.map((item, i) => {
                    const lotes = Array.isArray(item.lotes) ? item.lotes : null;
                    // Modo lotes ativo quando lista existe E tem 2+ entradas (1+ virada de preço).
                    // 1 lote só sem virada == modo simples (preço fixo) — mantém UX legada.
                    const isMultiLote = !!lotes && lotes.length >= 2;
                    const updateField = (patch: Partial<TicketType>) =>
                      setIngressos(t => t.map((x, idx) => idx === i ? { ...x, ...patch } : x));
                    const startLotes = () => {
                      // Converte simples → lotes: cria 1 lote com data + 1 final (sem virada).
                      // Mantém preço atual no lote final como ponto de partida.
                      const today = new Date().toISOString().slice(0, 10);
                      const precoBase = Number(item.preco ?? 0);
                      // Preços por zona acompanham: viram os dos dois lotes (não se perdem).
                      const zonas = (item as any).precos_por_zona;
                      updateField({
                        lotes: [
                          { data_virada: today, preco: precoBase, ...(zonas ? { precos_por_zona: { ...zonas } } : {}) },
                          { data_virada: null, preco: precoBase, ...(zonas ? { precos_por_zona: { ...zonas } } : {}) },
                        ],
                        ...(zonas ? { precos_por_zona: undefined } : {}),
                      } as any);
                    };
                    const stopLotes = () => {
                      // Volta pra modo simples: usa preço do último lote como preço único.
                      const ultimo = lotes?.[lotes.length - 1]?.preco ?? item.preco ?? 0;
                      const zonasUltimo = (lotes?.[lotes.length - 1] as any)?.precos_por_zona;
                      updateField({ lotes: undefined, preco: Number(ultimo), ...(zonasUltimo ? { precos_por_zona: { ...zonasUltimo } } : {}) } as any);
                    };
                    const updateLote = (loteIdx: number, patch: Partial<TicketLote>) => {
                      const next = (lotes ?? []).map((l, idx) => idx === loteIdx ? { ...l, ...patch } : l);
                      updateField({ lotes: next });
                    };
                    const addLoteIntermediario = () => {
                      // Insere antes do último (que sempre tem data_virada=null)
                      const today = new Date().toISOString().slice(0, 10);
                      const next = [...(lotes ?? [])];
                      const ultimoPreco = next[next.length - 1]?.preco ?? 0;
                      const zonasUltimo = (next[next.length - 1] as any)?.precos_por_zona;
                      next.splice(next.length - 1, 0, { data_virada: today, preco: ultimoPreco, ...(zonasUltimo ? { precos_por_zona: { ...zonasUltimo } } : {}) } as any);
                      updateField({ lotes: next });
                    };
                    const removeLote = (loteIdx: number) => {
                      const next = (lotes ?? []).filter((_, idx) => idx !== loteIdx);
                      // Garante que o último seja sempre "sem virada" (preço final)
                      if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], data_virada: null };
                      // Se sobrou só 1 lote, volta pra modo simples automaticamente
                      if (next.length <= 1) {
                        updateField({ lotes: undefined, preco: Number(next[0]?.preco ?? item.preco ?? 0) });
                      } else {
                        updateField({ lotes: next });
                      }
                    };

                    return (
                      <div key={i} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl p-3 space-y-3">
                        {/* Linha 1: nome + obs + delete */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                          <input
                            type="text"
                            value={item.nome}
                            onChange={e => updateField({ nome: e.target.value })}
                            placeholder="Nome (Ex: Meia Entrada)"
                            className="sm:col-span-5 bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          />
                          <input
                            type="text"
                            value={item.obs ?? ''}
                            onChange={e => updateField({ obs: e.target.value })}
                            placeholder="Observação (opc., ex: + 1kg alimento)"
                            className="sm:col-span-6 bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          />
                          <button
                            onClick={() => setIngressos(t => t.filter((_, idx) => idx !== i))}
                            aria-label={`Remover ingresso ${item.nome || 'sem nome'}`}
                            className="sm:col-span-1 p-2 text-slate-400 hover:text-red-500 self-center justify-self-end sm:justify-self-center inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Trash2 size={14} />
                            <span className="sm:hidden">Remover</span>
                          </button>
                        </div>

                        {/* Tipo de assento (só com mapa numerado) */}
                        {eventSeatMap && (
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <label htmlFor={`assento-tipo-${i}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500 sm:w-32 shrink-0">Tipo de assento</label>
                            <select
                              id={`assento-tipo-${i}`}
                              value={item.assento_tipo ?? 'comum'}
                              onChange={e => {
                                const v = e.target.value as 'comum' | 'pcd' | 'obeso' | 'acompanhante';
                                const dica = v === 'pcd'
                                  ? 'Assentos exclusivos para pessoas com deficiência, em área com acessibilidade ampliada.'
                                  : v === 'obeso'
                                  ? 'Assento largo, com estrutura reforcada, para pessoa obesa. Sem exigencia de comprovacao na compra.'
                                  : v === 'acompanhante'
                                    ? 'Um acompanhante por pessoa com deficiência, no assento ao lado.'
                                    : undefined;
                                updateField({ assento_tipo: v === 'comum' ? undefined : v, ...(dica && !item.obs?.trim() ? { obs: dica } : {}) });
                              }}
                              className="flex-1 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold dark:[color-scheme:dark] focus:outline-none focus:border-[#ff0068]/50"
                            >
                              <option value="comum">Comum — assentos comuns do mapa</option>
                              <option value="pcd">PCD — espaço de cadeirante / assento PCD</option>
                              <option value="obeso">Pessoa obesa — assento largo (mobilidade reduzida)</option>
                              <option value="acompanhante">Acompanhante de PCD — assento ao lado do PCD (mesmo pedido)</option>
                            </select>
                          </div>
                        )}

                        {/* Linha 2: preço (modo simples) OU editor de lotes */}
                        {!isMultiLote ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preço</label>
                              <PrecoInput
                                value={Number(item.preco) || 0}
                                onChange={n => updateField({ preco: n })}
                                className="w-28 bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 pl-8 pr-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={startLotes}
                              className="ml-auto text-[10px] font-black text-[#ff0068] uppercase tracking-widest hover:underline inline-flex items-center gap-1"
                            >
                              <Plus size={12} /> Adicionar lote (com virada de data)
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Lotes — preços por período
                              </p>
                              <button
                                type="button"
                                onClick={stopLotes}
                                className="text-[9px] text-slate-500 hover:text-red-500 uppercase font-black tracking-widest"
                              >
                                Voltar a preço único
                              </button>
                            </div>
                            {(lotes ?? []).map((lote, loteIdx) => {
                              const isUltimo = loteIdx === (lotes!.length - 1);
                              return (
                                <div key={loteIdx} className="grid grid-cols-12 gap-2 items-center">
                                  <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    {isUltimo ? 'Final' : `Lote ${loteIdx + 1}`}
                                  </div>
                                  <div className="col-span-5">
                                    {isUltimo ? (
                                      <input
                                        type="text"
                                        disabled
                                        value="Sem virada (preço final)"
                                        className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-lg py-2 px-3 text-slate-400 text-xs italic cursor-not-allowed"
                                      />
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">até</span>
                                        <input
                                          type="date"
                                          value={lote.data_virada || ''}
                                          onChange={e => updateLote(loteIdx, { data_virada: e.target.value || null })}
                                          className="flex-1 bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-2 text-slate-900 dark:text-white font-bold text-xs focus:outline-none focus:border-[#ff0068]/50 dark:[color-scheme:dark]"
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <div className="col-span-3">
                                    <PrecoInput
                                      value={Number(lote.preco) || 0}
                                      onChange={n => updateLote(loteIdx, { preco: n })}
                                      className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 pl-7 pr-2 text-slate-900 dark:text-white text-xs font-bold focus:outline-none focus:border-[#ff0068]/50"
                                    />
                                  </div>
                                  <div className="col-span-1 flex justify-end">
                                    {!isUltimo && (
                                      <button
                                        type="button"
                                        onClick={() => removeLote(loteIdx)}
                                        aria-label={`Remover lote ${loteIdx + 1}`}
                                        className="p-1.5 text-slate-400 hover:text-red-500"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              onClick={addLoteIntermediario}
                              className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest hover:underline inline-flex items-center gap-1"
                            >
                              <Plus size={12} /> Adicionar lote
                            </button>
                          </div>
                        )}

                        {/* Estoque (Tier 2): limite total por tipo. NULL = ilimitado.
                            Toggle ON sem valor = 0 (= ilimitado, não força). Producer digita explicitamente. */}
                        {(() => {
                          // toggle is "on" se: tem limite > 0 OU está em modo edição (após click)
                          const hasLimit = item.quantidade_total != null && item.quantidade_total > 0;
                          // edição em curso: quantidade_total === 0 (toggle clicado, valor não digitado ainda)
                          const editing = item.quantidade_total === 0;
                          const showInput = hasLimit || editing;
                          return (
                            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-white/5">
                              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={showInput}
                                  onChange={e => updateField({
                                    quantidade_total: e.target.checked ? 0 : null,
                                  })}
                                  className="w-4 h-4 accent-[#ff0068]"
                                />
                                Limitar estoque
                              </label>
                              {showInput && (
                                <>
                                  <input
                                    type="number"
                                    min={0}
                                    value={item.quantidade_total ?? ''}
                                    onChange={e => updateField({ quantidade_total: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                                    placeholder="Ex: 100"
                                    inputMode="numeric"
                                    autoFocus={editing}
                                    className="w-24 bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white text-xs font-bold focus:outline-none focus:border-[#ff0068]/50"
                                  />
                                  <span className="text-[10px] text-slate-500">
                                    {hasLimit ? 'ingressos no total' : 'digite o total (em branco = ilimitado)'}
                                  </span>
                                </>
                              )}
                              {!showInput && (
                                <span className="text-[10px] text-slate-500">Sem limite (ilimitado)</span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Promocional (Decreto 13.108 art. 10): política comercial do produtor,
                            não conta na cota de 40% da meia-entrada e não acumula com ela. */}
                        <label className="flex items-start gap-2 pt-2 border-t border-slate-200 dark:border-white/5 text-[10px] font-black uppercase tracking-widest text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.promocional === true}
                            onChange={e => updateField({ promocional: e.target.checked ? true : undefined })}
                            className="mt-0.5 w-4 h-4 accent-[#ff0068]"
                          />
                          <span>
                            Ingresso promocional
                            <span className="block normal-case tracking-normal font-medium text-slate-500 mt-0.5">
                              Cupom, convênio ou lote promocional próprio. Não conta na cota de meia-entrada.
                            </span>
                          </span>
                        </label>
                      </div>
                    );
                  })
                )}
                  </div>
                  {/* Tier 1 — Vender ingressos pela CoreoHub */}
                  <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-5 space-y-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={audienceSalesEnabled}
                        onChange={e => setAudienceSalesEnabled(e.target.checked)}
                        className="mt-1 w-4 h-4 accent-[#ff0068]"
                      />
                      <div>
                        <p className="text-sm font-black text-slate-900 dark:text-white">
                          Vender ingressos pela CoreoHub
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          Quando ativo, o botão "Comprar" na vitrine pública leva pra checkout interno
                          (PIX/cartão/boleto via Asaas). Comprador recebe ingresso digital com QR no email.
                          Quando inativo, mostra os tipos como informativo (com link externo se cadastrado).
                        </p>
                      </div>
                    </label>

                    {audienceSalesEnabled && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-7">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                            Comissão da plataforma
                          </label>
                          {isAdmin ? (
                            <>
                              <input
                                type="number"
                                min={0} max={100} step={0.5}
                                value={audienceCommissionPercent}
                                onChange={e => { setAudienceCommissionPercent(Number(e.target.value)); setAudienceCommissionPercentManual(true); }}
                                className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                              />
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-bold">⚙️ Admin: editável só pra você. Produtores veem como fixo.</p>
                              {audienceCommissionPercentManual && (
                                <p className="text-[10px] text-slate-400 mt-1">Customizado manualmente — não muda mais sozinho se o plano do evento trocar.</p>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg py-2 px-3 text-slate-700 dark:text-slate-300 text-sm font-bold flex items-center justify-between">
                                <span>{audienceCommissionPercent}% sobre cada ingresso</span>
                                <span className="text-[9px] uppercase tracking-widest text-slate-400">Fixo</span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1">Definido pela CoreoHub e não pode ser alterado.</p>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                            Quem paga a taxa
                          </label>
                          <select
                            value={audienceFeeMode}
                            onChange={e => setAudienceFeeMode(e.target.value as 'repassar' | 'absorver')}
                            className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          >
                            <option value="repassar">Repassar ao comprador (preço + taxa)</option>
                            <option value="absorver">Absorver (eu pago a taxa)</option>
                          </select>
                          <p className="text-[10px] text-slate-500 mt-1">
                            {audienceFeeMode === 'repassar'
                              ? 'Comprador vê preço + taxa de serviço.'
                              : 'Comprador vê só o preço; taxa sai do seu líquido.'}
                          </p>
                        </div>

                        <details className="md:col-span-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-500">Avançado</summary><div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                            Máx ingressos por CPF
                          </label>
                          <input
                            type="number"
                            min={1} max={50}
                            value={audienceMaxPerCpf}
                            onChange={e => setAudienceMaxPerCpf(Math.max(1, Number(e.target.value)))}
                            className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Padrão 6 (cobre família). Meia-entrada tem limite legal de 1.</p>
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                            Máx ingressos por compra
                          </label>
                          <input
                            type="number"
                            min={1} max={20}
                            value={audienceMaxPerPurchase}
                            onChange={e => setAudienceMaxPerPurchase(Math.max(1, Number(e.target.value)))}
                            className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Sympla padrão é 5. Para escolas de dança com famílias grandes, considere 6+.</p>
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                            Tempo de reserva (min)
                          </label>
                          <input
                            type="number"
                            min={1} max={60}
                            value={audienceReservationMinutes}
                            onChange={e => setAudienceReservationMinutes(Math.min(60, Math.max(1, Number(e.target.value))))}
                            className="w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Quanto o ingresso fica reservado pro comprador antes de auto-cancelar. Padrão 10min (Eventbrite).</p>
                        </div>
                        </div></details>
                      </div>
                    )}
                  </div>
      </div>

      {eventSeatMap && (
              <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-6 md:p-8 rounded-3xl space-y-5">
                <div>
                  <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Preço por zona do mapa</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Cobre valores diferentes por região da plateia (frente, fundo, laterais...).</p>
                </div>
                <SeatZonesEditor eventId={eventId} zones={seatZones} onZonesSaved={(next) => {
                  setSeatZones(next);
                  onSaved?.();
                  // Zona removida: apaga os preços dela (tipo e lotes) pra não travar o próximo 'Salvar'.
                  const keep = new Set(next.map(z => z.key));
                  const clean = (m: any) => {
                    if (!m) return m;
                    const out = Object.fromEntries(Object.entries(m).filter(([k]) => k === 'geral' || keep.has(k)));
                    return Object.keys(out).length > 0 ? out : undefined;
                  };
                  setIngressos(list => list.map((t: any) => ({
                    ...t,
                    ...(t.precos_por_zona ? { precos_por_zona: clean(t.precos_por_zona) } : {}),
                    ...(Array.isArray(t.lotes) ? { lotes: t.lotes.map((l: any) => (l.precos_por_zona ? { ...l, precos_por_zona: clean(l.precos_por_zona) } : l)) } : {}),
                  })));
                }} />
                {seatZones.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preços por zona</p>
                    <ZonePriceMatrix zones={seatZones} ingressos={ingressos} onChange={setIngressos} />
                    <p className="text-[10px] text-slate-500">Os preços entram quando você clicar em Salvar abaixo.</p>
                  </div>
                )}
              </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null} Salvar tipos e preços
        </button>
        {msg && (
          <p role="status" className={`text-xs font-bold flex items-center gap-1.5 ${msg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {msg.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {msg.text}
          </p>
        )}
      </div>
    </div>
  );
};

export default TicketTypesEditor;
