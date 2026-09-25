import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { humanizeSupabaseError } from '../utils/supabaseErrors';

interface SessionRow {
  id: string;
  slug: string | null;
  name: string;
  start_date: string | null;
  event_time: string | null;
  is_public: boolean | null;
}

const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(dt).replace('.', '');
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`;
};

const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * Sessões do mesmo espetáculo. Cada sessão é um evento próprio (URL, estoque e
 * assentos próprios), ligado às irmãs por events.session_group_id. "Duplicar como
 * nova sessão" copia local, ingressos e regras e gera os assentos da nova data.
 */
export const EventSessionsCard: React.FC<{ eventId: string }> = ({ eventId }) => {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string | null; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const cols = 'id, slug, name, start_date, event_time, is_public, session_group_id';
    const { data: cur, error: curErr } = await supabase.from('events').select(cols).eq('id', eventId).maybeSingle();
    if (curErr) console.error('[EventSessionsCard] erro ao ler evento:', curErr.message);
    if (!cur) { setSessions([]); setLoading(false); return; }
    let rows: SessionRow[] = [cur as SessionRow];
    const gid = (cur as any).session_group_id;
    if (gid) {
      const { data: group, error: gErr } = await supabase.from('events').select(cols).eq('session_group_id', gid)
        .order('start_date', { ascending: true });
      if (gErr) console.error('[EventSessionsCard] erro ao ler sessões:', gErr.message);
      if (group?.length) rows = group as SessionRow[];
    }
    setSessions(rows);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setError(null);
    if (!date) { setError('Informe a data da nova sessão.'); return; }
    if (!/^\d{1,2}:\d{2}$/.test(time)) { setError('Informe o horário (HH:MM).'); return; }
    setSaving(true);
    const { data, error: rpcErr } = await supabase.rpc('duplicate_event_session', {
      p_event_id: eventId, p_start_date: date, p_event_time: time, p_name: label.trim() || null,
    });
    setSaving(false);
    if (rpcErr) { setError(humanizeSupabaseError(rpcErr) || rpcErr.message); return; }
    const newId = data as string;
    const { data: row } = await supabase.from('events').select('id, slug').eq('id', newId).maybeSingle();
    setCreated({ id: newId, slug: (row as any)?.slug ?? null });
    setModalOpen(false);
    setDate(''); setTime(''); setLabel('');
    await load();
  };

  const inputCls = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-2 px-3 text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50';
  const labelCls = 'text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block';

  return (
    <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 p-8 rounded-3xl">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Copy size={18} /></div>
          <div>
            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Sessões</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cada sessão (elenco, dia ou horário) é um evento próprio, com estoque e assentos separados. A vitrine de cada uma lista as demais.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setError(null); setModalOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/20 shrink-0"
        >
          <CalendarPlus size={12} /> Duplicar como nova sessão
        </button>
      </div>

      {created && (
        <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300">
          Sessão criada. Ela aparece no seletor de eventos do topo.{' '}
          <a className="font-black underline" href={`/evento/${created.slug ?? created.id}`} target="_blank" rel="noreferrer">Ver vitrine da nova sessão</a>
        </div>
      )}

      <div className="space-y-2 mt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-4"><Loader2 size={14} className="animate-spin" /> Carregando sessões...</div>
        ) : (
          sessions.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl p-3">
              <div className="min-w-0">
                <p className="font-bold text-sm text-slate-900 dark:text-white">
                  {fmtDate(s.start_date)}{s.event_time ? ` · ${s.event_time.slice(0, 5)}` : ''}
                </p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 truncate">
                  {s.name}{s.id === eventId ? ' · sessão aberta' : ''}{s.is_public ? '' : ' · privada'}
                </p>
              </div>
              <a
                href={`/evento/${s.slug ?? s.id}`} target="_blank" rel="noreferrer"
                className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] shrink-0" aria-label="Abrir vitrine da sessão"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          ))
        )}
        {!loading && sessions.length === 1 && (
          <p className="text-xs text-slate-500 italic pt-1">Só esta sessão por enquanto. Use o botão acima para criar a próxima.</p>
        )}
      </div>

      {modalOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="dup-sessao-titulo">
          <div className="w-full max-w-md bg-white dark:bg-[#0b0b0b] border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 id="dup-sessao-titulo" className="font-black uppercase tracking-tight italic text-slate-900 dark:text-white">Nova sessão</h4>
                <p className="text-xs text-slate-500 mt-1">Copia local, ingressos, preços e regras. Vendas e cupons não são copiados; os assentos começam livres.</p>
              </div>
              <button onClick={() => setModalOpen(false)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dup-data" className={labelCls}>Data</label>
                <input id="dup-data" type="date" min={todayISO()} value={date} onChange={e => setDate(e.target.value)} className={inputCls} autoFocus />
              </div>
              <div>
                <label htmlFor="dup-hora" className={labelCls}>Horário</label>
                <input id="dup-hora" type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor="dup-nome" className={labelCls}>Nome da sessão (opcional)</label>
              <input id="dup-nome" type="text" maxLength={120} value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex.: 2º Elenco" className={inputCls} />
              <p className="text-[10px] text-slate-500 mt-1">Vazio mantém o nome do evento; a vitrine mostra a data e o horário de cada sessão.</p>
            </div>
            {error && <p role="alert" className="text-xs font-bold text-rose-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white">Cancelar</button>
              <button
                onClick={submit} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#ff1a7d] disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500"
              >
                {saving && <Loader2 size={12} className="animate-spin" />} Criar sessão
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default EventSessionsCard;
