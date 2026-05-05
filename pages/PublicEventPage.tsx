import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Calendar, MapPin, Music, Ticket, ExternalLink,
  ChevronRight, Trophy, Clock, Star, Loader2, ArrowLeft, Youtube, Radio,
  Share2, Copy, Check, Instagram, Globe, MessageCircle, Mail, FileText, Download,
} from 'lucide-react';
import { motion } from 'motion/react';
import BrandIcon from '../components/BrandIcon';
import { EventAnchorNav, type AnchorSection } from '../components/EventAnchorNav';
import { PessoasSection, type JudgePublic, type WorkshopTeacherPublic } from '../components/PessoasSection';
import { resolveLote, diffDias, formatDataBR, todayISO, type Lote } from '../utils/lotes';

const TikTokIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.2z"/>
  </svg>
);

const PublicEventPage = () => {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [publicJudges, setPublicJudges] = useState<JudgePublic[]>([]);
  // Workshops Etapa 1: lista pública dos workshops do evento (publicados)
  const [publicWorkshops, setPublicWorkshops] = useState<Array<{
    id: string; slug: string | null; name: string; cover_url: string | null;
    professor_name: string; professor_bio: string | null; professor_photo_url: string | null;
    professor_instagram: string | null; professor_is_public: boolean;
    modalidade: string | null; nivel: string; data_inicio: string;
    duracao_minutos: number | null; preco_padrao: number; gratis_para_inscritos: boolean;
  }>>([]);
  // Tier 2: estoque por tipo de ingresso (mapa idx → { sold, remaining, sold_out })
  const [stockByType, setStockByType] = useState<Record<string, { sold: number; remaining: number | null; sold_out: boolean }>>({});

  useEffect(() => {
    if (!idOrSlug) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // UUID v4 tem 36 chars com hifens — se nao for UUID, trata como slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        const filterCol = isUuid ? 'id' : 'slug';

        const { data: eventData } = await supabase
          .from('events')
          .select('*')
          .eq(filterCol, idOrSlug)
          .maybeSingle();

        if (!eventData) {
          setEvent(null);
          return;
        }

        // Busca configuracoes do evento especifico (id=event_id da multi-tenant);
        // fallback pra legacy id='1' apenas se nao houver row do evento.
        const { data: cfgEvent } = await supabase
          .from('configuracoes')
          .select('*')
          .eq('id', eventData.id)
          .maybeSingle();
        const cfg = cfgEvent ?? await supabase
          .from('configuracoes')
          .select('*')
          .eq('id', '1')
          .maybeSingle()
          .then(r => r.data);

        setEvent(eventData);
        setConfig(cfg);

        // Etapa 1.5: jurados públicos via RPC security-definer
        // (retorna só campos seguros — sem PIN, sem token)
        const { data: judgesData } = await supabase.rpc('get_public_judges_for_event', {
          p_event_id: eventData.id,
        });
        if (Array.isArray(judgesData)) {
          setPublicJudges(judgesData as JudgePublic[]);
        }

        // Workshops Etapa 1: lista pública dos workshops do festival.
        // RLS já filtra is_published=true pra anon. Carrega só campos exibidos.
        const { data: wsData } = await supabase
          .from('workshops')
          .select('id, slug, name, cover_url, professor_name, professor_bio, professor_photo_url, professor_instagram, professor_is_public, modalidade, nivel, data_inicio, duracao_minutos, preco_padrao, gratis_para_inscritos')
          .eq('event_id', eventData.id)
          .eq('is_published', true)
          .order('data_inicio', { ascending: true });
        if (Array.isArray(wsData)) {
          setPublicWorkshops(wsData as any);
        }

        // Tier 2: estoque por tipo (só faz sentido pro fluxo INTERNO com sales)
        if (eventData.audience_sales_enabled && Array.isArray(eventData.ingressos_config)) {
          const types = eventData.ingressos_config
            .map((t: any, idx: number) => ({ id: String(idx), total: t.quantidade_total ?? null }))
            .filter((t: { total: number | null }) => t.total != null);
          if (types.length > 0) {
            const { data: stockRows } = await supabase.rpc('get_audience_stock', {
              p_event_id: eventData.id,
              p_types: types,
            });
            if (Array.isArray(stockRows)) {
              const map: Record<string, { sold: number; remaining: number | null; sold_out: boolean }> = {};
              for (const r of stockRows as Array<{ ticket_type_id: string; sold: number; remaining: number | null; sold_out: boolean }>) {
                map[String(r.ticket_type_id)] = { sold: r.sold, remaining: r.remaining, sold_out: r.sold_out };
              }
              setStockByType(map);
            }
          }
        }
      } catch (err) {
        console.error('Erro ao carregar evento:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [idOrSlug]);

  const handleShareCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignora */
    }
  };

  const handleShareWhatsapp = () => {
    if (!event) return;
    const text = encodeURIComponent(`Confira o ${event.name}: ${window.location.href}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="text-[#ff0068] animate-spin" size={48} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-6 p-8">
        <Trophy size={64} className="text-slate-700" />
        <h1 className="text-3xl font-black uppercase tracking-tighter">Evento não encontrado</h1>
        <button onClick={() => navigate('/festivais')} className="flex items-center gap-2 text-[#ff0068] font-black uppercase text-sm">
          <ArrowLeft size={16} /> Ver outros festivais
        </button>
      </div>
    );
  }

  const isRegistrationOpen = (() => {
    const now = new Date();
    const start = event.registration_start_date ? new Date(event.registration_start_date) : null;
    const end = event.registration_end_date ? new Date(event.registration_end_date) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  })();

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    // Parse com T12:00:00 evita shift UTC midnight → dia anterior em BRT.
    const iso = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
    const d = new Date(iso);
    const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', '');
    const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    return `${cap}, ${date}`;
  };

  // Range inteligente: evita duplicar mês/ano quando aplicável.
  // Mesmo dia: "Sáb, 03 de junho de 2026"
  // Mesmo mês: "Sáb 03 — Seg 05 de junho de 2026"
  // Atravessa mês: "Sex, 30 de maio — Seg, 02 de junho de 2026"
  const formatEventRange = (start?: string, end?: string) => {
    if (!start) return null;
    if (!end || end === start) return formatDate(start);
    const d1 = new Date((start.includes('T') ? start : start + 'T12:00:00'));
    const d2 = new Date((end.includes('T') ? end : end + 'T12:00:00'));
    const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
    const wd = (d: Date) => {
      const w = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', '');
      return w.charAt(0).toUpperCase() + w.slice(1);
    };
    if (sameMonth) {
      const startShort = `${wd(d1)} ${String(d1.getDate()).padStart(2, '0')}`;
      return `${startShort} — ${formatDate(end)}`;
    }
    return `${formatDate(start)} — ${formatDate(end)}`;
  };

  // Formato curto com dia da semana: "Sáb, 16/06/2026"
  const formatDeadline = (dateStr?: string) => {
    if (!dateStr) return null;
    const iso = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
    const d = new Date(iso);
    const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', '');
    const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
    const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    return `${cap}, ${date}`;
  };

  const eventId = event.id;
  const localizacao = [event.city, event.state].filter(Boolean).join(' / ') || event.address;

  // Normaliza links de redes — algumas pessoas digitam so o handle
  const normalizeUrl = (raw?: string, prefix = '') => {
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return `${prefix}${raw.replace(/^@/, '')}`;
  };

  const social = {
    instagram: normalizeUrl(event.instagram_event, 'https://instagram.com/'),
    tiktok:    normalizeUrl(event.tiktok_event,    'https://tiktok.com/@'),
    youtube:   normalizeUrl(event.youtube_event,   'https://youtube.com/@'),
    website:   normalizeUrl(event.website_event,   'https://'),
    whatsapp:  event.whatsapp_event
      ? `https://wa.me/${event.whatsapp_event.replace(/\D/g, '')}`
      : null,
    email:     event.email_event ? `mailto:${event.email_event}` : null,
  };

  const hasSocial = Object.values(social).some(Boolean);

  // Prêmios habilitados (vêm de configuracoes.premios_especiais como array de SpecialAward)
  const enabledAwards: any[] = Array.isArray(config?.premios_especiais)
    ? config.premios_especiais.filter((a: any) => a?.enabled)
    : [];

  // Etapa 1.5: monta lista de sections visíveis pro anchor menu.
  // Renderiza só seções que de fato têm conteúdo (evita item morto no menu).
  const visibleSections: AnchorSection[] = [
    event.description ? { id: 'sobre', label: 'Sobre' } : null,
    Array.isArray(event.programacao_config) && event.programacao_config.length > 0
      ? { id: 'programacao', label: 'Programação' }
      : null,
    // Ingressos: aparece se há tipos cadastrados OU política definida
    (Array.isArray(event.ingressos_config) && event.ingressos_config.length > 0)
      || event.politica_ingressos === 'GRATUITO'
      || event.politica_ingressos === 'EXTERNO'
      ? { id: 'ingressos', label: 'Ingressos' }
      : null,
    // "Inscrições" removido do anchor menu — botão CTA "INSCREVA-SE" já cobre.
    // Anchors descrevem o festival; CTA é a ação. Semantica diferente.
    publicWorkshops.length > 0 ? { id: 'workshops', label: 'Workshops' } : null,
    publicJudges.length > 0 ? { id: 'jurados', label: 'Jurados' } : null,
    enabledAwards.length > 0 ? { id: 'premiacao', label: 'Premiação' } : null,
  ].filter(Boolean) as AnchorSection[];

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Hero */}
      <div id="hero" className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#ff0068]/20 via-transparent to-[#050505]" />
        {event.cover_url ? (
          <img src={event.cover_url} alt={event.name} className="w-full h-[55vh] object-cover opacity-30" />
        ) : (
          <div className="w-full h-[55vh] bg-gradient-to-br from-[#ff0068]/10 via-slate-900 to-[#050505]" />
        )}

        <div className="absolute inset-0 flex flex-col justify-end p-8 lg:p-16">
          <div className="max-w-5xl">
            <Link to="/festivais" className="inline-flex items-center gap-2 mb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] transition-colors">
              <ArrowLeft size={12} /> Vitrine de festivais
            </Link>
            <div className="flex items-center gap-3 mb-4">
              <BrandIcon size={28} />
              <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.4em]">CoreoHub</span>
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-5xl lg:text-7xl font-black uppercase tracking-tighter italic leading-none mb-4"
            >
              {event.name}
            </motion.h1>
            <div className="flex flex-wrap gap-4 text-sm">
              {event.start_date && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Calendar size={16} className="text-[#ff0068]" />
                  {formatEventRange(event.start_date, event.end_date)}
                </div>
              )}
              {event.event_time && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock size={16} className="text-[#ff0068]" />
                  {event.event_time}
                </div>
              )}
              {localizacao && (
                <div className="flex items-center gap-2 text-slate-300">
                  <MapPin size={16} className="text-[#ff0068]" />
                  {localizacao}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Anchor menu — fixed top, sempre visível, transparente sobre hero
          e opaco depois de rolar (padrão Apple/Stripe) */}
      <EventAnchorNav
        sections={visibleSections}
        cta={
          isRegistrationOpen ? (
            <Link
              to={`/festival/${eventId}/register`}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff0068] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all"
            >
              Inscreva-se <ChevronRight size={12} />
            </Link>
          ) : undefined
        }
      />

      {/* Content */}
      <div className="max-w-5xl mx-auto px-8 py-16 space-y-12">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            // Esconde vagas se produtor não preencheu (não mostra "0" ou "∞")
            event.slots_limit
              ? { label: 'Vagas', value: event.slots_limit, icon: Star }
              : null,
            formatDeadline(config?.prazo_inscricao)
              ? { label: 'Inscrições até', value: formatDeadline(config?.prazo_inscricao), icon: Clock }
              : null,
            // Esconde premiação quando nenhum prêmio está habilitado
            // (antes mostrava "—" que parecia bug)
            enabledAwards.length > 0
              ? { label: 'Premiação', value: `${enabledAwards.length} prêmio${enabledAwards.length !== 1 ? 's' : ''}`, icon: Trophy }
              : null,
          ].filter(Boolean) as { label: string; value: any; icon: any }[]).map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <Icon size={20} className="text-[#ff0068] mb-3" />
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</p>
              <p className="text-xl font-black text-white tracking-tighter mt-1">{String(value)}</p>
            </div>
          ))}
        </div>

        {/* Regulamento PDF — sobe antes da descrição porque é documento crítico
            que o inscrito precisa conhecer antes de decidir se inscrever */}
        {event.regulation_pdf_url && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter">Regulamento</h2>
            <a
              href={event.regulation_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-3 px-6 py-4 bg-white/5 border border-white/10 hover:border-[#ff0068]/40 hover:bg-[#ff0068]/5 rounded-2xl transition-all group"
            >
              <FileText size={20} className="text-[#ff0068]" />
              <div className="flex-1 text-left">
                <p className="text-xs font-black uppercase tracking-tight">Baixar regulamento</p>
                <p className="text-[10px] text-slate-400 font-bold">PDF oficial do festival</p>
              </div>
              <Download size={16} className="text-slate-400 group-hover:text-[#ff0068] transition-colors" />
            </a>
          </div>
        )}

        {/* Description */}
        {event.description && (
          <div id="sobre" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter">Sobre o Evento</h2>
            <p className="text-slate-400 leading-relaxed whitespace-pre-line">{event.description}</p>
          </div>
        )}

        {/* Programação */}
        {Array.isArray(event.programacao_config) && event.programacao_config.length > 0 && (
          <div id="programacao" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Clock size={24} className="text-[#ff0068]" /> Programação
            </h2>
            <div className="space-y-2">
              {event.programacao_config
                .filter((p: any) => p.atividade)
                .map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-[#ff0068]/30 transition-colors">
                    <div className="shrink-0 w-20 text-center">
                      <p className="text-2xl font-black text-[#ff0068] tabular-nums tracking-tighter">{item.hora || '--:--'}</p>
                    </div>
                    <div className="w-px h-10 bg-white/10 shrink-0" />
                    <p className="font-bold text-sm text-white">{item.atividade}</p>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Ingressos para Audiência (#11) — politica_ingressos define modo */}
        {(() => {
          // Resolve politica preferindo events; cai pra config; senao infere
          // pelos dados (compat com produtores que ainda nao escolheram).
          const politica: string =
            event.politica_ingressos
            || config?.politica_ingressos
            || (Array.isArray(event.ingressos_config) && event.ingressos_config.filter((t: any) => t.nome).length > 0 ? 'INTERNO'
              : config?.url_ingressos ? 'EXTERNO'
              : 'NAO_DEFINIDO');

          if (politica === 'NAO_DEFINIDO') return null;

          if (politica === 'GRATUITO') {
            return (
              <div id="ingressos" className="space-y-4 scroll-mt-20">
                <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                  <Ticket size={24} className="text-emerald-400" /> Ingressos
                </h2>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 flex items-start gap-4">
                  <div className="p-3 bg-emerald-500/20 rounded-2xl text-emerald-400 shrink-0">
                    <Ticket size={24} />
                  </div>
                  <div>
                    <p className="font-black uppercase text-sm text-emerald-400">Entrada gratuita</p>
                    <p className="text-xs text-slate-300 mt-1">Não é necessário ingresso para assistir. Chegue cedo para garantir lugar.</p>
                  </div>
                </div>
              </div>
            );
          }

          if (politica === 'EXTERNO' && config?.url_ingressos) {
            return (
              <div id="ingressos" className="space-y-4 scroll-mt-20">
                <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                  <Ticket size={24} className="text-[#ff0068]" /> Ingressos
                </h2>
                <p className="text-xs text-slate-400">Para o público que vai assistir. Bailarinos inscritos não precisam comprar.</p>
                <a
                  href={config.url_ingressos}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-6 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
                >
                  <Ticket size={18} /> Comprar Ingressos <ExternalLink size={14} />
                </a>
              </div>
            );
          }

          if (politica === 'INTERNO' && Array.isArray(event.ingressos_config) && event.ingressos_config.filter((t: any) => t.nome).length > 0) {
            // Tier 1: se audience_sales_enabled = true, vendemos pelo CoreoHub
            // (botão "Comprar" leva pra /checkout-ingresso). Senão, exibe só os
            // tipos como informativo (ou link externo legado se cadastrado).
            const salesEnabled = !!event.audience_sales_enabled;
            // Quando sales habilitado, esconde tipos com preço 0 (não tem como
            // comprar) — produtor que quer cortesia/RSVP usa Tier 2 ou GRATUITO.
            // Quando sales desabilitado, mostra tudo (informativo).
            const today = todayISO();
            // Helper local: preço a exibir respeita lotes (se existirem) com fallback p/ preco
            const precoVigenteIngresso = (t: any): number => {
              const r = resolveLote(Array.isArray(t.lotes) ? t.lotes : null, today);
              if (r) return Number(r.lote.preco ?? 0);
              return Number(t.preco ?? 0);
            };
            const visibleTypes = (event.ingressos_config as any[])
              .filter((t: any) => t.nome)
              .filter((t: any) => !salesEnabled || precoVigenteIngresso(t) > 0);
            if (visibleTypes.length === 0) return null;
            return (
              <div id="ingressos" className="space-y-4 scroll-mt-20">
                <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                  <Ticket size={24} className="text-[#ff0068]" /> Ingressos
                </h2>
                <p className="text-xs text-slate-400">Para o público que vai assistir. Bailarinos inscritos não precisam comprar.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {visibleTypes
                    .map((t: any) => {
                      // Idx no array original importa pro checkout (não o filtrado)
                      const realIdx = event.ingressos_config.findIndex((x: any) => x === t);
                      const lotes: Lote[] = Array.isArray(t.lotes) ? t.lotes : [];
                      const r = resolveLote(lotes, today);
                      const preco = r ? Number(r.lote.preco ?? 0) : Number(t.preco ?? 0);
                      const nomeLote: string | null = r ? ((r.lote as any).nome ?? null) : null;
                      const hint = r && r.proximo && r.lote.data_virada && Number(r.proximo.preco) > Number(r.lote.preco)
                        ? { proximoPreco: Number(r.proximo.preco), dataVirada: r.lote.data_virada, dias: diffDias(today, r.lote.data_virada) }
                        : null;
                      const hintColor = !hint
                        ? 'text-slate-500'
                        : hint.dias < 1 ? 'text-rose-400'
                        : hint.dias < 7 ? 'text-amber-400'
                        : 'text-slate-500';
                      // Tier 2: estoque
                      const stock = stockByType[String(realIdx)];
                      const soldOut = stock?.sold_out === true;
                      const lowStock = stock && stock.remaining != null && stock.remaining > 0 && stock.remaining <= 10;
                      return (
                        <div
                          key={realIdx}
                          className={`bg-white/5 border rounded-2xl p-5 flex flex-col gap-2 transition-colors ${
                            soldOut ? 'border-white/10 opacity-60' : 'border-white/10 hover:border-[#ff0068]/40'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <div>
                              <p className="font-black uppercase text-sm text-white">{t.nome}</p>
                              {nomeLote && (
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{nomeLote}</p>
                              )}
                            </div>
                            <p className={`font-black text-lg ${soldOut ? 'text-slate-500 line-through' : 'text-[#ff0068]'}`}>
                              {preco > 0 ? `R$ ${preco.toFixed(2)}` : 'Grátis'}
                            </p>
                          </div>
                          {t.obs && <p className="text-[10px] text-slate-400">{t.obs}</p>}

                          {hint && !soldOut && (
                            <p className={`text-[10px] font-bold flex items-center gap-1.5 ${hintColor}`}>
                              {hint.dias < 1
                                ? <>⚠ Aumenta amanhã para R$ {hint.proximoPreco.toFixed(2)}</>
                                : <>⏱ Próximo: R$ {hint.proximoPreco.toFixed(2)} em {formatDataBR(hint.dataVirada)}</>}
                            </p>
                          )}

                          {/* Estoque (Tier 2) */}
                          {soldOut ? (
                            <span className="inline-flex self-start items-center gap-1.5 px-3 py-1 bg-slate-700/40 text-slate-300 rounded-full text-[10px] font-black uppercase tracking-widest">
                              Esgotado
                            </span>
                          ) : lowStock ? (
                            <span className="inline-flex self-start items-center gap-1.5 text-[10px] font-black text-amber-400 uppercase tracking-widest">
                              ⚠ Últimos {stock!.remaining}
                            </span>
                          ) : null}

                          {/* Botão de compra: prioriza checkout interno quando habilitado */}
                          {salesEnabled && preco > 0 && !soldOut && (
                            <button
                              type="button"
                              onClick={() => navigate(`/checkout-ingresso/${idOrSlug}/${realIdx}`)}
                              className="self-start inline-flex items-center gap-1.5 px-4 py-2 mt-2 bg-[#ff0068] text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                            >
                              <Ticket size={12} /> Comprar
                            </button>
                          )}
                          {!salesEnabled && t.link && (
                            <a
                              href={t.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="self-start inline-flex items-center gap-1.5 text-[10px] font-black text-[#ff0068] uppercase tracking-widest hover:underline"
                            >
                              Comprar <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          }

          return null;
        })()}

        {/* Modalities */}
        {event.formacoes_config && event.formacoes_config.length > 0 && (
          <div id="inscricoes" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Music size={24} className="text-[#ff0068]" /> Inscrições disponíveis
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.formacoes_config.map((mod: any, i: number) => {
                const today = todayISO();
                const lotes: Lote[] = Array.isArray(mod.lotes) ? mod.lotes : [];
                const r = resolveLote(lotes, today);
                const precoExibir = r ? Number(r.lote.preco ?? 0) : (mod.fee != null ? Number(mod.fee) : null);
                const nomeLote: string | null = r ? ((r.lote as any).nome ?? null) : null;
                // Hint do próximo lote: só quando há próximo, com preço maior, e data limite.
                const hint = r && r.proximo && r.lote.data_virada && Number(r.proximo.preco) > Number(r.lote.preco)
                  ? { proximoPreco: Number(r.proximo.preco), dataVirada: r.lote.data_virada, dias: diffDias(today, r.lote.data_virada) }
                  : null;
                const hintColor = !hint
                  ? 'text-slate-500'
                  : hint.dias < 1 ? 'text-rose-400'
                  : hint.dias < 7 ? 'text-amber-400'
                  : 'text-slate-500';
                return (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-black uppercase text-sm">{mod.name}</span>
                        {nomeLote && (
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{nomeLote}</p>
                        )}
                      </div>
                      <span className="text-[#ff0068] font-black text-sm">
                        {precoExibir != null && precoExibir > 0 ? `R$ ${precoExibir.toFixed(2)}` : 'Gratuito'}
                      </span>
                    </div>
                    {hint && (
                      <p className={`text-[10px] font-bold mt-3 pt-3 border-t border-white/5 flex items-center gap-1.5 ${hintColor}`}>
                        {hint.dias < 1
                          ? <>⚠ Aumenta amanhã para R$ {hint.proximoPreco.toFixed(2)}</>
                          : <>⏱ Próximo: R$ {hint.proximoPreco.toFixed(2)} em {formatDataBR(hint.dataVirada)}</>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* CTA contextual depois da lista de preços — padrão e-commerce
                (Eventbrite/Sympla/Doity): valor visível + ação ao lado.
                Reduz fricção pra quem rolou até aqui pra comparar preços. */}
            <Link
              to={`/festival/${eventId}/register`}
              className="mt-2 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-xl shadow-[#ff0068]/20"
            >
              Inscrever minha coreografia <ChevronRight size={16} />
            </Link>
          </div>
        )}

        {/* Workshops do evento — cards com link pra vitrine individual + checkout */}
        {publicWorkshops.length > 0 && (
          <div id="workshops" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <BrandIcon size={24} /> Workshops
            </h2>
            <p className="text-xs text-slate-400">
              Aulas com professores convidados. Inscritos da mostra podem ter desconto ou cortesia.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {publicWorkshops.map(ws => {
                const dataFmt = new Date(ws.data_inicio).toLocaleString('pt-BR', {
                  weekday: 'short', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
                });
                const nivelLabel = ws.nivel === 'todos' ? 'Todos os níveis'
                  : ws.nivel === 'iniciante' ? 'Iniciante'
                  : ws.nivel === 'intermediario' ? 'Intermediário'
                  : ws.nivel === 'avancado' ? 'Avançado'
                  : ws.nivel;
                return (
                  <button
                    key={ws.id}
                    onClick={() => navigate(`/workshop/${ws.slug ?? ws.id}`)}
                    className="text-left bg-white/5 border border-white/10 hover:border-[#ff0068]/40 rounded-2xl overflow-hidden transition-colors group"
                  >
                    <div className="aspect-[16/9] bg-gradient-to-br from-[#ff0068]/20 to-purple-500/20 relative overflow-hidden">
                      {ws.cover_url && (
                        <img src={ws.cover_url} alt={ws.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                      )}
                      {ws.gratis_para_inscritos && (
                        <span className="absolute top-2 right-2 inline-flex items-center text-[9px] font-black uppercase tracking-widest bg-violet-500/90 text-white px-2 py-0.5 rounded-full">
                          Grátis p/ inscritos
                        </span>
                      )}
                    </div>
                    <div className="p-4 space-y-1.5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">{ws.modalidade ?? 'Workshop'} · {nivelLabel}</p>
                      <h3 className="font-black uppercase tracking-tight text-white text-sm leading-tight line-clamp-2">{ws.name}</h3>
                      <p className="text-xs text-slate-400">com {ws.professor_name}</p>
                      <p className="text-[11px] text-slate-500">{dataFmt}{ws.duracao_minutos ? ` · ${ws.duracao_minutos}min` : ''}</p>
                      <p className="text-sm font-black text-white pt-1">
                        {ws.preco_padrao === 0
                          ? 'Grátis'
                          : Number(ws.preco_padrao).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Jurados (+ Professores: dedup automático por instagram/nome) */}
        {/* scroll-mt-20 vive dentro do PessoasSection no elemento com id="jurados" */}
        <PessoasSection
          judges={publicJudges}
          teachers={publicWorkshops.filter(w => w.professor_is_public).map(w => ({
            id: w.id,
            professor_name: w.professor_name,
            professor_bio: w.professor_bio,
            professor_photo_url: w.professor_photo_url,
            professor_instagram: w.professor_instagram,
            modalidade: w.modalidade,
          })) as WorkshopTeacherPublic[]}
        />

        {/* Prêmios habilitados */}
        {enabledAwards.length > 0 && (
          <div id="premiacao" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Trophy size={24} className="text-[#ff0068]" /> Premiação
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {enabledAwards.map((award: any) => (
                <div key={award.id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <p className="font-black uppercase text-sm tracking-tight">{award.name}</p>
                  {award.description && (
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{award.description}</p>
                  )}
                  {award.formation && award.formation !== 'TODOS' && (
                    <span className="inline-block mt-2 px-2 py-1 rounded-full bg-[#ff0068]/10 text-[#ff0068] text-[9px] font-black uppercase tracking-widest">
                      {award.formation}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="bg-gradient-to-r from-[#ff0068]/20 to-transparent border border-[#ff0068]/20 rounded-[3rem] p-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <h3 className="text-3xl font-black uppercase tracking-tighter italic">Pronto para dançar?</h3>
            <p className="text-slate-400 text-sm mt-2">
              {isRegistrationOpen ? 'As inscrições estão abertas. Garanta sua vaga agora.' : 'Inscrições encerradas ou ainda não abertas.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 min-w-[200px]">
            {isRegistrationOpen && (
              <Link
                to={`/festival/${eventId}/register`}
                className="px-8 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] text-center hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/30 flex items-center justify-center gap-2"
              >
                Inscreva-se <ChevronRight size={16} />
              </Link>
            )}
            <Link
              to={`/festival/${eventId}/leaderboard`}
              className="px-8 py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] text-center hover:border-[#ff0068]/50 transition-all flex items-center justify-center gap-2"
            >
              <Trophy size={16} /> Resultados
            </Link>
          </div>
        </div>

        {/* Redes sociais do evento */}
        {hasSocial && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter">Siga o evento</h2>
            <div className="flex flex-wrap gap-3">
              {social.instagram && (
                <a href={social.instagram} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 px-5 py-3 bg-gradient-to-br from-[#f09433] via-[#e6683c] to-[#bc1888] rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">
                  <Instagram size={16} /> Instagram
                </a>
              )}
              {social.tiktok && (
                <a href={social.tiktok} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 px-5 py-3 bg-black border border-white/20 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">
                  <TikTokIcon size={16} /> TikTok
                </a>
              )}
              {social.youtube && (
                <a href={social.youtube} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 px-5 py-3 bg-red-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">
                  <Youtube size={16} /> YouTube
                </a>
              )}
              {social.whatsapp && (
                <a href={social.whatsapp} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 px-5 py-3 bg-emerald-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              )}
              {social.website && (
                <a href={social.website} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 px-5 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all">
                  <Globe size={16} /> Site oficial
                </a>
              )}
              {social.email && (
                <a href={social.email}
                   className="flex items-center gap-2 px-5 py-3 bg-blue-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">
                  <Mail size={16} /> E-mail
                </a>
              )}
            </div>
          </div>
        )}

        {/* Patrocinadores */}
        {Array.isArray(event.patrocinadores_config) && event.patrocinadores_config.filter((s: any) => s.logo_url).length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter">Realização & Apoio</h2>
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
              <div className="flex flex-wrap items-center justify-center gap-8">
                {event.patrocinadores_config
                  .filter((s: any) => s.logo_url)
                  .map((s: any, i: number) => {
                    const Img = (
                      <img
                        src={s.logo_url}
                        alt={s.nome || 'Patrocinador'}
                        className="h-12 md:h-16 max-w-[180px] object-contain opacity-90 hover:opacity-100 transition-opacity"
                      />
                    );
                    return s.link ? (
                      <a key={i} href={s.link} target="_blank" rel="noopener noreferrer" title={s.nome}>{Img}</a>
                    ) : (
                      <div key={i} title={s.nome}>{Img}</div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* Compartilhar */}
        <div className="space-y-4">
          <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
            <Share2 size={22} className="text-[#ff0068]" /> Compartilhar
          </h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleShareWhatsapp}
              className="flex items-center gap-2 px-5 py-3 bg-emerald-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all"
            >
              <MessageCircle size={16} /> Enviar via WhatsApp
            </button>
            <button
              onClick={handleShareCopy}
              className="flex items-center gap-2 px-5 py-3 bg-white/5 border border-white/10 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all"
            >
              {copied ? (<><Check size={16} className="text-emerald-400" /> Link copiado!</>) : (<><Copy size={16} /> Copiar link</>)}
            </button>
          </div>
        </div>

        {/* Live YouTube */}
        {config?.url_live && (
          <div className="bg-gradient-to-r from-red-600/10 to-transparent border border-red-500/20 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-600 rounded-2xl flex items-center justify-center shrink-0">
                <Youtube size={22} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">Transmissão ao Vivo</span>
                </div>
                <p className="font-black text-white text-sm uppercase tracking-tight">Acompanhe o festival pelo YouTube</p>
              </div>
            </div>
            <a
              href={config.url_live}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-red-600/20 whitespace-nowrap"
            >
              <Radio size={14} /> Assistir Live <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* Link redundante removido — politica_ingressos=EXTERNO acima ja
            renderiza o botao "Comprar Ingressos" quando aplicavel (#11) */}
      </div>
    </div>
  );
};

export default PublicEventPage;
