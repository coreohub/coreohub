import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import {
  Megaphone, Plus, Trash2, Pencil, Power, X, AlertCircle, Loader2, Calendar,
} from 'lucide-react';
import EventPickerSheet from '../components/EventPickerSheet';
import PageHeader from '../components/PageHeader';

interface EventOption { id: string; name: string; }

interface Announcement {
  id: string;
  event_id: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

const emptyForm = {
  title: '',
  body: '',
  cta_label: '',
  cta_url: '',
  expires_at: '',
};

// Limites reais (enforced, não só sugeridos) — card é notificação, não texto
// livre. Título/texto cabem em 1-3 linhas no card da Início sem quebrar layout.
const TITLE_MAX = 60;
const BODY_MAX = 200;
const CTA_LABEL_MAX = 24;
const CTA_URL_MAX = 300;

const Avisos: React.FC = () => {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id, name')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setEvents(data);
        setSelectedEventId(prev => prev ?? data[0].id);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('event_announcements')
      .select('*')
      .eq('event_id', selectedEventId)
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else { setAnnouncements(data ?? []); setError(null); }
    setLoading(false);
  }, [selectedEventId]);

  useEffect(() => { refresh(); }, [refresh]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      body: a.body,
      cta_label: a.cta_label ?? '',
      cta_url: a.cta_url ?? '',
      expires_at: a.expires_at ? a.expires_at.slice(0, 10) : '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError(null);
    if (!selectedEventId) return;
    if (!form.title.trim()) { setFormError('Informe um título.'); return; }
    if (!form.body.trim()) { setFormError('Informe o texto do aviso.'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        cta_label: form.cta_label.trim() || null,
        cta_url: form.cta_url.trim() || null,
        expires_at: form.expires_at || null,
      };
      if (editingId) {
        const { error: err } = await supabase.from('event_announcements').update(payload).eq('id', editingId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('event_announcements').insert({ event_id: selectedEventId, ...payload });
        if (err) throw err;
      }
      setShowModal(false);
      setEditingId(null);
      setForm(emptyForm);
      await refresh();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (a: Announcement) => {
    await supabase.from('event_announcements').update({ active: !a.active }).eq('id', a.id);
    await refresh();
  };

  const handleDelete = async (a: Announcement) => {
    if (!confirm(`Excluir o aviso "${a.title}"?`)) return;
    await supabase.from('event_announcements').delete().eq('id', a.id);
    await refresh();
  };

  const fmtDate = (d?: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <PageHeader
          icon={
            <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl">
              <Megaphone size={20} />
            </div>
          }
          title="Avisos"
          subtitle="Mensagens pra Início do inscrito"
        />
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 sm:shrink-0">
          {events.length > 0 && (
            <EventPickerSheet
              events={events}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              className="w-full sm:w-auto"
            />
          )}
          <button
            disabled={!selectedEventId}
            onClick={openCreate}
            className="flex items-center justify-center gap-2 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-[#ff0068]/20"
          >
            <Plus size={16} /> Novo Aviso
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 font-bold max-w-xl">
        Avisos aparecem pra todo mundo com inscrição neste evento, na tela Início. Use pra recados operacionais
        (mudança de local, atraso, lembrete de trilha) — não substitui e-mail/WhatsApp pra comunicação urgente.
      </p>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-[#ff0068]" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
          <AlertCircle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl">
          <Megaphone size={40} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
          <p className="font-black text-sm text-slate-600 dark:text-white uppercase">Nenhum aviso criado</p>
          <p className="text-xs text-slate-500 mt-1">Clique em "Novo Aviso" para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => (
            <div
              key={a.id}
              className={`bg-white dark:bg-white/5 rounded-2xl border p-5 flex items-start gap-4 ${
                a.active ? 'border-slate-200 dark:border-white/10' : 'border-slate-200 dark:border-white/10 opacity-50'
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-[#ff0068]/10 text-[#ff0068] flex items-center justify-center shrink-0">
                <Megaphone size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-black text-sm text-slate-900 dark:text-white">{a.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                    a.active
                      ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-white/10 text-slate-500'
                  }`}>
                    {a.active ? 'Ativo' : 'Pausado'}
                  </span>
                  {a.expires_at && (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      <Calendar size={10} /> Expira {fmtDate(a.expires_at)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{a.body}</p>
                {a.cta_label && (
                  <span className="inline-block mt-2 text-[9px] font-black text-[#ff0068] uppercase tracking-widest">
                    CTA: {a.cta_label} {a.cta_url ? `→ ${a.cta_url}` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleToggle(a)}
                  title={a.active ? 'Pausar aviso' : 'Reativar aviso'}
                  aria-label={a.active ? 'Pausar aviso' : 'Reativar aviso'}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <Power size={15} />
                </button>
                <button
                  onClick={() => openEdit(a)}
                  title="Editar"
                  aria-label="Editar aviso"
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => handleDelete(a)}
                  title="Excluir"
                  aria-label="Excluir aviso"
                  className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-16 sm:pb-0 sm:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => { setShowModal(false); setEditingId(null); setFormError(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[92dvh] sm:max-h-[90dvh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {editingId ? 'Editar Aviso' : 'Novo Aviso'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Aparece pra todo inscrito com coreografia neste evento.</p>
              </div>
              <button
                onClick={() => { setShowModal(false); setEditingId(null); setFormError(null); }}
                aria-label="Fechar"
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 sm:px-6 py-5 flex-1">
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Título</label>
                  <span className="text-[9px] font-bold text-slate-400">{form.title.length}/{TITLE_MAX}</span>
                </div>
                <input
                  type="text"
                  value={form.title}
                  maxLength={TITLE_MAX}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ex: Mudança de local do credenciamento"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50"
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Texto</label>
                  <span className="text-[9px] font-bold text-slate-400">{form.body.length}/{BODY_MAX}</span>
                </div>
                <textarea
                  value={form.body}
                  maxLength={BODY_MAX}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={4}
                  placeholder="Ex: O credenciamento foi movido pra entrada lateral do ginásio."
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50 resize-none"
                />
                <p className="text-[9px] text-slate-400 mt-1">Curto e direto — o card é uma notificação, não um comunicado longo.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Texto do botão (opcional)</label>
                    <span className="text-[9px] font-bold text-slate-400">{form.cta_label.length}/{CTA_LABEL_MAX}</span>
                  </div>
                  <input
                    type="text"
                    value={form.cta_label}
                    maxLength={CTA_LABEL_MAX}
                    onChange={e => setForm(f => ({ ...f, cta_label: e.target.value }))}
                    placeholder="Ver mapa"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Link do botão (opcional)</label>
                  <input
                    type="text"
                    value={form.cta_url}
                    maxLength={CTA_URL_MAX}
                    onChange={e => setForm(f => ({ ...f, cta_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50"
                  />
                </div>
              </div>
              {form.cta_label.trim() && !form.cta_url.trim() && (
                <p className="text-[10px] text-amber-500 -mt-2">Sem link, o botão não aparece pro inscrito — só o texto/imagem do aviso.</p>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Expira em (opcional)</label>
                <input
                  type="date"
                  value={form.expires_at}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : (editingId ? 'Salvar Alterações' : 'Criar Aviso')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Avisos;
