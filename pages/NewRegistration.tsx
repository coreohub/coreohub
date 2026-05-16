import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { eventFilterColumn } from '../services/eventResolver';
import { ChevronRight, Loader2, Music2, Users, User, AlertCircle } from 'lucide-react';

const input = 'w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm dark:[color-scheme:dark]';
const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

const NewRegistration = () => {
  // Rota aceita UUID ou slug do evento (Fase 1 — Padronização de URLs).
  // Resolvemos pro UUID interno (`eventId`) na primeira query e usamos daí pra frente.
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const [eventId, setEventId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Modalidade pré-selecionada via query string (entry point modalidade-first
  // dos cards da vitrine pública). Aplicado quando formacoes_config carrega.
  const preselectedModalidade = new URLSearchParams(location.search).get('modalidade');

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [form, setForm] = useState({
    choreography_name: '',
    formacao: '',
    category: '',
    dance_style: '',
    subgenero: '',
    num_participants: 1,
  });

  const [config, setConfig] = useState<any>(null);
  // Gêneros estruturados (event_styles) — fonte da verdade nova com sub_types.
  // Usado pra dropdown de modalidade dependente do gênero escolhido.
  const [eventStyles, setEventStyles] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/auth'); return; }
      setUserId(user.id);

      // Resolve evento por UUID ou slug primeiro (Fase 1). As demais queries
      // dependem do UUID interno (event_id), então precisam aguardar essa primeira.
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, slug, description, start_date, end_date, formacoes_config, cover_url')
        .eq(eventFilterColumn(idOrSlug), idOrSlug)
        .maybeSingle();

      if (evErr || !ev) { setError('Evento não encontrado.'); setLoading(false); return; }
      const resolvedEventId = ev.id as string;
      setEventId(resolvedEventId);

      // Categorias, estilos e prazo de inscrição moram em `configuracoes`,
      // não em `events`. Carregamos em paralelo agora que temos o UUID resolvido.
      // Também carregamos event_styles (tabela nova com sub_types/modalidades).
      const [{ data: cfg }, { data: styles }] = await Promise.all([
        supabase
          .from('configuracoes')
          .select('categorias, estilos, prazo_inscricao')
          .eq('event_id', resolvedEventId)
          .maybeSingle(),
        supabase
          .from('event_styles')
          .select('id, name, is_active, sub_types')
          .eq('event_id', resolvedEventId)
          .eq('is_active', true)
          .order('name'),
      ]);

      // Se a row per-event não tiver dados (evento recém-criado sem config),
      // tenta a row legacy id='1' como fallback.
      let configFinal: any = cfg;
      if (!configFinal || (!configFinal.categorias && !configFinal.estilos)) {
        const { data: legacy } = await supabase
          .from('configuracoes')
          .select('categorias, estilos, prazo_inscricao')
          .eq('id', '1')
          .maybeSingle();
        configFinal = legacy ?? configFinal;
      }

      setEvent(ev);
      setConfig(configFinal);
      setEventStyles(styles ?? []);

      // Aplica modalidade pré-selecionada (case-insensitive contra formacoes_config).
      // Vem dos cards clicáveis na vitrine pública — entry point modalidade-first.
      if (preselectedModalidade && Array.isArray(ev.formacoes_config)) {
        const match = ev.formacoes_config.find((m: any) =>
          m.name?.trim().toLowerCase() === preselectedModalidade.trim().toLowerCase()
        );
        if (match) setForm(f => ({ ...f, formacao: match.name }));
      }

      setLoading(false);
    };
    load();
  }, [idOrSlug, navigate, preselectedModalidade]);

  const formacoes: any[] = event?.formacoes_config ?? [];
  const categories: any[] = config?.categorias ?? [];
  // Estilos: prioriza event_styles (tabela nova, tem sub_types). Fallback pra
  // configuracoes.estilos (legacy string[]). Normaliza pra { id, name, sub_types }.
  const styles: { id: string; name: string; sub_types?: any[] }[] = eventStyles.length > 0
    ? eventStyles.map((s: any) => ({
        id: s.id,
        name: s.name,
        sub_types: Array.isArray(s.sub_types) ? s.sub_types : [],
      }))
    : (config?.estilos ?? []).map((s: any, i: number) =>
        typeof s === 'string'
          ? { id: `s_${i}`, name: s, sub_types: [] }
          : { id: s.id ?? s.name ?? `s_${i}`, name: s.name ?? '', sub_types: s.sub_types ?? [] }
      ).filter((s: any) => s.name);

  // Modalidades (sub_types) do gênero selecionado. Quando vazio, esconde
  // o select de modalidade. Permite gênero "direto" sem subdivisão.
  const selectedStyle = styles.find(s => s.name === form.dance_style);
  const modalities: { name: string }[] = (selectedStyle?.sub_types ?? [])
    .map((m: any) => ({ name: typeof m === 'string' ? m : (m.name ?? '') }))
    .filter((m: any) => m.name);

  // Reset subgenero quando troca o gênero (modalidade antiga não vale).
  useEffect(() => {
    setForm(f => ({ ...f, subgenero: '' }));
  }, [form.dance_style]);

  const selectedFormacao = formacoes.find(m => m.name === form.formacao);
  const fee: number = selectedFormacao?.fee ?? selectedFormacao?.base_fee ?? 0;

  // Limites de participantes da formação selecionada (Solo: 1, Duo: 2, etc).
  const minMembers: number = Number(selectedFormacao?.min_members ?? 1);
  const maxMembers: number = Number(selectedFormacao?.max_members ?? 50);

  // Reseta num_participants pro mínimo da formação ao trocar de formação,
  // ou clamp se estiver fora dos limites.
  useEffect(() => {
    if (!selectedFormacao) return;
    setForm(f => {
      if (f.num_participants < minMembers || f.num_participants > maxMembers) {
        return { ...f, num_participants: minMembers };
      }
      return f;
    });
  }, [form.formacao, minMembers, maxMembers, selectedFormacao]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.choreography_name.trim()) { setError('Informe o nome da coreografia.'); return; }
    if (!form.formacao)  { setError('Selecione a formação.'); return; }
    if (!form.category)  { setError('Selecione a categoria.'); return; }
    if (fee <= 0)        { setError('Esta formação não possui valor configurado. Contate o produtor.'); return; }
    if (form.num_participants < minMembers || form.num_participants > maxMembers) {
      setError(`Esta formação aceita de ${minMembers} a ${maxMembers} participantes.`);
      return;
    }
    // Modalidade obrigatória quando o gênero selecionado tem sub_types cadastrados
    if (form.dance_style && modalities.length > 0 && !form.subgenero) {
      setError(`Selecione a modalidade do gênero ${form.dance_style}.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Tabela `registrations` usa nomes em português. Colunas reais validadas
      // via db-introspect: nome_coreografia, formato_participacao, categoria,
      // estilo_danca, status, status_pagamento, criado_em, data_inscricao.
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .insert({
          event_id:             eventId,
          user_id:              userId,
          nome_coreografia:     form.choreography_name.trim(),
          formato_participacao: form.formacao,
          categoria:            form.category,
          estilo_danca:         form.dance_style || null,
          subgenero:            form.subgenero || null,
          status:               'PENDENTE',
          status_pagamento:     'PENDENTE',
          criado_em:            new Date().toISOString(),
          data_inscricao:       new Date().toISOString(),
        })
        .select('id')
        .single();

      if (regErr || !reg) throw regErr ?? new Error('Erro ao criar inscrição.');

      // Prefere slug pra URL bonita (link compartilhável). UUID como fallback.
      navigate(`/festival/${event?.slug ?? eventId}/checkout?registration_id=${reg.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Erro inesperado ao criar inscrição.');
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-[#ff0068]" />
    </div>
  );

  if (!event) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <AlertCircle size={40} className="text-red-400 mx-auto" />
        <p className="font-black text-xl text-slate-900 dark:text-white">Evento não encontrado</p>
        <p className="text-slate-500 text-sm">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">
      {/* Cover */}
      {event.cover_url && (
        <div className="h-48 w-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <img src={event.cover_url} alt={event.name} className="w-full h-full object-cover opacity-70" />
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-8 space-y-6">
        {/* Header */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Nova Inscrição</p>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1 italic">
            {event.name}
          </h1>
          {config?.prazo_inscricao && (
            <p className="text-xs text-slate-500 mt-1">
              Inscrições até {new Date(config.prazo_inscricao + 'T12:00:00').toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Nome da coreografia */}
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Music2 size={16} className="text-[#ff0068]" />
              <p className="font-black text-sm uppercase tracking-tight text-slate-900 dark:text-white italic">Identificação</p>
            </div>
            <div>
              <label className={label}>Nome da Coreografia / Apresentação</label>
              <input
                type="text"
                value={form.choreography_name}
                onChange={e => setForm(f => ({ ...f, choreography_name: e.target.value }))}
                placeholder="Ex: Grupo de Ballet Clássico — Studio XYZ"
                className={input}
                required
              />
            </div>
          </div>

          {/* Seleções */}
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Users size={16} className="text-[#ff0068]" />
              <p className="font-black text-sm uppercase tracking-tight text-slate-900 dark:text-white italic">Detalhes</p>
            </div>

            <div>
              <label className={label}>Formação</label>
              <select value={form.formacao} onChange={e => setForm(f => ({ ...f, formacao: e.target.value }))} className={input} required>
                <option value="">Selecione...</option>
                {formacoes.filter(m => m.is_active !== false).map((m: any) => (
                  <option key={m.id ?? m.name} value={m.name}>
                    {m.name} {(m.fee ?? m.base_fee) ? `— R$ ${(m.fee ?? m.base_fee).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label}>Categoria</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={input} required>
                <option value="">Selecione...</option>
                {categories.filter(c => c.is_active !== false).map((c: any) => (
                  <option key={c.id ?? c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            {styles.length > 0 && (
              <div>
                <label className={label}>Estilo / Gênero</label>
                <select value={form.dance_style} onChange={e => setForm(f => ({ ...f, dance_style: e.target.value }))} className={input}>
                  <option value="">Selecione (opcional)</option>
                  {styles.map((s: any) => (
                    <option key={s.id ?? s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Modalidade (sub_type) — aparece só quando o gênero selecionado
                tem modalidades cadastradas. Permite gêneros "diretos" sem
                subdivisão (Ex: Estilo Livre). */}
            {modalities.length > 0 && (
              <div>
                <label className={label}>Modalidade</label>
                <select value={form.subgenero} onChange={e => setForm(f => ({ ...f, subgenero: e.target.value }))} className={input}>
                  <option value="">Selecione a modalidade</option>
                  {modalities.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={label}>
                Número de participantes
                {minMembers === maxMembers && (
                  <span className="ml-2 text-[9px] font-bold text-slate-400 normal-case tracking-normal">
                    (fixo: {minMembers})
                  </span>
                )}
              </label>
              <div className="relative">
                <User size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  min={minMembers}
                  max={maxMembers}
                  value={form.num_participants}
                  onChange={e => setForm(f => ({ ...f, num_participants: Number(e.target.value) }))}
                  disabled={minMembers === maxMembers}
                  className={`${input} pl-9 disabled:opacity-60 disabled:cursor-not-allowed`}
                />
              </div>
              {minMembers !== maxMembers && (
                <p className="text-[10px] text-slate-500 mt-1.5 ml-1">
                  Entre {minMembers} e {maxMembers} participantes
                </p>
              )}
            </div>
          </div>

          {/* Resumo de valor */}
          {fee > 0 && (
            <div className="bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Valor da inscrição</p>
                <p className="text-xs text-slate-500 mt-0.5">{form.formacao}</p>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                R$ <span className="text-[#ff0068]">{fee.toFixed(2)}</span>
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !form.formacao || !form.category}
            className="w-full flex items-center justify-center gap-3 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <>Avançar para Pagamento <ChevronRight size={18} /></>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NewRegistration;
