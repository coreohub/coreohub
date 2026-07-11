import React, { useEffect, useState, useCallback } from 'react';
import { MonitorPlay, Copy, ExternalLink, RefreshCw, Check, Loader2, FlaskConical, Power, Radio, Trophy, X, Search, Hand } from 'lucide-react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import PageHeader from '../components/PageHeader';

interface Premio { id: string; nome: string; valor?: string; description?: string; }
interface Coreo { nome: string; estudio: string; }
type Reveal = { tipo: 'faixa'; faixa: 'ouro' | 'prata' | 'bronze' } | { tipo: 'maior_nota' } | { tipo: 'premio' } | { tipo: 'manual' };

// Classifica cada prêmio cadastrado pelo nome/descrição no jeito de revelar.
const classify = (a: Premio): Reveal => {
  const t = `${a.nome ?? ''} ${a.description ?? ''}`.toLowerCase();
  if (/\bouro\b|gold/.test(t))         return { tipo: 'faixa', faixa: 'ouro' };
  if (/\bprata\b|silver/.test(t))      return { tipo: 'faixa', faixa: 'prata' };
  if (/\bbronze\b/.test(t))            return { tipo: 'faixa', faixa: 'bronze' };
  if (/maior nota|grand.?prix/.test(t)) return { tipo: 'maior_nota' };
  if (/voto popular|vote\./.test(t))   return { tipo: 'manual' };
  return { tipo: 'premio' };
};

