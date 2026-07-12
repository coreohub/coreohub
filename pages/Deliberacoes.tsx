/**
 * Página /deliberacoes — Painel agregado do Coordenador do Júri / Produtor
 *
 * Phase 3 — visão admin do sistema de deliberação:
 * - Estado da fase do evento (COLETANDO / DELIBERACAO / CONFERENCIA / LIBERADO)
 * - Gate pra avançar fases (controla quando jurados podem deliberar/conferir)
 * - Painel agregado por prêmio: pra cada award, lista das coreografias
 *   com mais indicações + quantos jurados marcaram cada uma
 * - Marcações ⭐ por jurado (overview)
 *
 * Acessível pra:
 * - Produtor (dono do evento): controla o gate
 * - Coordenador do Júri (permissoes_custom.suporte_juri = true): visualiza
 *   tudo e recomenda liberação
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabase';
import {
  Trophy, Loader2, RefreshCw, AlertCircle, CheckCircle2, Clock, Users,
  Star, Lock, Unlock, ChevronRight, Send,
} from 'lucide-react';

type DeliberationStatus = 'COLETANDO' | 'DELIBERACAO' | 'CONFERENCIA' | 'LIBERADO';

const STATUS_LABEL: Record<DeliberationStatus, string> = {
  COLETANDO:   'Coleta de marcações',
  DELIBERACAO: 'Atribuição de prêmios',
  CONFERENCIA: 'Conferência cruzada',
  LIBERADO:    'Liberado',
};

const STATUS_NEXT: Record<DeliberationStatus, DeliberationStatus | null> = {
  COLETANDO:   'DELIBERACAO',
  DELIBERACAO: 'CONFERENCIA',
  CONFERENCIA: 'LIBERADO',
  LIBERADO:    null,
};

const STATUS_DESCRIPTION: Record<DeliberationStatus, string> = {
  COLETANDO:   'Jurados marcam ⭐ as apresentações em destaque durante o evento.',
  DELIBERACAO: 'Jurados atribuem prêmios às suas marcações.',
  CONFERENCIA: 'Jurados veem agregado anônimo + janela curta pra ajustar.',
  LIBERADO:    'Resultados visíveis pro produtor e disponíveis pra publicação.',
};

/* ── Classificação do prêmio pelo nome/descrição — MESMA lógica do Telão de
 *  Palco (TelaoControle.tsx) e do PDF (ResultsPanel.tsx), pra as 3 telas
 *  concordarem sobre o que é faixa / maior nota / deliberação / manual. ── */
type AwardReveal = { tipo: 'faixa'; faixa: 'ouro' | 'prata' | 'bronze' } | { tipo: 'maior_nota' } | { tipo: 'premio' } | { tipo: 'manual' };
const classifyAward = (nome: string, description: string): AwardReveal => {
  const t = `${nome ?? ''} ${description ?? ''}`.toLowerCase();
  if (/\bouro\b|gold/.test(t))          return { tipo: 'faixa', faixa: 'ouro' };
  if (/\bprata\b|silver/.test(t))       return { tipo: 'faixa', faixa: 'prata' };
  if (/\bbronze\b/.test(t))             return { tipo: 'faixa', faixa: 'bronze' };
  if (/maior nota|grand.?prix/.test(t)) return { tipo: 'maior_nota' };
  if (/voto popular|vote\./.test(t))    return { tipo: 'manual' };
  return { tipo: 'premio' };
};

