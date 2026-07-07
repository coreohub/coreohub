import React, { useEffect, useState, useCallback } from 'react';
import { MonitorPlay, Copy, ExternalLink, RefreshCw, Check, Loader2, FlaskConical, Power, Radio, Trophy, Medal, X } from 'lucide-react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import PageHeader from '../components/PageHeader';

interface Grupo { categoria: string; estilo: string; }
interface Premio { id: string; nome: string; valor?: string; }

/**
 * Tela de controle do Telão de Palco (produtor). Gera/mostra o código curto
 * que o operador do LED digita em app.coreohub.com/telao, liga/desliga a
 * exibição, e traz um preview ao vivo + botão de teste pra ajustar o encaixe
 * no painel antes do evento. A exibição em si roda na rota pública /telao.
 */

const TelaoControle: React.FC = () => {
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string>('');
  const [code, setCode] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [modo, setModo] = useState<'ao_vivo' | 'premiacao'>('ao_vivo');
  const [premiacao, setPremiacao] = useState<any>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [premios, setPremios] = useState<Premio[]>([]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = code ? `${origin}/telao/${code}` : '';

  // Carrega os grupos (categoria+estilo) e prêmios especiais pra revelar.
  const loadPremiacaoOptions = useCallback(async (id: string) => {
    const [{ data: regs }, { data: cfg }] = await Promise.all([
      supabase.from('registrations')
        .select('categoria, estilo_danca')
        .eq('event_id', id)
        .or('status.eq.APROVADA,status_pagamento.eq.APROVADO,status_pagamento.eq.CONFIRMADO'),
      supabase.from('configuracoes').select('premios_especiais').eq('event_id', id).maybeSingle(),
    ]);
    const seen = new Set<string>();
    const gs: Grupo[] = [];
    (regs ?? []).forEach((r: any) => {
      const categoria = (r.categoria ?? '').trim();
      const estilo = (r.estilo_danca ?? '').trim();
      if (!categoria && !estilo) return;
      const key = `${categoria}||${estilo}`;
      if (seen.has(key)) return;
      seen.add(key);
      gs.push({ categoria, estilo });
    });
    gs.sort((a, b) => (a.categoria + a.estilo).localeCompare(b.categoria + b.estilo));
    setGrupos(gs);

    const raw = (cfg as any)?.premios_especiais ?? [];
    setPremios((Array.isArray(raw) ? raw : [])
      .filter((a: any) => a && a.enabled !== false && (a.id != null))
      .map((a: any) => ({ id: String(a.id), nome: a.nome ?? a.name ?? 'Prêmio', valor: a.valor ? String(a.valor) : undefined })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const id = await resolveActiveEventId();
      if (!id) { setLoading(false); return; }
      const { data } = await supabase
        .from('events')
        .select('id, name, telao_code, telao_ativo, telao_modo, telao_premiacao')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        setEventId(data.id);
        setEventName(data.name ?? '');
        setCode(data.telao_code ?? null);
        setAtivo(data.telao_ativo === true);
        setModo(data.telao_modo === 'premiacao' ? 'premiacao' : 'ao_vivo');
        setPremiacao(data.telao_premiacao ?? null);
        loadPremiacaoOptions(data.id);
      }
    } finally {
      setLoading(false);
    }
  }, [loadPremiacaoOptions]);

  useEffect(() => { load(); }, [load]);

  const handleSetModo = async (m: 'ao_vivo' | 'premiacao') => {
    if (!eventId || m === modo) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_telao_modo', { p_event_id: eventId, p_modo: m });
      if (error) throw error;
      setModo(m);
      if (m === 'ao_vivo') setPremiacao(null);
    } catch (e) { console.error(e); alert('Não foi possível trocar o modo do telão.'); }
    finally { setBusy(false); }
  };

  const sendPremiacao = async (payload: any) => {
    if (!eventId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_telao_premiacao', { p_event_id: eventId, p_premiacao: payload });
      if (error) throw error;
      setModo('premiacao');
      setPremiacao(payload);
    } catch (e) { console.error(e); alert('Não foi possível enviar ao telão.'); }
    finally { setBusy(false); }
  };

  const handleGenerate = async () => {
    if (!eventId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('regenerate_telao_code', { p_event_id: eventId });
      if (error) throw error;
      setCode(data as string);
      setAtivo(true);
    } catch (e) {
      console.error(e);
      alert('Não foi possível gerar o código. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    if (!eventId) return;
    const next = !ativo;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_telao_ativo', { p_event_id: eventId, p_ativo: next });
      if (error) throw error;
      setAtivo(next);
    } catch (e) {
      console.error(e);
      alert('Não foi possível alterar o estado do telão.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: 'link' | 'code') => {
    const text = what === 'link' ? publicUrl : (code ?? '');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* clipboard bloqueado — ignora */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-[#ff0068]" size={28} />
      </div>
    );
  }

  if (!eventId) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader title="Telão de Palco" subtitle="Placar ao vivo no LED" icon={<MonitorPlay className="text-[#ff0068]" size={26} aria-hidden />} />
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-10 text-center">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-bold uppercase tracking-widest">Crie um evento primeiro pra usar o telão.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Telão de Palco"
        subtitle={eventName || 'Placar ao vivo no LED'}
        icon={<MonitorPlay className="text-[#ff0068]" size={26} aria-hidden />}
      />

      {/* Card do código + estado */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Estado</p>
            <p className={`text-sm font-black uppercase tracking-widest ${ativo ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-500'}`}>
              {ativo ? '● Telão ativo' : '○ Telão desativado'}
            </p>
          </div>
          {code && (
            <button
              onClick={handleToggle}
              disabled={busy}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 ${
                ativo ? 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10' : 'bg-emerald-500 text-white hover:bg-emerald-600'
              }`}
            >
              <Power size={13} /> {ativo ? 'Desativar' : 'Ativar'}
            </button>
          )}
        </div>

        {!code ? (
          <div className="text-center py-6 space-y-4">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Gere o código do telão pra começar. O operador do LED vai digitar ele em <b className="text-slate-900 dark:text-white">{origin.replace(/^https?:\/\//, '')}/telao</b>.</p>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="inline-flex items-center gap-2 px-6 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <MonitorPlay size={16} />} Ativar telão
            </button>
          </div>
        ) : (
          <>
            {/* Código gigante */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Código do telão</p>
              <p className="text-5xl font-black italic tracking-tighter text-white tabular-nums select-all">{code}</p>
              <p className="text-[11px] text-slate-400 mt-3 uppercase tracking-widest">
                Abrir <b className="text-white">{origin.replace(/^https?:\/\//, '')}/telao</b> e digitar o código
              </p>
            </div>

            {/* Ações */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button onClick={() => copy('link')} className="flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                {copied === 'link' ? <Check size={13} className="text-emerald-500 dark:text-emerald-400" /> : <Copy size={13} />} Copiar link
              </button>
              <button onClick={() => copy('code')} className="flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                {copied === 'code' ? <Check size={13} className="text-emerald-500 dark:text-emerald-400" /> : <Copy size={13} />} Copiar código
              </button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                <ExternalLink size={13} /> Abrir telão
              </a>
              <a href={`${publicUrl}?teste=1`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                <FlaskConical size={13} /> Testar telão
              </a>
            </div>

            <button
              onClick={handleGenerate}
              disabled={busy}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} /> Gerar novo código (invalida o atual)
            </button>

            {/* Modo do telão */}
            <div className="pt-4 border-t border-slate-200 dark:border-white/10">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Modo do telão</p>
              <div className="inline-flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl">
                <button onClick={() => handleSetModo('ao_vivo')} disabled={busy}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 ${modo === 'ao_vivo' ? 'bg-[#ff0068] text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
                  <Radio size={13} /> Ao vivo
                </button>
                <button onClick={() => handleSetModo('premiacao')} disabled={busy}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 ${modo === 'premiacao' ? 'bg-[#ff0068] text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
                  <Trophy size={13} /> Premiação
                </button>
              </div>
            </div>

            {/* Preview ao vivo */}
            {ativo && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Preview ao vivo</p>
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-black" style={{ aspectRatio: '16 / 9' }}>
                  <iframe title="Preview do telão" src={publicUrl} className="w-full h-full" style={{ border: 0 }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Premiação — revelar pódios e prêmios (modo premiação) */}
      {code && modo === 'premiacao' && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Revelar no telão</p>
            <button onClick={() => sendPremiacao({ tipo: 'idle' })} disabled={busy}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50">
              <X size={12} /> Limpar telão
            </button>
          </div>

          {/* Pódio por grupo */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Medal size={12} aria-hidden /> Pódio por grupo</p>
            {grupos.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum grupo com inscrições ainda.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {grupos.map((g, i) => {
                  const active = premiacao?.tipo === 'podio' && (premiacao?.categoria ?? '') === g.categoria && (premiacao?.estilo ?? '') === g.estilo;
                  return (
                    <button key={i} onClick={() => sendPremiacao({ tipo: 'podio', categoria: g.categoria, estilo: g.estilo })} disabled={busy}
                      className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all text-left disabled:opacity-50 ${active ? 'bg-[#ff0068] text-white shadow-md' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                      <span className="truncate">{[g.categoria, g.estilo].filter(Boolean).join(' · ') || 'Sem grupo'}</span>
                      {active ? <Check size={14} /> : <ExternalLink size={13} className="opacity-50" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Prêmios especiais */}
          {premios.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Trophy size={12} aria-hidden /> Prêmios especiais</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {premios.map((p) => {
                  const active = premiacao?.tipo === 'premio' && String(premiacao?.award_id) === p.id;
                  return (
                    <button key={p.id} onClick={() => sendPremiacao({ tipo: 'premio', award_id: p.id, award_name: p.nome, valor: p.valor ?? '' })} disabled={busy}
                      className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all text-left disabled:opacity-50 ${active ? 'bg-[#ff0068] text-white shadow-md' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                      <span className="truncate">{p.nome}</span>
                      {active ? <Check size={14} /> : <ExternalLink size={13} className="opacity-50" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">O pódio mostra Ouro/Prata/Bronze por nota do grupo. O vencedor de cada prêmio vem da votação dos jurados. Nada aparece na plateia até você clicar.</p>
        </div>
      )}

      {/* Como usar */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Como usar no dia do evento</p>
        <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal pl-5">
          <li>No computador ligado ao LED/projetor, abra <b className="text-slate-900 dark:text-white">{origin.replace(/^https?:\/\//, '')}/telao</b> e digite o código acima. Pressione <b className="text-slate-900 dark:text-white">F11</b> pra tela cheia.</li>
          <li>Ao clicar <b className="text-slate-900 dark:text-white">Iniciar</b> numa coreografia no Cronograma, o telão mostra "aguardando" com os jurados daquela apresentação.</li>
          <li>Quando o <b className="text-slate-900 dark:text-white">último jurado fecha a nota</b>, a média aparece sozinha. O operador corta pra essa tela no aplauso.</li>
          <li>Use <b className="text-slate-900 dark:text-white">Testar telão</b> antes das portas abrirem pra ajustar o tamanho da janela ao painel (ex: 6×2 m).</li>
        </ol>
      </div>
    </div>
  );
};

export default TelaoControle;