const revealLabel: Record<string, string> = {
  ouro: 'Faixa Ouro', prata: 'Faixa Prata', bronze: 'Faixa Bronze',
  maior_nota: 'Maior nota', premio: 'Deliberação', manual: 'Voto Popular · Automático',
};

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
  const [premios, setPremios] = useState<Premio[]>([]);
  const [coreos, setCoreos] = useState<Coreo[]>([]);
  const [manualFor, setManualFor] = useState<Premio | null>(null);
  const [manualSearch, setManualSearch] = useState('');
  const [manualEstudio, setManualEstudio] = useState('');
  const [votoError, setVotoError] = useState<string | null>(null);
  // Se a banca nunca rodou a Deliberação de Prêmios, prêmios classificados como
  // 'premio' (ex: Melhor Bailarino/Coreógrafo) não têm vencedor automático —
  // clicar neles abre direto o campo de digitar o vencedor na mão.
  const [hasDeliberation, setHasDeliberation] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = code ? `${origin}/telao/${code}` : '';

  // Carrega os prêmios especiais + coreografias (pra escolha manual do vencedor).
  const loadPremiacaoOptions = useCallback(async (id: string) => {
    const [{ data: cfg }, { data: regs }, { count: delibCount }] = await Promise.all([
      supabase.from('configuracoes').select('premios_especiais').eq('event_id', id).maybeSingle(),
      supabase.from('registrations')
        .select('nome_coreografia, estudio, event_data')
        .eq('event_id', id)
        .or('status.eq.APROVADA,status_pagamento.eq.APROVADO,status_pagamento.eq.CONFIRMADO'),
      supabase.from('deliberation_aggregate').select('id', { count: 'exact', head: true }).eq('event_id', id),
    ]);
    setHasDeliberation((delibCount ?? 0) > 0);

    const raw = (cfg as any)?.premios_especiais ?? [];
    setPremios((Array.isArray(raw) ? raw : [])
      .filter((a: any) => a && a.enabled !== false && a.id != null)
      .map((a: any) => ({
        id: String(a.id),
        nome: (a.nome ?? a.name ?? 'Prêmio').trim(),
        valor: a.valor ? String(a.valor) : undefined,
        description: a.description ?? a.descricao ?? '',
      })));

    const seen = new Set<string>();
    const cs: Coreo[] = [];
    (regs ?? []).forEach((r: any) => {
      const nome = (r.nome_coreografia ?? '').trim();
      const estudio = (r.estudio?.trim?.() || r.event_data?.estudio_nome || '').trim();
      if (!nome || seen.has(nome)) return;
      seen.add(nome);
      cs.push({ nome, estudio });
    });
    cs.sort((a, b) => a.nome.localeCompare(b.nome));
    setCoreos(cs);
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

  const fmtValor = (v?: string) =>
    v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

  const votoReasonLabel: Record<string, string> = {
    voting_not_closed: 'A votação do Voto Popular ainda está aberta — encerre no console do operador pra revelar.',
    tie: 'Empate no Voto Popular — escolha o vencedor na mão.',
    no_votes: 'Nenhum voto registrado ainda no Voto Popular.',
    festival_not_found: 'Este evento não está vinculado a um festival no Voto Popular.',
    group_not_linked: 'A coreografia vencedora não está vinculada a essa inscrição no CoreoHub.',
    registration_not_found: 'Inscrição vencedora não encontrada no CoreoHub.',
    unauthorized: 'Sessão expirada — recarregue a página e tente de novo.',
    'evento não encontrado': 'Evento não encontrado.',
    'sem permissão': 'Você não tem permissão pra revelar esse resultado neste evento.',
    'integração do voto não configurada': 'Integração com o Voto Popular não está configurada (fala com o suporte).',
  };

  const revelarAward = async (a: Premio) => {
    setVotoError(null);
    const r = classify(a);
    const valor = fmtValor(a.valor);
    if (r.tipo === 'faixa')      return sendPremiacao({ tipo: 'faixa', faixa: r.faixa, titulo: a.nome, valor });
    if (r.tipo === 'maior_nota') return sendPremiacao({ tipo: 'maior_nota', titulo: a.nome, valor });
    if (r.tipo === 'manual') {
      // Troféu Voto Popular: automático é a via principal (padrão de mercado —
      // reduz erro humano na hora da cerimônia). Busca digitada é só o fallback,
      // caso a votação ainda esteja aberta, dê empate, ou a integração falhe.
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-voto-popular-winner', {
          body: { event_id: eventId },
        });
        if (!error && (data as any)?.ok) {
          const w = data as { nome: string; estudio: string };
          await sendPremiacao({ tipo: 'manual', titulo: a.nome, valor, nome: w.nome, estudio: w.estudio });
          return;
        }
        // Em status != 2xx, supabase.functions.invoke devolve data:null — sem
        // ler o corpo real da resposta (error.context), toda falha de config/
        // auth/permissão colapsava na mesma mensagem genérica "indisponível",
        // impossível de diagnosticar na hora da cerimônia.
        let reason = (data as any)?.reason ?? (data as any)?.error as string | undefined;
        if (!reason && error && typeof (error as any).context?.json === 'function') {
          try {
            const body = await (error as any).context.json();
            reason = body?.reason ?? body?.error;
          } catch { /* corpo não era JSON — segue com reason undefined */ }
        }
        setVotoError(reason ? (votoReasonLabel[reason] ?? reason) : 'Resultado automático indisponível.');
      } catch {
        setVotoError('Não foi possível buscar o resultado automático do Voto Popular.');
      } finally {
        setBusy(false);
      }
      setManualFor(a);
      setManualSearch('');
      setManualEstudio('');
      return;
    }
    // 'premio' = vencedor por deliberação da banca. Se ninguém deliberou, não há
    // fonte automática (ex: Melhor Bailarino/Coreógrafo do Usualdance) — abre o
    // campo de digitar o vencedor na mão em vez de revelar uma tela vazia no LED.
    if (!hasDeliberation) {
      setManualFor(a);
      setManualSearch('');
      setManualEstudio('');
      return;
    }
    return sendPremiacao({ tipo: 'premio', award_id: a.id, titulo: a.nome, valor });
  };

  const revelarManual = (a: Premio, c: Coreo) => {
    sendPremiacao({ tipo: 'manual', titulo: a.nome, valor: fmtValor(a.valor), nome: c.nome, estudio: c.estudio });
    setManualFor(null); setManualSearch(''); setManualEstudio('');
  };

  // Vencedor digitado livre (pessoa/coreografia que não está na lista) — ex:
  // Melhor Bailarino(a). Nome obrigatório, estúdio/grupo opcional.
  const revelarManualLivre = (a: Premio) => {
    const nome = manualSearch.trim();
    if (!nome) return;
    sendPremiacao({ tipo: 'manual', titulo: a.nome, valor: fmtValor(a.valor), nome, estudio: manualEstudio.trim() });
    setManualFor(null); setManualSearch(''); setManualEstudio('');
  };

  const isActive = (a: Premio, r: Reveal) => {
    if (!premiacao) return false;
    if (premiacao.tipo === 'manual' && premiacao.titulo === a.nome) return true;
    if (r.tipo === 'faixa')      return premiacao.tipo === 'faixa' && premiacao.faixa === r.faixa && premiacao.titulo === a.nome;
    if (r.tipo === 'maior_nota') return premiacao.tipo === 'maior_nota' && premiacao.titulo === a.nome;
    if (r.tipo === 'premio')     return premiacao.tipo === 'premio' && String(premiacao.award_id) === a.id;
    return false;
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

      {/* Premiação — revelar prêmios cadastrados (modo premiação) */}
      {code && modo === 'premiacao' && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><Trophy size={12} aria-hidden /> Revelar no telão</p>
            <button onClick={() => sendPremiacao({ tipo: 'idle' })} disabled={busy}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50">
              <X size={12} /> Limpar telão
            </button>
          </div>

          {premios.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum prêmio configurado. Configure em <b className="text-slate-700 dark:text-slate-300">Resultados → Premiação</b>.</p>
          ) : (
            <div className="space-y-2">
              {premios.map((a) => {
                const r = classify(a);
                const active = isActive(a, r);
                return (
                  <div key={a.id} className="flex items-center gap-2">
                    <button onClick={() => revelarAward(a)} disabled={busy}
                      className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all text-left disabled:opacity-50 ${active ? 'bg-[#ff0068] text-white shadow-md' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                      <span className="truncate">{a.nome}{a.valor && <span className="opacity-60"> · R$ {Number(a.valor).toLocaleString('pt-BR')}</span>}</span>
                      <span className={`shrink-0 text-[8px] px-2 py-0.5 rounded ${active ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400'}`}>
                        {revealLabel[r.tipo === 'faixa' ? r.faixa : r.tipo]}
                      </span>
                    </button>
                    <button onClick={() => { setVotoError(null); setManualFor(a); setManualSearch(''); setManualEstudio(''); }} disabled={busy}
                      title="Escolher vencedor na mão" aria-label={`Escolher vencedor na mão para ${a.nome}`}
                      className="shrink-0 p-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 transition-all">
                      <Hand size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {votoError && (
            <p role="alert" className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
              {votoError}
            </p>
          )}

          {/* Escolha manual do vencedor */}
          {manualFor && (
            <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 truncate">Vencedor de "{manualFor.nome}"</p>
                <button onClick={() => setManualFor(null)} aria-label="Fechar" className="shrink-0 text-slate-500 hover:text-slate-900 dark:hover:text-white"><X size={14} /></button>
              </div>

              {/* Digitar o vencedor na mão (pessoa ou coreografia que não está na
                  lista) — ex: Melhor Bailarino(a). O mesmo campo filtra a lista abaixo. */}
              <div className="space-y-2">
                <input value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') revelarManualLivre(manualFor); }}
                  placeholder="Nome do vencedor (pessoa ou coreografia)" autoFocus
                  aria-label="Nome do vencedor"
                  className="w-full px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50" />
                <input value={manualEstudio}
                  onChange={(e) => setManualEstudio(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') revelarManualLivre(manualFor); }}
                  placeholder="Estúdio / grupo (opcional)"
                  aria-label="Estúdio ou grupo"
                  className="w-full px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50" />
                <button onClick={() => revelarManualLivre(manualFor)} disabled={busy || !manualSearch.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-40 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                  <Trophy size={13} /> Revelar no telão
                </button>
              </div>

              {coreos.length > 0 && (
                <>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 pt-1"><Search size={10} aria-hidden /> ou toque numa coreografia avaliada</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {coreos.filter((c) => !manualSearch || `${c.nome} ${c.estudio}`.toLowerCase().includes(manualSearch.toLowerCase())).slice(0, 40).map((c, i) => (
                      <button key={i} onClick={() => revelarManual(manualFor, c)} disabled={busy}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left bg-white dark:bg-white/5 hover:bg-[#ff0068]/10 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase tracking-wide transition-all">
                        <span className="truncate">{c.nome}</span>
                        {c.estudio && <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[45%]">{c.estudio}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-500">Faixas (Ouro/Prata/Bronze) e Maior Nota saem da média dos jurados. Prêmios sem cálculo automático — como <b className="text-slate-600 dark:text-slate-400">Melhor Bailarino(a)</b> ou <b className="text-slate-600 dark:text-slate-400">Voto Popular</b> — abrem um campo pra você <b className="text-slate-600 dark:text-slate-400">digitar o vencedor</b> (também dá pelo ✋). Nada aparece na plateia até você revelar.</p>
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