const Deliberacoes: React.FC = () => {
  const [event, setEvent] = useState<any>(null);
  const [aggregate, setAggregate] = useState<any[]>([]);
  const [marcacoes, setMarcacoes] = useState<any[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [judges, setJudges] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [medias, setMedias] = useState<{ registration_id: string; final_weighted_average: number | null }[]>([]);
  const [thresholds, setThresholds] = useState<{ gold: number; silver: number; bronze: number }>({ gold: 9, silver: 8, bronze: 7 });
  // Edição dos vencedores digitados na mão (Melhor Bailarino/Coreógrafo, Voto
  // Popular) — persistidos em configuracoes.premios_especiais ao salvar.
  const [winnerEdits, setWinnerEdits] = useState<Record<string, { nome: string; estudio: string }>>({});
  const [savingWinners, setSavingWinners] = useState(false);
  const [winnersSaved, setWinnersSaved] = useState(false);
  // Depois de salvar, os campos de pessoa/manual travam (read-only) — o mesmo
  // botão vira "Editar vencedores" pra reabrir, evita edição sem querer no
  // meio da cerimônia.
  const [winnersLocked, setWinnersLocked] = useState(false);
  const [pullingVoto, setPullingVoto] = useState<string | null>(null);
  const [votoMsg, setVotoMsg] = useState<string | null>(null);
  // Busca pra filtrar a lista de coreografias cadastradas no picker de cada prêmio editável.
  const [pickerSearch, setPickerSearch] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve evento ativo do produtor
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not_authenticated');

      const { data: ev } = await supabase
        .from('events')
        .select('id, name, deliberation_status, conferencia_started_at, conferencia_duration_seconds, deliberation_released_at, created_by')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ev) throw new Error('no_event');
      setEvent(ev);

      // Busca tudo paralelo
      const [aggRes, marcRes, regsRes, judgesRes, configRes] = await Promise.all([
        supabase.from('deliberation_aggregate')
          .select('*').eq('event_id', ev.id),
        supabase.from('marcacoes_juri')
          .select('judge_id, registration_id').eq('event_id', ev.id),
        supabase.from('registrations')
          .select('id, nome_coreografia, estudio, estilo_danca, categoria').eq('event_id', ev.id),
        supabase.from('judges')
          .select('id, name, avatar_url'),
        supabase.from('configuracoes')
          .select('premios_especiais, medal_thresholds').eq('event_id', ev.id).maybeSingle(),
      ]);

      setAggregate(aggRes.data ?? []);
      setMarcacoes(marcRes.data ?? []);
      setRegistrations(regsRes.data ?? []);
      setJudges(judgesRes.data ?? []);
      const awardsRaw = (configRes.data as any)?.premios_especiais ?? [];
      const enabledAwards = Array.isArray(awardsRaw) ? awardsRaw.filter((a: any) => a?.enabled) : [];
      setAwards(enabledAwards);
      const initEdits: Record<string, { nome: string; estudio: string }> = {};
      enabledAwards.forEach((a: any) => { if (a?.id != null) initEdits[String(a.id)] = { nome: a.winner_nome ?? '', estudio: a.winner_estudio ?? '' }; });
      setWinnerEdits(initEdits);
      setWinnersSaved(false);
      const thr = (configRes.data as any)?.medal_thresholds;
      setThresholds({
        gold:   Number(thr?.gold   ?? 9),
        silver: Number(thr?.silver ?? 8),
        bronze: Number(thr?.bronze ?? 7),
      });

      // Médias dos jurados por coreografia — alimenta "Vencedores por prêmio"
      // (faixa Ouro/Prata/Bronze + Maior Nota saem daqui, igual ao Telão/PDF).
      const regIds = (regsRes.data ?? []).map((r: any) => r.id);
      const { data: evalsData } = regIds.length > 0
        ? await supabase.from('evaluations')
            .select('registration_id, final_weighted_average')
            .in('registration_id', regIds)
        : { data: [] };
      setMedias((evalsData as any) ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'failed_to_load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalJudges = judges.length || 1;

  /* ── Indexes ── */
  const regsById = useMemo(() => {
    const m = new Map<string, any>();
    registrations.forEach(r => m.set(r.id, r));
    return m;
  }, [registrations]);

  const judgesById = useMemo(() => {
    const m = new Map<string, any>();
    judges.forEach(j => m.set(j.id, j));
    return m;
  }, [judges]);

  // Marcações por jurado (quantas estrelas cada jurado deu)
  const starsByJudge = useMemo(() => {
    const m = new Map<string, number>();
    marcacoes.forEach(mk => {
      m.set(mk.judge_id, (m.get(mk.judge_id) ?? 0) + 1);
    });
    return m;
  }, [marcacoes]);

  // Agrupa aggregate por award
  const aggByAward = useMemo(() => {
    const m = new Map<string, any[]>();
    aggregate.forEach(a => {
      const arr = m.get(a.award_id) ?? [];
      arr.push(a);
      m.set(a.award_id, arr);
    });
    // Ordena cada array por count desc
    m.forEach(arr => arr.sort((a, b) => b.judge_count - a.judge_count));
    return m;
  }, [aggregate]);

  // Média final por coreografia (média das notas dos jurados que fecharam nota)
  const mediaByReg = useMemo(() => {
    const acc = new Map<string, { soma: number; n: number }>();
    medias.forEach(e => {
      if (e.final_weighted_average == null) return;
      const cur = acc.get(e.registration_id) ?? { soma: 0, n: 0 };
      cur.soma += Number(e.final_weighted_average); cur.n += 1;
      acc.set(e.registration_id, cur);
    });
    const m = new Map<string, number>();
    acc.forEach((v, k) => { if (v.n > 0) m.set(k, v.soma / v.n); });
    return m;
  }, [medias]);

  // Coreografias ordenadas por média (desc) — base pra faixa/maior nota.
  const rankedByMedia = useMemo(() => {
    return registrations
      .map(r => ({ reg: r, media: mediaByReg.get(r.id) }))
      .filter((x): x is { reg: any; media: number } => x.media != null)
      .sort((a, b) => b.media - a.media);
  }, [registrations, mediaByReg]);

  /* ── Vencedores por prêmio — o "quem ganhou" que faltava nesta tela.
     faixa/maior_nota saem das médias; deliberação usa o agregado da banca;
     manual (Voto Popular) é revelado na cerimônia. ── */
  type Winner = { nome: string; estudio?: string; media?: number };
  type AwardResult = { fonte: string; hint?: string; winners: Winner[] };
  const winnersByAward = useMemo(() => {
    const m = new Map<string, AwardResult>();
    awards.forEach((aw: any) => {
      const r = classifyAward(aw.name ?? '', aw.description ?? '');
      if (r.tipo === 'faixa') {
        const lo = r.faixa === 'ouro' ? thresholds.gold : r.faixa === 'prata' ? thresholds.silver : thresholds.bronze;
        const hi = r.faixa === 'ouro' ? null : r.faixa === 'prata' ? thresholds.gold : thresholds.silver;
        const naFaixa = rankedByMedia.filter(x => x.media >= lo && (hi == null || x.media < hi));
        m.set(aw.id, {
          fonte: `Faixa ${r.faixa} · média dos jurados`,
          hint: naFaixa.length === 0 ? 'Nenhuma coreografia nesta faixa' : undefined,
          winners: naFaixa.map(x => ({ nome: x.reg.nome_coreografia ?? '—', estudio: x.reg.estudio, media: x.media })),
        });
      } else if (r.tipo === 'maior_nota') {
        const top = rankedByMedia[0];
        m.set(aw.id, {
          fonte: 'Maior média do festival',
          hint: top ? undefined : 'Sem notas ainda',
          winners: top ? [{ nome: top.reg.nome_coreografia ?? '—', estudio: top.reg.estudio, media: top.media }] : [],
        });
      } else if (r.tipo === 'manual') {
        m.set(aw.id, { fonte: 'Revelado na cerimônia (Voto Popular)', winners: [] });
      } else {
        // 'premio' = deliberação da banca
        const entries = aggByAward.get(aw.id) ?? [];
        const top = entries[0];
        const reg = top ? regsById.get(top.registration_id) : null;
        m.set(aw.id, {
          fonte: 'Deliberação da banca',
          hint: reg ? undefined : 'Sem deliberação — revele o vencedor na mão no Telão',
          winners: reg ? [{ nome: reg.nome_coreografia ?? '—', estudio: reg.estudio }] : [],
        });
      }
    });
    return m;
  }, [awards, thresholds, rankedByMedia, aggByAward, regsById]);

  /* ── Avançar fase do gate ── */
  const advancePhase = async () => {
    if (!event) return;
    const next = STATUS_NEXT[event.deliberation_status as DeliberationStatus];
    if (!next) return;

    const confirmMsg = next === 'LIBERADO'
      ? 'Liberar resultados pro produtor? Esta ação não pode ser desfeita facilmente.'
      : `Avançar fase para "${STATUS_LABEL[next]}"?`;
    if (!window.confirm(confirmMsg)) return;

    setAdvancing(true);
    try {
      const updates: any = { deliberation_status: next };
      if (next === 'CONFERENCIA') {
        updates.conferencia_started_at = new Date().toISOString();
      }
      if (next === 'LIBERADO') {
        const { data: { user } } = await supabase.auth.getUser();
        updates.deliberation_released_at = new Date().toISOString();
        updates.deliberation_released_by = user?.id ?? null;
      }
      const { error: upErr } = await supabase
        .from('events')
        .update(updates)
        .eq('id', event.id);
      if (upErr) throw upErr;
      await fetchData();
    } catch (e: any) {
      alert('Erro ao avançar fase: ' + (e?.message ?? 'desconhecido'));
    } finally {
      setAdvancing(false);
    }
  };

  /* ── Salvar vencedores em premios_especiais (fonte da verdade pro Telão e
     pra vitrine pública) ── Read-modify-write pra preservar os prêmios/flags.
     Prêmios editáveis (pessoa/Voto Popular) gravam o que foi digitado/puxado.
     Prêmios automáticos (faixa/maior nota) gravam o resultado RECALCULADO
     agora — sobrescreve qualquer dado velho/errado (ex: de um ✋ manual usado
     por engano num prêmio automático antes desse fluxo existir). */
  const saveWinners = async () => {
    if (!event) return;
    setSavingWinners(true);
    try {
      const { data, error } = await supabase.from('configuracoes')
        .select('premios_especiais').eq('event_id', event.id).maybeSingle();
      if (error) throw error;
      const arr = Array.isArray((data as any)?.premios_especiais) ? (data as any).premios_especiais : [];
      const next = arr.map((a: any) => {
        if (a?.id == null) return a;
        // Classifica PRIMEIRO — faixa/maior_nota sempre recalculam do zero,
        // nunca usam winnerEdits (que é inicializado pra TODO prêmio no fetch,
        // mesmo os automáticos, com {nome:'', estudio:''} quando nunca editado
        // — usar `if (edit)` ali regravava esse objeto vazio/velho por cima do
        // cálculo real e travava Maior Nota/Ouro/Prata/Bronze no valor antigo).
        const rev = classifyAward(a.name ?? '', a.description ?? '');
        if (rev.tipo === 'faixa') {
          const res = winnersByAward.get(String(a.id));
          return { ...a, winner_nome: null, winner_estudio: null, winner_items: (res?.winners ?? []).map(w => ({ nome: w.nome, estudio: w.estudio ?? '', media: w.media })) };
        }
        if (rev.tipo === 'maior_nota') {
          const res = winnersByAward.get(String(a.id));
          const top = res?.winners?.[0];
          return { ...a, winner_nome: top?.nome ?? null, winner_estudio: top?.estudio ?? null, winner_items: null };
        }
        const edit = winnerEdits[String(a.id)];
        if (!edit) return a;
        return { ...a, winner_nome: edit.nome.trim(), winner_estudio: edit.estudio.trim(), winner_items: null };
      });
      const { error: upErr } = await supabase.from('configuracoes')
        .update({ premios_especiais: next }).eq('event_id', event.id);
      if (upErr) throw upErr;
      setWinnersSaved(true);
      setWinnersLocked(true);
      setTimeout(() => setWinnersSaved(false), 2500);
      await fetchData();
    } catch (e: any) {
      alert('Erro ao salvar vencedores: ' + (e?.message ?? 'desconhecido'));
    } finally {
      setSavingWinners(false);
    }
  };

  /* ── Puxar vencedor do Voto Popular (mesma integração do Telão) ──
     Preenche os campos do prêmio; o produtor confere e clica em Salvar. */
  const votoReasonLabel: Record<string, string> = {
    voting_not_closed: 'A votação do Voto Popular ainda está aberta — encerre no console do operador.',
    tie: 'Empate no Voto Popular — escolha o vencedor na mão.',
    no_votes: 'Nenhum voto registrado ainda no Voto Popular.',
    festival_not_found: 'Este evento não está vinculado a um festival no Voto Popular.',
    group_not_linked: 'A coreografia vencedora não está vinculada a essa inscrição no CoreoHub.',
    registration_not_found: 'Inscrição vencedora não encontrada no CoreoHub.',
    unauthorized: 'Sessão expirada — recarregue a página e tente de novo.',
  };
  const pullVotoPopular = async (awardId: string) => {
    if (!event) return;
    setVotoMsg(null);
    setPullingVoto(awardId);
    try {
      const { data, error } = await supabase.functions.invoke('get-voto-popular-winner', { body: { event_id: event.id } });
      if (!error && (data as any)?.ok) {
        const w = data as { nome: string; estudio: string };
        setWinnerEdits((p) => ({ ...p, [awardId]: { nome: w.nome ?? '', estudio: w.estudio ?? '' } }));
        return;
      }
      let reason = (data as any)?.reason ?? (data as any)?.error as string | undefined;
      if (!reason && error && typeof (error as any).context?.json === 'function') {
        try { const body = await (error as any).context.json(); reason = body?.reason ?? body?.error; } catch { /* corpo não-JSON */ }
      }
      setVotoMsg(reason ? (votoReasonLabel[reason] ?? reason) : 'Resultado automático indisponível — digite o vencedor na mão.');
    } catch {
      setVotoMsg('Não foi possível buscar o resultado do Voto Popular — digite o vencedor na mão.');
    } finally {
      setPullingVoto(null);
    }
  };

  /* ── Renders ── */
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={28} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-12 text-center bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-3xl">
        <AlertCircle size={28} className="mx-auto text-rose-500 mb-2" />
        <p className="text-sm font-bold text-rose-700 dark:text-rose-400">{error}</p>
      </div>
    );
  }

  const status = event?.deliberation_status as DeliberationStatus;
  const totalMarcacoes = marcacoes.length;
  const totalDeliberations = aggregate.reduce((s, a) => s + a.judge_count, 0);
  // Só mostra o painel legado de deliberação (indicações/consenso) quando a
  // banca de fato ATRIBUIU prêmios (não basta 1 ⭐ solta sem atribuição) — e só
  // pros prêmios de deliberação ('premio'); Ouro/Prata/Bronze/Maior Nota/Voto
  // Popular nunca são decididos assim, então nunca deveriam aparecer ali.
  const premioAwards = awards.filter((aw: any) => classifyAward(aw.name ?? '', aw.description ?? '').tipo === 'premio');
  const showDeliberation = totalDeliberations > 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
            Premiação
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1 truncate">
            {event?.name ?? 'Evento ativo'}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all"
          title="Recarregar"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center">
          <Star size={18} className="text-amber-500 mx-auto mb-1.5" />
          <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Marcações ⭐</p>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{totalMarcacoes}</p>
        </div>
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center">
          <Trophy size={18} className="text-violet-500 mx-auto mb-1.5" />
          <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Atribuições</p>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{totalDeliberations}</p>
        </div>
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center">
          <Users size={18} className="text-[#ff0068] mx-auto mb-1.5" />
          <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Jurados</p>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{totalJudges}</p>
        </div>
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center">
          <CheckCircle2 size={18} className="text-emerald-500 mx-auto mb-1.5" />
          <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Prêmios</p>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-0.5">{awards.length}</p>
        </div>
      </div>

      {/* Vencedores por prêmio — auto (faixa/maior nota das médias) read-only;
          prêmios de pessoa / Voto Popular são digitados e salvos aqui (mesma
          fonte que o Telão revela). */}
      {awards.length > 0 && (() => {
        const awardMeta = awards.map((aw: any) => {
          const rev = classifyAward(aw.name ?? '', aw.description ?? '');
          const auto = rev.tipo === 'faixa' || rev.tipo === 'maior_nota';
          const hasDelibWinner = rev.tipo === 'premio' && (aggByAward.get(aw.id)?.length ?? 0) > 0 && !aw.winner_nome;
          return { aw, rev, editable: !auto && !hasDelibWinner };
        });
        const hasEditable = awardMeta.some(m => m.editable);
        return (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <Trophy size={16} className="text-[#ff0068]" />
              Vencedores por prêmio
            </h2>
            {/* Salva também os automáticos (recalcula do zero, sobrescrevendo
                qualquer dado antigo) — é isso que publica na vitrine pública.
                Depois de salvar, os campos travam e o mesmo botão vira
                "Editar" pra reabrir — evita mexer sem querer na correria. */}
            {winnersLocked ? (
              <button onClick={() => setWinnersLocked(false)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
                <Unlock size={12} /> Editar vencedores
              </button>
            ) : (
              <button onClick={saveWinners} disabled={savingWinners}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all disabled:opacity-50">
                {savingWinners ? <Loader2 size={12} className="animate-spin" /> : winnersSaved ? <CheckCircle2 size={12} /> : <Send size={12} />}
                {winnersSaved ? 'Salvo' : 'Salvar vencedores'}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {awardMeta.map(({ aw, rev, editable: editableType }) => {
              const res = winnersByAward.get(aw.id);
              const edit = winnerEdits[aw.id] ?? { nome: '', estudio: '' };
              const editable = editableType && !winnersLocked;
              const fonte = editableType
                ? (rev.tipo === 'manual' ? 'Voto Popular / definido na cerimônia' : 'Prêmio da banca — digite o vencedor')
                : res?.fonte;
              return (
                <div key={aw.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{aw.name}</h3>
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mt-0.5 truncate">{fonte}</p>
                    </div>
                    {aw.valor != null && Number(aw.valor) > 0 && (
                      <span className="shrink-0 text-[10px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        R$ {Number(aw.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>

                  {editable ? (
                    <div className="p-4 space-y-2">
                      {rev.tipo === 'manual' && (
                        <>
                          <button onClick={() => pullVotoPopular(aw.id)} disabled={pullingVoto === aw.id}
                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1de7f2]/10 border border-[#1de7f2]/30 text-[#0891a0] dark:text-[#1de7f2] rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-[#1de7f2]/20 transition-all disabled:opacity-50">
                            {pullingVoto === aw.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            Puxar vencedor do Voto Popular
                          </button>
                          {votoMsg && <p role="alert" className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{votoMsg}</p>}
                        </>
                      )}
                      <input value={edit.nome}
                        onChange={(e) => setWinnerEdits((p) => ({ ...p, [aw.id]: { ...edit, nome: e.target.value } }))}
                        placeholder="Nome do vencedor (pessoa ou coreografia)"
                        aria-label={`Vencedor de ${aw.name}`}
                        className="w-full px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50" />
                      <input value={edit.estudio}
                        onChange={(e) => setWinnerEdits((p) => ({ ...p, [aw.id]: { ...edit, estudio: e.target.value } }))}
                        placeholder="Estúdio / grupo (opcional)"
                        aria-label={`Estúdio do vencedor de ${aw.name}`}
                        className="w-full px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50" />

                      {/* Ou selecionar uma coreografia já cadastrada — cobre prêmios como
                          Melhor Coreografia/Grupo, além do texto livre (pessoa fora da lista). */}
                      {registrations.length > 0 && (() => {
                        const q = (pickerSearch[aw.id] ?? '').toLowerCase();
                        const opts = registrations
                          .filter((r: any) => !q || `${r.nome_coreografia ?? ''} ${r.estudio ?? ''}`.toLowerCase().includes(q))
                          .slice(0, 30);
                        return (
                          <div className="pt-1">
                            <input value={pickerSearch[aw.id] ?? ''}
                              onChange={(e) => setPickerSearch((p) => ({ ...p, [aw.id]: e.target.value }))}
                              placeholder="Ou buscar coreografia cadastrada…"
                              aria-label={`Buscar coreografia pra ${aw.name}`}
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50" />
                            {q && (
                              <div className="max-h-40 overflow-y-auto mt-1.5 space-y-1">
                                {opts.length === 0 ? (
                                  <p className="text-[10px] text-slate-400 px-1 py-1">Nenhuma coreografia encontrada.</p>
                                ) : opts.map((r: any) => (
                                  <button key={r.id} type="button"
                                    onClick={() => {
                                      setWinnerEdits((p) => ({ ...p, [aw.id]: { nome: r.nome_coreografia ?? '', estudio: r.estudio ?? '' } }));
                                      setPickerSearch((p) => ({ ...p, [aw.id]: '' }));
                                    }}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left bg-white dark:bg-white/5 hover:bg-[#ff0068]/10 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase tracking-wide transition-all">
                                    <span className="truncate">{r.nome_coreografia}</span>
                                    {r.estudio && <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[45%]">{r.estudio}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : editableType && winnersLocked ? (
                    // Travado pós-salvar — mostra o valor salvo (edit reflete o
                    // que veio do banco via fetchData), não o cálculo automático
                    // (que ficaria vazio pra esses tipos).
                    edit.nome ? (
                      <div className="px-4 py-3 flex items-center gap-3">
                        <Trophy size={14} className="shrink-0 text-yellow-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{edit.nome}</p>
                          {edit.estudio && <p className="text-[9px] text-slate-500 uppercase font-bold truncate">{edit.estudio}</p>}
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-5 text-center">
                        <p className="text-[10px] text-slate-400 italic">A revelar na cerimônia</p>
                      </div>
                    )
                  ) : res && res.winners.length > 0 ? (
                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                      {res.winners.map((w, idx) => (
                        <div key={idx} className="px-4 py-3 flex items-center gap-3">
                          <Trophy size={14} className={`shrink-0 ${idx === 0 ? 'text-yellow-500' : 'text-slate-300 dark:text-slate-600'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{w.nome}</p>
                            {w.estudio && <p className="text-[9px] text-slate-500 uppercase font-bold truncate">{w.estudio}</p>}
                          </div>
                          {w.media != null && (
                            <span className="shrink-0 text-lg font-black italic tabular-nums text-slate-900 dark:text-white">{w.media.toFixed(2)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-center">
                      <p className="text-[10px] text-slate-400 italic">{res?.hint ?? 'A revelar na cerimônia'}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {hasEditable && (
            <p className="text-[11px] text-slate-500 mt-3">
              Ouro/Prata/Bronze e Maior Nota saem das médias dos jurados. Nos demais (Melhor Bailarino/Coreógrafo, Voto Popular), digite o vencedor e clique em <b className="text-slate-600 dark:text-slate-400">Salvar vencedores</b> — o Telão revela a partir daqui.
            </p>
          )}
        </div>
        );
      })()}

      {/* Gate de fase */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Fase atual</p>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1">
              {STATUS_LABEL[status]}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              {STATUS_DESCRIPTION[status]}
            </p>
          </div>

          {STATUS_NEXT[status] && (
            <button
              onClick={advancePhase}
              disabled={advancing}
              className="w-full sm:w-auto sm:shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all disabled:opacity-50"
            >
              {advancing ? <Loader2 size={12} className="animate-spin" /> : (
                STATUS_NEXT[status] === 'LIBERADO' ? <Unlock size={12} /> : <ChevronRight size={12} />
              )}
              Avançar para: {STATUS_LABEL[STATUS_NEXT[status]!]}
            </button>
          )}
          {status === 'LIBERADO' && (
            <div className="self-start inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl">
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Liberado</span>
            </div>
          )}
        </div>

        {/* Pista de fases */}
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {(Object.keys(STATUS_LABEL) as DeliberationStatus[]).map((s, idx) => {
            const order = ['COLETANDO', 'DELIBERACAO', 'CONFERENCIA', 'LIBERADO'].indexOf(status);
            const isPast    = idx < order;
            const isCurrent = idx === order;
            return (
              <div
                key={s}
                className={`h-1 rounded-full transition-all ${
                  isPast || isCurrent ? 'bg-[#ff0068]' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Painel agregado por prêmio (deliberação da banca) */}
      {showDeliberation && (
      <div>
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-[#ff0068]" />
          Indicações por prêmio
        </h2>

        {premioAwards.length === 0 ? (
          <div className="p-8 bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-center">
            <p className="text-[11px] font-bold text-slate-400">
              Nenhum prêmio de deliberação configurado em <strong>Configurações → Prêmios</strong>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {premioAwards.map((aw: any) => {
              const entries = aggByAward.get(aw.id) ?? [];
              const topConsensus = entries.length > 0 ? entries[0].judge_count : 0;
              const consensusPct = totalJudges > 0
                ? Math.round((topConsensus / totalJudges) * 100)
                : 0;

              return (
                <div
                  key={aw.id}
                  className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden"
                >
                  {/* Header do prêmio */}
                  <div className="px-4 py-3 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                        {aw.name}
                      </h3>
                      {aw.description && (
                        <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">{aw.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Top consenso</p>
                      <p className={`text-sm font-black tabular-nums ${
                        consensusPct >= 60 ? 'text-emerald-500' :
                        consensusPct >= 30 ? 'text-amber-500' :
                        'text-slate-400'
                      }`}>
                        {consensusPct}%
                      </p>
                    </div>
                  </div>

                  {/* Lista de coreografias indicadas */}
                  {entries.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[10px] text-slate-400 italic">Nenhuma indicação</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                      {entries.map((e: any, idx: number) => {
                        const reg = regsById.get(e.registration_id);
                        const pct = totalJudges > 0 ? Math.round((e.judge_count / totalJudges) * 100) : 0;
                        return (
                          <div key={`${e.registration_id}-${e.award_id}`} className="px-4 py-3 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                              idx === 0 ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                              idx === 1 ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300' :
                              idx === 2 ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-500' :
                              'bg-slate-50 dark:bg-white/5 text-slate-400'
                            }`}>
                              {idx + 1}°
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                                {reg?.nome_coreografia ?? '—'}
                              </p>
                              <p className="text-[9px] text-slate-500 uppercase font-bold">
                                {reg?.estudio} · {reg?.estilo_danca} · {reg?.categoria}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-[#ff0068]"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-black tabular-nums text-slate-700 dark:text-slate-300 min-w-[60px] text-right">
                                {e.judge_count}/{totalJudges}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Marcações por jurado */}
      {showDeliberation && (
      <div>
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <Star size={16} className="text-amber-500" />
          Engajamento dos jurados
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {judges.map(j => {
            const count = starsByJudge.get(j.id) ?? 0;
            return (
              <div key={j.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {j.avatar_url ? <img src={j.avatar_url} alt="" className="w-full h-full object-cover" /> : <Users size={14} className="text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{j.name}</p>
                  <p className="text-[9px] text-slate-500 font-bold">
                    {count} marcaç{count === 1 ? 'ão' : 'ões'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
};

export default Deliberacoes;
