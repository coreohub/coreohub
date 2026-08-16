import React, { useEffect, useState, useCallback } from 'react';
import { MonitorPlay, Copy, ExternalLink, RefreshCw, Check, Loader2, FlaskConical, Power, Radio, Trophy, X } from 'lucide-react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import { trackFeatureUsed } from '../services/appAnalytics';
import PageHeader from '../components/PageHeader';
import { classifyAward, type AwardReveal } from '../utils/awardClassification';

interface Premio { id: string; nome: string; valor?: string; description?: string; winner_nome?: string; winner_estudio?: string; }

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
  // Telão é só leitura — não edita vencedor. A edição (digitar/puxar do Voto
  // Popular) fica exclusivamente em Resultados → Premiação; aqui só revela o
  // que já está salvo lá (winner_nome) ou calculado (faixa/maior nota).
  const [revealError, setRevealError] = useState<string | null>(null);
  // Se a banca nunca deliberou UM prêmio específico ('premio', ex: Melhor
  // Bailarino/Coreógrafo), não há vencedor automático pra ele — clicar abre
  // direto o campo de digitar o vencedor na mão. Checagem é POR PRÊMIO (não
  // pro evento inteiro) — um evento pode ter deliberação em 1 prêmio e não
  // noutro, e tratar isso como "tudo deliberado" revelaria vazio no LED.
  const [deliberatedAwardIds, setDeliberatedAwardIds] = useState<Set<string>>(new Set());

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = code ? `${origin}/telao/${code}` : '';

  // Carrega os prêmios especiais + quais já têm deliberação real da banca.
  const loadPremiacaoOptions = useCallback(async (id: string) => {
    const [{ data: cfg, error: cfgErr }, { data: delib, error: delibErr }] = await Promise.all([
      supabase.from('configuracoes').select('premios_especiais').eq('event_id', id).maybeSingle(),
      supabase.from('deliberation_aggregate').select('award_id').eq('event_id', id),
    ]);
    // Coluna ausente (migration não aplicada) vira PGRST204 e `data` some
    // silenciosamente igual a "não existe" — sempre logar o erro real.
    if (cfgErr) console.error('loadPremiacaoOptions: premios_especiais', cfgErr);
    if (delibErr) console.error('loadPremiacaoOptions: deliberation_aggregate', delibErr);
    setDeliberatedAwardIds(new Set((delib ?? []).map((d: any) => String(d.award_id))));

    const raw = (cfg as any)?.premios_especiais ?? [];
    setPremios((Array.isArray(raw) ? raw : [])
      .filter((a: any) => a && a.enabled !== false && a.id != null)
      .map((a: any) => ({
        id: String(a.id),
        nome: (a.nome ?? a.name ?? 'Prêmio').trim(),
        valor: a.valor ? String(a.valor) : undefined,
        description: a.description ?? a.descricao ?? '',
        winner_nome: a.winner_nome ?? undefined,
        winner_estudio: a.winner_estudio ?? undefined,
      })));
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

  // Grava um patch parcial no prêmio dentro de configuracoes.premios_especiais
  // (fonte da verdade compartilhada com Premiação/PDF/vitrine) via RPC atômica
  // — evita o antigo SELECT+UPDATE do client (2 round-trips com janela de
  // corrida real: produtor usa Telão numa aba e Premiação noutra no mesmo
  // evento ao vivo, a escrita que termina por último apagava a da outra aba).
  // Retorna sucesso/falha explícito — antes o erro só ia pro console.error e
  // o caller seguia como se tivesse dado certo. Isso deixava o LED revelar um
  // vencedor (sendPremiacao é independente, sempre funciona) enquanto o
  // registro persistente (winner_revealed) silenciosamente falhava, e a
  // vitrine pública nunca mostrava o que a plateia já viu no palco.
  const patchAward = useCallback(async (awardId: string, patch: Record<string, any>): Promise<boolean> => {
    if (!eventId) return false;
    const { error } = await supabase.rpc('update_premios_winners', {
      p_event_id: eventId,
      p_patches: { [awardId]: patch },
    });
    if (error) { console.error('patchAward', error); return false; }
    setPremios((prev) => prev.map((p) => p.id === awardId ? { ...p, ...patch } : p));
    return true;
  }, [eventId]);

  // Marca só a flag de revelado — usado quando o vencedor já vem de outro
  // cálculo (faixa/maior nota calculados na hora, ou já salvo em Premiação) e
  // só falta autorizar a vitrine pública a mostrar. Sem isso, a vitrine
  // mostrava o resultado assim que alguém salvasse em Premiação, antes da
  // revelação ao vivo no palco — quebrava a graça da cerimônia.
  const markRevealed = useCallback((awardId: string) => patchAward(awardId, { winner_revealed: true }), [patchAward]);

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

  // Telão só REVELA — nunca edita. Se um prêmio não tem vencedor pra revelar
  // ainda (pessoa/deliberação sem fonte automática, Voto Popular sem
  // integração disponível), a correção é sempre em Resultados → Premiação,
  // nunca aqui. Registra ANTES de revelar (winner_revealed vira a autorização
  // da vitrine pública) — se o registro falhar, aborta sem revelar no LED,
  // pra nunca deixar palco e vitrine dessincronizados.
  const revelarAward = async (a: Premio) => {
    setRevealError(null);
    trackFeatureUsed('revelar_premio_telao', { award_name: a.nome });
    const r = classifyAward(a.nome, a.description);
    const valor = fmtValor(a.valor);
    // Vencedor já salvo em Premiação = fonte da verdade pra QUALQUER tipo —
    // revela direto, sem recalcular. Cobre também Ouro/Prata/Bronze/Maior
    // Nota quando o produtor sobrescreveu lá um cálculo vazio/errado.
    if (a.winner_nome) {
      if (!await markRevealed(a.id)) { alert('Não foi possível registrar a revelação. Tente de novo.'); return; }
      return sendPremiacao({ tipo: 'manual', titulo: a.nome, valor, nome: a.winner_nome, estudio: a.winner_estudio ?? '' });
    }
    if (r.tipo === 'faixa') {
      if (!await markRevealed(a.id)) { alert('Não foi possível registrar a revelação. Tente de novo.'); return; }
      return sendPremiacao({ tipo: 'faixa', faixa: r.faixa, titulo: a.nome, valor });
    }
    if (r.tipo === 'maior_nota') {
      if (!await markRevealed(a.id)) { alert('Não foi possível registrar a revelação. Tente de novo.'); return; }
      return sendPremiacao({ tipo: 'maior_nota', titulo: a.nome, valor });
    }
    if (r.tipo === 'manual') {
      // Troféu Voto Popular: automático é a via principal (padrão de mercado —
      // reduz erro humano na hora da cerimônia).
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-voto-popular-winner', {
          body: { event_id: eventId },
        });
        if (!error && (data as any)?.ok) {
          const w = data as { nome: string; estudio: string };
          const ok = await patchAward(a.id, { winner_nome: w.nome, winner_estudio: w.estudio, winner_items: null, winner_revealed: true });
          if (!ok) { setRevealError('Vencedor encontrado, mas não foi possível registrar. Tente de novo.'); return; }
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
        setRevealError((reason ? votoReasonLabel[reason] ?? reason : 'Resultado automático indisponível.') + ' Digite o vencedor em Resultados → Premiação.');
      } catch {
        setRevealError('Não foi possível buscar o resultado automático do Voto Popular. Digite o vencedor em Resultados → Premiação.');
      } finally {
        setBusy(false);
      }
      return;
    }
    // 'premio' = vencedor por deliberação da banca. Se ninguém deliberou ESSE
    // prêmio específico (checagem por award_id, não pro evento inteiro — um
    // evento pode ter deliberação num prêmio e não noutro), não há fonte
    // automática — pede pra resolver em Premiação em vez de abrir editor aqui.
    if (!deliberatedAwardIds.has(a.id)) {
      setRevealError(`"${a.nome}" ainda não tem vencedor. Vá em Resultados → Premiação, confirme o vencedor e clique em Salvar vencedores.`);
      return;
    }
    if (!await markRevealed(a.id)) { alert('Não foi possível registrar a revelação. Tente de novo.'); return; }
    return sendPremiacao({ tipo: 'premio', award_id: a.id, titulo: a.nome, valor });
  };

  const isActive = (a: Premio, r: AwardReveal) => {
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
            <div className="bg-slate-950 border border-white/10 rounded-2xl p-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-2">Código do telão</p>
              <p className="text-5xl font-black italic tracking-tighter text-white tabular-nums select-all">{code}</p>
              <p className="text-[11px] text-slate-300 mt-3 uppercase tracking-widest">
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
                const r = classifyAward(a.nome, a.description);
                const active = isActive(a, r);
                return (
                  <button key={a.id} onClick={() => revelarAward(a)} disabled={busy}
                    className={`w-full min-w-0 flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all text-left disabled:opacity-50 ${active ? 'bg-[#ff0068] text-white shadow-md' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="truncate">{a.nome}{a.valor && <span className="opacity-60"> · R$ {Number(a.valor).toLocaleString('pt-BR')}</span>}</span>
                      {a.winner_nome && (
                        <span className={`truncate text-[9px] font-bold normal-case tracking-normal ${active ? 'text-white/80' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          Vencedor: {a.winner_nome}{a.winner_estudio ? ` · ${a.winner_estudio}` : ''}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 text-[8px] px-2 py-0.5 rounded ${active ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400'}`}>
                      {revealLabel[r.tipo === 'faixa' ? r.faixa : r.tipo]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {revealError && (
            <p role="alert" className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
              {revealError}
            </p>
          )}

          <p className="text-[11px] text-slate-500">Faixas (Ouro/Prata/Bronze) e Maior Nota saem da média dos jurados. Os demais prêmios (Melhor Bailarino/Coreógrafo, Voto Popular) precisam ter o vencedor salvo em <b className="text-slate-600 dark:text-slate-400">Resultados → Premiação</b> antes — o Telão só revela, não edita. Nada aparece na plateia até você clicar aqui.</p>
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
