import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Check, AlertTriangle, CheckCircle2, Info, AlertCircle, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';

/**
 * Sininho de notificações no header (Sessão 4.2 B2).
 *
 * Lê `notifications` da tabela criada em 20260526_notifications_inbox. Mostra
 * badge rosa com contagem de não lidas. Click abre dropdown (popover desktop /
 * bottom-sheet mobile) com lista — click no item navega pro CTA e marca como
 * lido. "Marcar todas" usa RPC mark_all_notifications_read.
 *
 * Realtime: subscription em postgres_changes pra inserir/atualizar a lista
 * sem refetch. Quando outro tab marca como lido (mesma sessão Supabase),
 * estado sincroniza.
 *
 * Não renderiza nada quando user não está autenticado — componente espera
 * profile válido. Sumir silently é melhor que crash.
 */

interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string | null;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  cta_url: string | null;
  cta_label: string | null;
  metadata: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

const SEVERITY_META: Record<NotificationRow['severity'], { icon: typeof Info; color: string }> = {
  info:    { icon: Info,           color: 'text-sky-500'     },
  success: { icon: CheckCircle2,   color: 'text-emerald-500' },
  warning: { icon: AlertTriangle,  color: 'text-amber-500'   },
  error:   { icon: AlertCircle,    color: 'text-rose-500'    },
};

/** Formatador "há N minutos / horas / dias" em pt-BR. Compacto pra caber no card. */
const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1)    return 'agora';
  if (min < 60)   return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return `há ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7)      return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

interface Props {
  userId: string;
}

const PAGE_SIZE = 50;

const NotificationBell: React.FC<Props> = ({ userId }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Heurística sem count query: se a última página voltou cheia (PAGE_SIZE),
  // assume que pode ter mais. Confirma/corrige no fetch seguinte.
  const [hasMore, setHasMore] = useState(false);
  // Tick a cada 60s pra forçar re-render do formatRelative (notif fica "agora"
  // indefinidamente se o componente não re-renderizar). Cheap — só dispara
  // re-cálculo de strings, não refetch.
  const [, setMinuteTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter(n => !n.read_at).length;

  useEffect(() => {
    const id = setInterval(() => setMinuteTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch inicial + realtime subscription. Reseta quando userId muda
  // (impersonação de super_admin, por exemplo).
  useEffect(() => {
    if (!userId) return;

    let active = true;
    setLoading(true);
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1)
      .then(({ data, error }) => {
        if (!active) return;
        if (!error) {
          setItems((data ?? []) as NotificationRow[]);
          setHasMore((data ?? []).length === PAGE_SIZE);
        }
        setLoading(false);
      });

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems(prev => [payload.new as NotificationRow, ...prev]);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems(prev => prev.map(n => n.id === (payload.new as NotificationRow).id ? payload.new as NotificationRow : n));
        })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Click fora fecha o dropdown (padrão Linear/Notion).
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // "Ver mais" — pagina pelo offset do que já está carregado (não por
  // created_at) porque inserts realtime no topo não devem deslocar a janela.
  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(items.length, items.length + PAGE_SIZE - 1);
    if (!error) {
      const page = (data ?? []) as NotificationRow[];
      setItems(prev => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  // Marca individual como lida. Optimistic — atualiza UI antes do response
  // pra não dar laggy. Realtime reconcilia se algo der errado.
  const markRead = async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  };

  // Marca todas via RPC (1 round-trip vs N).
  const markAllRead = async () => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    await supabase.rpc('mark_all_notifications_read');
  };

  // Click no item: marca lido + navega pro CTA (se houver). URL relativa usa
  // React Router; absoluta abre em nova aba (link externo).
  const handleClick = async (n: NotificationRow) => {
    if (!n.read_at) await markRead(n.id);
    setOpen(false);
    if (!n.cta_url) return;
    if (/^https?:\/\//.test(n.cta_url)) {
      window.open(n.cta_url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(n.cta_url);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/5 transition-all"
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : 'Notificações'}
      >
        <Bell size={18} />
        {/* Âmbar, não rosa de marca — badge de contagem é sinal de urgência,
            não deve competir visualmente com CTA/navegação ativa (que usam
            a cor de marca). Mesma semântica já usada em "Pendências"/
            "Trilha pendente" no resto do app. */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-amber-500 text-white rounded-full text-[9px] font-black flex items-center justify-center border-2 border-white dark:border-slate-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-2rem))] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Notificações</h3>
                {unreadCount > 0 && (
                  <p className="text-[10px] text-slate-500 mt-0.5">{unreadCount} não lidas</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center gap-1"
                    title="Marcar todas como lidas"
                  >
                    <Check size={11} /> Tudo lido
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {loading ? (
                <div className="py-10 text-center text-[10px] text-slate-400 font-black uppercase tracking-widest">Carregando…</div>
              ) : items.length === 0 ? (
                <div className="py-10 px-6 text-center">
                  <div className="w-12 h-12 mx-auto bg-slate-100 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-3">
                    <Bell size={20} className="text-slate-400" />
                  </div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Sem notificações</p>
                  <p className="text-[10px] text-slate-400 mt-1 normal-case font-normal">
                    Quando tiver novidade, ela aparece aqui.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {items.map(n => {
                    const SevIcon = SEVERITY_META[n.severity]?.icon ?? Info;
                    const sevColor = SEVERITY_META[n.severity]?.color ?? 'text-slate-500';
                    const isUnread = !n.read_at;
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => handleClick(n)}
                          className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-all ${
                            isUnread
                              ? 'bg-[#ff0068]/5 dark:bg-[#ff0068]/8 hover:bg-[#ff0068]/10 dark:hover:bg-[#ff0068]/15'
                              : 'hover:bg-slate-50 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className={`shrink-0 w-8 h-8 rounded-xl bg-slate-50 dark:bg-white/5 ${sevColor} flex items-center justify-center mt-0.5`}>
                            <SevIcon size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-[12px] truncate ${isUnread ? 'font-black text-slate-900 dark:text-white' : 'font-bold text-slate-700 dark:text-slate-300'}`}>
                                {n.title}
                              </p>
                              {isUnread && (
                                <span className="shrink-0 w-2 h-2 rounded-full bg-amber-500 mt-1.5" title="Não lida" />
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{n.body}</p>
                            <div className="flex items-center justify-between gap-2 mt-1.5">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                {formatRelative(n.created_at)}
                              </p>
                              {n.cta_label && (
                                <p className="text-[10px] font-bold text-[#ff0068] flex items-center gap-1">
                                  {n.cta_label}
                                  {n.cta_url && /^https?:\/\//.test(n.cta_url) && <ExternalLink size={9} />}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {hasMore && !loading && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-50"
                >
                  {loadingMore ? 'Carregando…' : 'Ver mais'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationBell;
