import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { ChevronRight, Loader2, Music2, Users, User, AlertCircle } from 'lucide-react';

const input = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm';
const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

const NewRegistration = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [form, setForm] = useState({
    choreography_name: '',
    modality: '',
    category: '',
    dance_style: '',
    num_participants: 1,
  });

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/auth'); return; }
      setUserId(user.id);

      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, description, start_date, end_date, registration_deadline, modalities_config, categories_config, styles_config, cover_url')
        .eq('id', eventId)
        .single();

      if (evErr || !ev) { setError('Evento não encontrado.'); setLoading(false); return; }
      setEvent(ev);
      setLoading(false);
    };
    load();
  }, [eventId, navigate]);

  const modalities: any[] = event?.modalities_config ?? [];
  const categories: any[] = event?.categories_config ?? [];
  const styles: any[]     = event?.styles_config ?? [];

  const selectedModality = modalities.find(m => m.name === form.modality);
  const fee: number = selectedModality?.fee ?? selectedModality?.base_fee ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.choreography_name.trim()) { setError('Informe o nome da coreografia.'); return; }
    if (!form.modality)  { setError('Selecione a modalidade.'); return; }
    if (!form.category)  { setError('Selecione a categoria.'); return; }
    if (fee <= 0)        { setError('Esta modalidade não possui valor configurado. Contate o produtor.'); return; }

    setSubmitting(true);
    setError(null);

    try {
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .insert({
          event_id: eventId,
          user_id: userId,
          choreography_name: form.choreography_name.trim(),
          modality: form.modality,
          category: form.category,
          dance_style: form.dance_style || null,
          status: 'PENDENTE',
          status_pagamento: 'PENDENTE',
          audio_duration_seconds: 0,
          applied_penalty: 0,
        })
        .select('id')
        .single();

      if (regErr || !reg) throw regErr ?? new Error('Erro ao criar inscrição.');

      navigate(`/festival/${eventId}/checkout?registration_id=${reg.id}`);
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
          {event.registration_deadline && (
            <p className="text-xs text-slate-500 mt-1">
              Inscrições até {new Date(event.registration_deadline).toLocaleDateString('pt-BR')}
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
              <label className={label}>Modalidade</label>
              <select value={form.modality} onChange={e => setForm(f => ({ ...f, modality: e.target.value }))} className={input} required>
                <option value="">Selecione...</option>
                {modalities.filter(m => m.is_active !== false).map((m: any) => (
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

            <div>
              <label className={label}>Número de participantes</label>
              <div className="relative">
                <User size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number" min={1} max={50}
                  value={form.num_participants}
                  onChange={e => setForm(f => ({ ...f, num_participants: Number(e.target.value) }))}
                  className={`${input} pl-9`}
                />
              </div>
            </div>
          </div>

          {/* Resumo de valor */}
          {fee > 0 && (
            <div className="bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Valor da inscrição</p>
                <p className="text-xs text-slate-500 mt-0.5">{form.modality}</p>
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
            disabled={submitting || !form.modality || !form.category}
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
