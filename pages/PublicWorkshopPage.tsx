/**
 * PublicWorkshopPage — Vitrine pública de 1 workshop (/workshop/:idOrSlug).
 *
 * Anon pode acessar (RLS permite SELECT em workshops com is_published=true).
 * Mostra cover, professor, modalidade, data/local, preço do lote ativo,
 * estoque restante, e botão "Inscrever-se" → /checkout-workshop/:id.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Loader2, AlertCircle, ArrowLeft, Calendar, Clock, MapPin, User as UserIcon,
  GraduationCap, Tag, Users, Globe, Instagram, Award, Share2,
} from 'lucide-react';

interface Workshop {
  id: string;
  event_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  cover_url: string | null;
  professor_name: string;
  professor_bio: string | null;
  professor_bio_short: string | null;
  professor_photo_url: string | null;
  professor_instagram: string | null;
  professor_site_url: string | null;
  professor_is_public: boolean;
  modalidade: string | null;
  nivel: 'iniciante' | 'intermediario' | 'avancado' | 'todos';
  data_inicio: string;
  data_fim: string | null;
  duracao_minutos: number | null;
  local: string | null;
  capacidade_max: number | null;
  preco_padrao: number;
  preco_inscritos_mostra: number | null;
  gratis_para_inscritos: boolean;
  is_published: boolean;
}

interface Stock {
  capacidade_max: number | null;
  vendidos: number;
  restantes: number | null;
  esgotado: boolean;
  active_lot_id: string | null;
  active_lot_nome: string | null;
  active_lot_preco: number | null;
  active_lot_preco_combo: number | null;
  active_lot_quantidade_max: number | null;
  active_lot_vendidos: number;
  active_lot_restantes: number | null;
  active_lot_esgotado: boolean;
}

const fmtCurrency = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const NIVEL_LABEL: Record<string, string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
  todos: 'Todos os níveis',
};

const PublicWorkshopPage: React.FC = () => {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const navigate = useNavigate();

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [stock, setStock]       = useState<Stock | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [toast, setToast]       = useState<string | null>(null);

  useEffect(() => {
    if (!idOrSlug) return;
    (async () => {
      setLoading(true);
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        const filter = isUuid ? 'id' : 'slug';
        const { data: ws, error: wsErr } = await supabase
          .from('workshops')
          .select('*')
          .eq(filter, idOrSlug)
          .eq('is_published', true)
          .maybeSingle();

        if (wsErr || !ws) {
          setError('Workshop não encontrado ou ainda não está publicado.');
          return;
        }
        setWorkshop(ws);

        // Stock + lote ativo
        const { data: st } = await supabase.rpc('get_workshop_stock', { p_workshop_id: ws.id });
        const stRow = Array.isArray(st) ? st[0] : st;
        if (stRow) setStock(stRow);
      } finally {
        setLoading(false);
      }
    })();
  }, [idOrSlug]);

  // Polling de estoque a cada 30s
  useEffect(() => {
    if (!workshop?.id) return;
    const tick = async () => {
      const { data } = await supabase.rpc('get_workshop_stock', { p_workshop_id: workshop.id });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setStock(row);
    };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [workshop?.id]);

  // Auto-clear toast em 2.5s. PRECISA ficar antes de qualquer early-return
  // pra não violar Rules of Hooks (todo hook chamado em todo render).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  if (error || !workshop) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white/5 border border-rose-500/30 rounded-2xl p-6 text-center">
          <AlertCircle className="text-rose-400 mx-auto mb-3" size={32} />
          <p className="text-white font-bold mb-2">Workshop indisponível</p>
          <p className="text-sm text-slate-400 mb-4">{error}</p>
          <button onClick={() => navigate(-1)} className="text-xs font-black text-[#ff0068] uppercase tracking-widest">← Voltar</button>
        </div>
      </div>
    );
  }

  const isExpired = new Date(workshop.data_inicio).getTime() < Date.now();
  const precoAtivo = stock?.active_lot_preco ?? workshop.preco_padrao;
  const precoCombo = stock?.active_lot_preco_combo ?? workshop.preco_inscritos_mostra;
  const lotEsgotado = Boolean(stock?.active_lot_esgotado || stock?.esgotado);
  const podeComprar = !isExpired && !lotEsgotado && precoAtivo != null;

  const restantes = stock?.active_lot_restantes ?? stock?.restantes;

  const handleShare = async () => {
    const url = window.location.href;
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({ title: workshop?.name ?? 'Workshop', text: `Workshop com ${workshop?.professor_name ?? ''}`, url });
      } catch { /* ignore */ }
    } else {
      navigator.clipboard.writeText(url);
      setToast('Link copiado!');
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-white pb-24 sm:pb-12">
      {/* Cover — largura limitada (não full-bleed) pra não distorcer a proporção
          16:9 em telas largas; full-bleed + altura fixa cropava igual zoom. */}
      <div className="max-w-5xl mx-auto">
        <div className="relative aspect-[16/9] sm:rounded-b-3xl overflow-hidden">
          {(workshop.cover_url || workshop.professor_photo_url) ? (
            <img src={workshop.cover_url || workshop.professor_photo_url || ''} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#ff0068] via-purple-700 to-[#0b0b0f]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-[#0b0b0f]" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-20 relative">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] mb-4">
          <ArrowLeft size={14} /> Voltar
        </button>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest bg-[#ff0068]/20 text-[#ff0068] px-2.5 py-1 rounded-full">
            <GraduationCap size={11} />Workshop
          </span>
          {workshop.modalidade && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-white/10 text-slate-200 px-2.5 py-1 rounded-full"><Tag size={11} />{workshop.modalidade}</span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-white/10 text-slate-200 px-2.5 py-1 rounded-full"><Award size={11} />{NIVEL_LABEL[workshop.nivel]}</span>
        </div>

        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase mb-2">{workshop.name}</h1>
        <p className="text-sm text-slate-400 mb-6">com <strong className="text-white">{workshop.professor_name}</strong></p>

        {/* Card de inscrição */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              {stock?.active_lot_nome && (
                <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest mb-0.5">{stock.active_lot_nome}</p>
              )}
              <p className="text-3xl font-black text-white">{fmtCurrency(precoAtivo)}</p>
              {precoCombo != null && precoCombo < (precoAtivo ?? 0) && (
                <p className="text-xs text-violet-300 mt-1">↓ {fmtCurrency(precoCombo)} para inscritos da mostra</p>
              )}
              {workshop.gratis_para_inscritos && (
                <p className="text-xs text-emerald-300 mt-1 font-bold">🎉 Grátis para inscritos da mostra</p>
              )}
            </div>
            <button onClick={handleShare} className="p-2 rounded-lg hover:bg-white/10 text-slate-400" title="Compartilhar">
              <Share2 size={16} />
            </button>
          </div>

          {/* Estoque restante */}
          {restantes != null && restantes <= 10 && restantes > 0 && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 mb-3 text-[11px] font-bold text-amber-200">
              ⚡ Restam apenas {restantes} {restantes === 1 ? 'vaga' : 'vagas'}
            </div>
          )}
          {lotEsgotado && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 mb-3 text-[11px] font-bold text-rose-200">
              Esgotado
            </div>
          )}
          {isExpired && (
            <div className="rounded-xl bg-slate-500/10 border border-slate-500/30 px-3 py-2 mb-3 text-[11px] font-bold text-slate-300">
              Inscrições encerradas — workshop já começou
            </div>
          )}

          {/* No mobile, quando podeComprar, a barra fixa do rodapé já cobre o CTA —
              esconder aqui evita o botão duplicado (mesma ação 2x na tela). */}
          <button
            disabled={!podeComprar}
            onClick={() => navigate(`/checkout-workshop/${workshop.id}`)}
            className={`w-full items-center justify-center gap-2 rounded-xl bg-[#ff0068] px-4 py-3 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] disabled:opacity-40 disabled:cursor-not-allowed transition ${podeComprar ? 'hidden sm:flex' : 'flex'}`}
          >
            {podeComprar ? 'Comprar agora' : lotEsgotado ? 'Esgotado' : 'Indisponível'}
          </button>
        </div>

        {/* Info: data / local / duração / capacidade */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <InfoBox icon={Calendar} label="Quando" value={fmtDateTime(workshop.data_inicio)} />
          {workshop.duracao_minutos && (
            <InfoBox icon={Clock} label="Duração" value={`${workshop.duracao_minutos} min`} />
          )}
          {workshop.local && (
            <InfoBox icon={MapPin} label="Onde" value={workshop.local} />
          )}
          {workshop.capacidade_max && (
            <InfoBox icon={Users} label="Capacidade" value={`${workshop.capacidade_max} alunos`} />
          )}
        </div>

        {/* Descrição */}
        {workshop.description && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-[#ff0068] mb-3">Sobre o workshop</h2>
            <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{workshop.description}</p>
          </div>
        )}

        {/* PersonCard do professor */}
        {workshop.professor_is_public && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-xs font-black uppercase tracking-widest text-[#ff0068] mb-4">Professor</h2>
            <div className="flex items-start gap-4">
              {workshop.professor_photo_url ? (
                <img src={workshop.professor_photo_url} alt={workshop.professor_name} className="w-20 h-20 rounded-2xl object-cover" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center">
                  <UserIcon size={32} className="text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-lg font-black text-white">{workshop.professor_name}</p>
                {workshop.professor_bio_short && (
                  <p className="text-sm text-slate-300 mt-1">{workshop.professor_bio_short}</p>
                )}
                {workshop.professor_bio && workshop.professor_bio !== workshop.professor_bio_short && (
                  <p className="text-xs text-slate-400 mt-2 whitespace-pre-line">{workshop.professor_bio}</p>
                )}
                <div className="flex items-center gap-3 mt-3">
                  {workshop.professor_instagram && (
                    <a
                      href={`https://instagram.com/${workshop.professor_instagram.replace(/^@/, '')}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-[#ff0068]"
                    >
                      <Instagram size={12} />{workshop.professor_instagram}
                    </a>
                  )}
                  {workshop.professor_site_url && (
                    <a href={workshop.professor_site_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-[#ff0068]">
                      <Globe size={12} />Site
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CTA fixo mobile */}
      {podeComprar && (
        <div className="fixed bottom-0 left-0 right-0 sm:hidden bg-[#0b0b0f]/95 backdrop-blur border-t border-white/10 p-3 z-30">
          <button
            onClick={() => navigate(`/checkout-workshop/${workshop.id}`)}
            className="w-full rounded-xl bg-[#ff0068] px-4 py-3 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30"
          >
            Comprar · {fmtCurrency(precoAtivo)}
          </button>
        </div>
      )}

      {/* Toast efêmero (audit Tier 3: substitui alert nativo) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 z-50 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest px-4 py-2.5 rounded-full shadow-2xl border border-white/10"
        >
          {toast}
        </div>
      )}
    </div>
  );
};

const InfoBox: React.FC<{ icon: any; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 inline-flex items-center gap-1.5">
      <Icon size={10} />{label}
    </p>
    <p className="text-sm font-bold text-white">{value}</p>
  </div>
);

export default PublicWorkshopPage;
