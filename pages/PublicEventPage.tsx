import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { trackViewEvent, trackBeginCheckout } from '../services/producerAnalytics';
import ProducerPixels from '../components/ProducerPixels';
import {
  Calendar, MapPin, Music, Ticket, ExternalLink,
  ChevronRight, Trophy, Clock, Star, Loader2, ArrowLeft, Youtube, Radio,
  Share2, Copy, Check, Instagram, Globe, MessageCircle, Mail, FileText, Download,
  GraduationCap, Video, Plus, Minus,
} from 'lucide-react';
import { motion } from 'motion/react';
import BrandIcon from '../components/BrandIcon';
import { EventAnchorNav, type AnchorSection } from '../components/EventAnchorNav';
import { PessoasSection, type JudgePublic, type WorkshopTeacherPublic } from '../components/PessoasSection';
import { resolveLote, diffDias, formatDataBRComDia, todayISO, resolveActiveWorkshopLot, findNextWorkshopLot, type Lote } from '../utils/lotes';
import { formatPrecoBR } from '../utils/masks';
import { isEventOver } from '../utils/eventStatus';
import AvisoViradaLote from '../components/AvisoViradaLote';

/** Deriva nome do lote pelo índice/posição. Lote único → null (não mostra label).
 *  Múltiplos lotes → "Lote N" para intermediários, "Último Lote" pro final. */
const nomeDoLote = (lotes: Lote[], idx: number): string | null => {
  if (lotes.length <= 1) return null;
  if (idx === lotes.length - 1) return 'Último Lote';
  return `Lote ${idx + 1}`;
};

const TikTokIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.2z"/>
  </svg>
);

// forcedSlug: usado quando a vitrine é servida na raiz "/" de um domínio
// próprio do evento (ex: festival.usualdance.com) — App.tsx resolve o
// hostname e passa o slug direto, sem depender do param de rota /evento/:id.
const PublicEventPage = ({ forcedSlug }: { forcedSlug?: string } = {}) => {
  const { idOrSlug: paramIdOrSlug } = useParams<{ idOrSlug: string }>();
  const idOrSlug = forcedSlug ?? paramIdOrSlug;
  const navigate = useNavigate();
  // Link de desconto por coreografia (?discount_token=) precisa sobreviver
  // o salto evento → detalhe do workshop → checkout.
  const [searchParams] = useSearchParams();
  const discountToken = searchParams.get('discount_token');
  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  // Fase 4B — gate que adia view_event até ProducerPixels ter configurado o
  // GA4/Pixel do produtor. Sem isso, eventos disparados antes do `config`
  // não chegam no stream do produtor (gtag não replaya retroativamente).
  const [pixelsReady, setPixelsReady] = useState(false);
  // Evita disparar view_event duas vezes pro mesmo evento se o useEffect
  // re-rodar (re-render pós-setEvent + pixelsReady toggle).
  const [viewTracked, setViewTracked] = useState(false);
  const [publicJudges, setPublicJudges] = useState<JudgePublic[]>([]);
  // Workshops Etapa 1: lista pública dos workshops do evento (publicados)
  const [publicWorkshops, setPublicWorkshops] = useState<Array<{
    id: string; slug: string | null; name: string; cover_url: string | null;
    professor_name: string; professor_bio: string | null; professor_photo_url: string | null;
    professor_instagram: string | null; professor_is_public: boolean;
    modalidade: string | null; nivel: string; data_inicio: string;
    duracao_minutos: number | null; preco_padrao: number; gratis_para_inscritos: boolean;
  }>>([]);
  // Lote vigente por workshop (id → {nome, preco}), pra exibir badge "1º lote"
  // + preço correto já na listagem (antes só a página de detalhe resolvia).
  const [workshopActiveLot, setWorkshopActiveLot] = useState<Record<string, {
    nome: string; preco: number;
    proximo: { preco: number; dataVirada: string; dias: number } | null;
  }>>({});
  // Passes (Day Pass/Full Pass) publicados do evento — pacote fixo de N
  // workshops, exibido em destaque ao lado dos workshops individuais.
  const [publicPasses, setPublicPasses] = useState<Array<{
    id: string; name: string; description: string | null;
    preco: number; preco_inscritos_mostra: number | null;
    workshop_names: string[]; esgotado: boolean;
  }>>([]);
  // Tier 2: estoque por tipo de ingresso (mapa idx → { sold, remaining, sold_out })
  const [stockByType, setStockByType] = useState<Record<string, { sold: number; remaining: number | null; sold_out: boolean }>>({});
  // Gêneros + modalidades estruturados (event_styles). Renderizado em seção
  // própria na vitrine pra inscrito ver de cara o leque técnico do festival.
  const [publicGenres, setPublicGenres] = useState<Array<{ name: string; sub_types: Array<{ name: string }> }>>([]);
  // Carrinho multi-tipo de ingressos: mapa realIdx(string) → quantidade.
  // React state local (não localStorage) — sessão zera ao sair, padrão Sympla.
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!idOrSlug) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // UUID v4 tem 36 chars com hifens — se nao for UUID, trata como slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        const filterCol = isUuid ? 'id' : 'slug';

        // Select explícito — evita vazar commission_percent/fee_mode/is_demo/
        // created_by/etc pra anon que carrega a vitrine pública. Listar
        // explicitamente também documenta o que a vitrine consome.
        // NOTAS (colunas DECLARADAS em types.ts mas SEM migration no DB —
        // incluí-las aqui retorna PGRST204 e a query inteira cai pra null):
        //   - registration_start_date / registration_end_date (janela de inscrição)
        //   - slots_limit (vagas)
        // Reativar quando as migrations forem criadas.
        const { data: eventData } = await supabase
          .from('events')
          .select(`
            id, slug, name, description, cover_url,
            location, city, state,
            start_date, end_date, event_time,
            instagram_event, tiktok_event, youtube_event, whatsapp_event, website_event, email_event,
            regulation_pdf_url,
            programacao_config, ingressos_config, formacoes_config, patrocinadores_config,
            politica_ingressos, audience_sales_enabled,
            audience_max_per_purchase, audience_max_per_cpf,
            producer_ga4_id, producer_meta_pixel_id
          `)
          .eq(filterCol, idOrSlug)
          .maybeSingle();

        if (!eventData) {
          // Slug não encontrado em events. Tenta no histórico — pode ser slug
          // antigo de um evento que foi renomeado. Se achar, redireciona pro
          // slug atual mantendo URL bonita (Fase 2 — Slug Hardening).
          if (!isUuid) {
            const { data: legacy } = await supabase
              .from('event_slug_history')
              .select('event_id, events(slug)')
              .eq('old_slug', idOrSlug)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const newSlug = (legacy as any)?.events?.slug;
            if (newSlug) {
              navigate(`/evento/${newSlug}`, { replace: true });
              return;
            }
          }
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
        // view_event é disparado num useEffect separado que aguarda
        // pixelsReady (ver abaixo) — não dispara aqui.

        // Etapa 1.5: jurados públicos via RPC security-definer
        // (retorna só campos seguros — sem PIN, sem token)
        const { data: judgesData } = await supabase.rpc('get_public_judges_for_event', {
          p_event_id: eventData.id,
        });
        if (Array.isArray(judgesData)) {
          setPublicJudges(judgesData as JudgePublic[]);
        }

        // Gêneros + modalidades estruturados desse evento (event_styles ativas).
        // RLS permite SELECT pra anon — leitura pública. Mostra na vitrine
        // o leque técnico do festival sem precisar abrir a inscrição.
        const { data: stylesData } = await supabase
          .from('event_styles')
          .select('name, sub_types')
          .eq('event_id', eventData.id)
          .eq('is_active', true)
          .order('name');
        if (Array.isArray(stylesData)) {
          setPublicGenres(stylesData.map((g: any) => ({
            name: g.name,
            sub_types: Array.isArray(g.sub_types)
              ? g.sub_types
                  .map((s: any) => ({ name: typeof s === 'string' ? s : (s?.name ?? '') }))
                  .filter((s: { name: string }) => s.name)
              : [],
          })));
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

          // Lote vigente por workshop — mesma regra do RPC get_workshop_stock
          // (maior ordem, is_active, dentro da janela data_inicio/data_fim).
          // Query única em vez de 1 RPC por card (evita N round-trips).
          if (wsData.length > 0) {
            const { data: lotsData } = await supabase
              .from('workshop_lots')
              .select('workshop_id, ordem, nome, preco, data_inicio, data_fim, is_active')
              .in('workshop_id', wsData.map((w: any) => w.id))
              .eq('is_active', true);
            if (Array.isArray(lotsData)) {
              const today = todayISO();
              const byWorkshop: Record<string, {
                nome: string; preco: number;
                proximo: { preco: number; dataVirada: string; dias: number } | null;
              }> = {};
              for (const ws of wsData as any[]) {
                const todosOsLotes = lotsData.filter((l: any) => l.workshop_id === ws.id);
                const ativo = resolveActiveWorkshopLot(todosOsLotes as any[]);
                if (!ativo) continue;
                const proximoLote = findNextWorkshopLot(todosOsLotes as any[], ativo);
                const proximo = proximoLote
                  ? {
                      preco: Number(proximoLote.preco),
                      dataVirada: String(proximoLote.data_inicio).slice(0, 10),
                      dias: diffDias(today, String(proximoLote.data_inicio).slice(0, 10)),
                    }
                  : null;
                byWorkshop[ws.id] = { nome: ativo.nome, preco: Number(ativo.preco), proximo };
              }
              setWorkshopActiveLot(byWorkshop);
            }
          }

          // Passes publicados do evento — pacote fixo, exibido em destaque.
          const { data: passesData } = await supabase
            .from('workshop_passes')
            .select('id, name, description, preco, preco_inscritos_mostra')
            .eq('event_id', eventData.id)
            .eq('is_published', true);
          if (Array.isArray(passesData) && passesData.length > 0) {
            const { data: itemsData } = await supabase
              .from('workshop_pass_items')
              .select('pass_id, workshop_id, workshops(name)')
              .in('pass_id', passesData.map((p: any) => p.id));
            const namesByPass: Record<string, string[]> = {};
            (itemsData ?? []).forEach((it: any) => {
              (namesByPass[it.pass_id] ??= []).push(it.workshops?.name ?? '');
            });
            const withStock = await Promise.all(passesData.map(async (p: any) => {
              const { data: stockRow } = await supabase.rpc('get_workshop_pass_stock', { p_pass_id: p.id });
              const row = Array.isArray(stockRow) ? stockRow[0] : stockRow;
              return { ...p, workshop_names: namesByPass[p.id] ?? [], esgotado: Boolean(row?.esgotado) };
            }));
            setPublicPasses(withStock);
          }
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

  // Fase 4B — view_event dispara só APÓS event carregado E ProducerPixels
  // ter chamado onReady. Garante que o GA4/Pixel do produtor recebem o
  // primeiro evento (gtag/fbq não replaya eventos pra streams configurados
  // depois). `viewTracked` evita duplicar se event/pixelsReady mudarem.
  // Também marca sessionStorage pra que o InscricaoWizard saiba que a
  // vitrine já trackeou (evita view_event duplicado se inscrito clica
  // "Inscreva-se" → wizard → ambos disparariam o mesmo evento).
  // CRÍTICO: este useEffect TEM QUE ficar antes dos early-returns abaixo
  // (`if (loading) return ...`, `if (!event) return ...`). Caso contrário,
  // o número de hooks chamados varia entre renders e React explode com
  // "Rendered more hooks than during the previous render" (error #310),
  // resultando em tela em branco no boot.
  useEffect(() => {
    if (!event || !pixelsReady || viewTracked) return;
    const eventId = String((event as any).id);
    trackViewEvent(
      {
        event_slug: (event as any).slug ?? eventId,
        event_name: (event as any).name ?? 'Festival',
      },
      {
        ga4:   (event as any).producer_ga4_id,
        pixel: (event as any).producer_meta_pixel_id,
      },
    );
    try { sessionStorage.setItem('coreohub_viewed_' + eventId, String(Date.now())); }
    catch { /* sessionStorage indisponível — segue sem flag */ }

    // Bloco 2 (2026-05-28): incrementa events.view_count pro topo do funil
    // de conversão do produtor. Dedup client-side via localStorage TTL 30min
    // (mesma janela do GA4 "session"). Cookies cross-origin entre coreohub.com
    // e supabase.co não funcionam — por isso dedup é local.
    try {
      const VIEW_TTL_MS = 30 * 60 * 1000;
      const viewKey = 'cohub_view_' + eventId;
      const lastView = Number(localStorage.getItem(viewKey) ?? 0);
      const now = Date.now();
      if (now - lastView > VIEW_TTL_MS) {
        localStorage.setItem(viewKey, String(now));
        const url = (import.meta as any).env?.VITE_SUPABASE_URL as string;
        if (url) {
          // Best-effort fire-and-forget — não bloqueia render.
          fetch(`${url}/functions/v1/track-event-view`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ event_id: eventId }),
            keepalive: true,
          }).catch(() => { /* offline / blocked — ignora */ });
        }
      }
    } catch { /* localStorage off — segue sem contagem */ }

    setViewTracked(true);
  }, [event, pixelsReady, viewTracked]);

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

  // Evento já encerrado (dia inteiro, end_date/start_date 23:59:59) trava
  // TODAS as compras da vitrine — inscrição, ingresso e workshop/pass.
  const eventOver = isEventOver(event);

  // Prazo real de inscrição vem de configuracoes.prazo_inscricao (campo que o
  // produtor preenche em Configurações → Geral). `event.registration_start_date`/
  // `registration_end_date` são colunas declaradas em types.ts mas nunca
  // migradas no banco — não usar (ficavam sempre undefined, então o botão
  // nunca desabilitava de fato).
  const isRegistrationOpen = (() => {
    if (eventOver) return false;
    const prazo = config?.prazo_inscricao;
    if (!prazo) return true;
    const deadline = new Date((prazo.includes('T') ? prazo : prazo + 'T23:59:59'));
    return Date.now() <= deadline.getTime();
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

  // Prefere slug nas URLs públicas pra link bonito compartilhável (Fase 1 — Padronização).
  // UUID como fallback se slug não existir.
  const slugOrId = event.slug ?? event.id;

  // Carrinho multi-tipo: limite total por compra (respeita config do evento) +
  // totais de quantidade/valor pra sticky bar. Valor é o de face (preview);
  // taxa/cupom só aparecem no checkout (padrão Sympla mostra face value).
  const maxPurchase = Math.max(1, Math.min(
    Number(event.audience_max_per_purchase ?? 6),
    Number(event.audience_max_per_cpf ?? 6),
  ));
  const cartTotalQty = Object.values(cart).reduce((s, n) => s + n, 0);
  const cartTotalBRL = Object.entries(cart).reduce((sum, [k, q]) => {
    const t = Array.isArray(event.ingressos_config) ? event.ingressos_config[Number(k)] : null;
    if (!t) return sum;
    const r = resolveLote(Array.isArray(t.lotes) ? t.lotes : null, todayISO());
    const p = r ? Number(r.lote.preco ?? 0) : Number(t.preco ?? 0);
    return sum + p * q;
  }, 0);
  const setTypeQty = (idx: number, qty: number) => {
    setCart(c => {
      const next = { ...c };
      if (qty <= 0) delete next[String(idx)];
      else next[String(idx)] = qty;
      return next;
    });
  };
  const localCidadeUf = [event.city, event.state].filter(Boolean).join(' / ');
  // Local específico (ex: "Concha Acústica Prof. Geraldo") + cidade pra contexto.
  // Botão "Ver no Google Maps" usa URL oficial sem API key (zero custo, mobile abre
  // app nativo). Padrão Sympla/Doity. Boas práticas em [[asaas-em-producao-shipado]].
  const mapsQuery = encodeURIComponent(
    [event.location, event.city, event.state].filter(Boolean).join(', ')
  );
  const mapsUrl = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;

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

  // Meta tags dinâmicas pra SEO (Fase 3 — React 19 nativo).
  // Estes elementos no JSX são içados pro <head> automaticamente pelo React 19.
  // Funciona pra Googlebot (executa JS no indexing). Bots de preview do WhatsApp/
  // Telegram/Insta NÃO executam JS — preview neles continua genérico até Subfase 3.2
  // (prerender server-side via Vercel Edge Middleware).
  const seoDescription = (event.description ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || `Inscrições abertas para ${event.name} — festival de dança no CoreoHub.`;
  const seoImage = event.cover_url || 'https://app.coreohub.com/coreohub-avatar.png';
  const seoUrl = typeof window !== 'undefined' ? window.location.href : `https://app.coreohub.com/evento/${event.slug ?? event.id}`;
  const seoTitle = `${event.name} — Inscrições abertas | CoreoHub`;

  // Schema.org BreadcrumbList — sinaliza hierarquia "Festivais › Usualdance"
  // pro Google montar rich snippet de navegação nos resultados. URL canônica
  // do detalhe continua /evento/<slug> (não muda) — breadcrumb só DESCREVE
  // a hierarquia conceitual: Home → Festivais → este evento.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'CoreoHub',
        item: 'https://coreohub.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Festivais',
        item: 'https://app.coreohub.com/festivais',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: event.name,
        item: seoUrl,
      },
    ],
  };

  // Schema.org Event pra rich snippets do Google (data, local, organizador).
  const eventJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    description: seoDescription,
    image: seoImage,
    startDate: event.start_date,
    endDate: event.end_date ?? event.start_date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.location || (localCidadeUf || 'Brasil'),
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.city ?? undefined,
        addressRegion: event.state ?? undefined,
        addressCountry: 'BR',
      },
    },
    organizer: {
      '@type': 'Organization',
      name: 'CoreoHub',
      url: 'https://coreohub.com',
    },
    url: seoUrl,
  };

  // Tem informação útil de local? (endereço completo OU mapa OU local específico)
  const hasLocalInfo = !!(event.location || localCidadeUf);

  // Fase 4B — dispara begin_checkout/InitiateCheckout quando inscrito clica Inscreva-se.
  // Não impede a navegação do Link (fire-and-forget). Endereça pros pixels do
  // produtor explicitamente via `send_to`/`trackSingle` (evita pollution se
  // user navegou de outro festival na mesma sessão).
  const onInscrevaseClick = () => {
    trackBeginCheckout(
      {
        event_slug: slugOrId,
        event_name: event.name ?? 'Festival',
      },
      {
        ga4:   (event as any).producer_ga4_id,
        pixel: (event as any).producer_meta_pixel_id,
      },
    );
  };

  // Etapa 1.5: monta lista de sections visíveis pro anchor menu.
  // Renderiza só seções que de fato têm conteúdo (evita item morto no menu).
  const visibleSections: AnchorSection[] = [
    event.description ? { id: 'sobre', label: 'Sobre' } : null,
    hasLocalInfo ? { id: 'local', label: 'Local' } : null,
    publicGenres.length > 0 ? { id: 'estilos', label: 'Estilos' } : null,
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
      {/* Pixels do produtor — Fase 4B. Carrega GA4+Pixel do dono do festival
          em paralelo aos pixels master da CoreoHub. Idempotente (não re-init).
          `onReady` libera o disparo do view_event abaixo. */}
      <ProducerPixels
        ga4Id={(event as any).producer_ga4_id}
        metaPixelId={(event as any).producer_meta_pixel_id}
        onReady={() => setPixelsReady(true)}
      />

      {/* Meta tags dinâmicas — React 19 nativo as iça pro <head> (Fase 3 — SEO). */}
      <title>{seoTitle}</title>
      <meta name="description" content={seoDescription} />
      <meta property="og:title" content={event.name} />
      <meta property="og:description" content={seoDescription} />
      <meta property="og:image" content={seoImage} />
      <meta property="og:url" content={seoUrl} />
      <meta property="og:type" content="event" />
      <meta property="og:site_name" content="CoreoHub" />
      <meta property="og:locale" content="pt_BR" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={event.name} />
      <meta name="twitter:description" content={seoDescription} />
      <meta name="twitter:image" content={seoImage} />
      <link rel="canonical" href={seoUrl} />
      <script type="application/ld+json">{JSON.stringify(eventJsonLd)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd)}</script>

      {/* Breadcrumb visual — sinaliza hierarquia pro user E refleja o
          BreadcrumbList que injetamos pro Google. URL canônica continua
          /evento/<slug>, breadcrumb só descreve contexto. Padrão a11y:
          <nav aria-label="Breadcrumb"> + lista ordenada. */}
      <nav aria-label="Breadcrumb" className="relative z-10 bg-black/40 backdrop-blur-sm border-b border-white/5">
        <ol className="max-w-5xl mx-auto px-8 py-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 overflow-x-auto whitespace-nowrap">
          <li>
            <a href="https://coreohub.com" className="hover:text-[#ff0068] transition-colors">
              CoreoHub
            </a>
          </li>
          <li aria-hidden="true" className="text-slate-600">›</li>
          <li>
            <Link to="/festivais" className="hover:text-[#ff0068] transition-colors">
              Festivais
            </Link>
          </li>
          <li aria-hidden="true" className="text-slate-600">›</li>
          <li aria-current="page" className="text-white truncate max-w-[60vw]">
            {event.name}
          </li>
        </ol>
      </nav>

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
            {(event as any).video_selection_enabled && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-full">
                <Video size={12} className="text-amber-400" />
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">
                  Seletiva por vídeo
                  {(event as any).video_selection_fee_required && Number((event as any).video_selection_fee ?? 0) > 0 && (
                    <span className="font-bold text-amber-300/80 normal-case tracking-normal ml-2">
                      · taxa R$ {Number((event as any).video_selection_fee).toFixed(2).replace('.', ',')} antes da análise
                    </span>
                  )}
                </span>
              </div>
            )}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter italic leading-none mb-4"
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
              {localCidadeUf && (
                <div className="flex items-center gap-2 text-slate-300">
                  <MapPin size={16} className="text-[#ff0068]" />
                  {localCidadeUf}
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
              to={`/festival/${slugOrId}/register`}
              onClick={onInscrevaseClick}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff0068] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all"
            >
              Inscreva-se <ChevronRight size={12} />
            </Link>
          ) : undefined
        }
      />

      {/* Content */}
      <div className="max-w-5xl mx-auto px-8 py-16 space-y-12">
        {/* Banner de evento encerrado — padrão Sympla/Eventbrite: página continua
            no ar (certificado/resultado/compartilhamento), mas todas as compras
            (inscrição/ingresso/workshop/pass) ficam desabilitadas. */}
        {eventOver && (
          <div role="status" className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-6 py-4 flex items-center gap-3">
            <Clock size={20} className="text-amber-400 shrink-0" />
            <p className="text-sm font-bold text-amber-300">Este evento já aconteceu. Vendas e inscrições estão encerradas.</p>
          </div>
        )}

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

        {/* Local — endereço + botão Google Maps. Mobile-friendly (hero só mostra
            cidade/UF curto pra não estourar a arte). Tipografia plana pra não
            competir com a descrição do "Sobre". Botão outline = secundário,
            mesmo padrão do "Resultados" lá embaixo (CTA primário só "Inscreva-se"). */}
        {hasLocalInfo && (
          <div id="local" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <MapPin size={24} className="text-[#ff0068]" /> Local
            </h2>
            <div className="space-y-3">
              <p className="text-slate-400 leading-relaxed">
                {event.location && <>{event.location}<br /></>}
                {localCidadeUf}
              </p>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] hover:border-[#ff0068]/50 transition-all"
                >
                  <MapPin size={16} /> Ver no Google Maps
                </a>
              )}
            </div>
          </div>
        )}

        {/* Estilos & Modalidades — leque técnico do festival.
            Cada gênero vira card; se tem modalidades (sub_types), aparecem
            como chips. Inscrito vê de cara em quais estilos pode competir. */}
        {publicGenres.length > 0 && (
          <div id="estilos" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Music size={24} className="text-[#ff0068]" /> Estilos & Modalidades
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {publicGenres.map(g => (
                <div
                  key={g.name}
                  className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-[#ff0068]/30 transition-colors"
                >
                  <p className="text-sm font-black uppercase tracking-tight text-white">{g.name}</p>
                  {g.sub_types.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {g.sub_types.map(s => (
                        <span
                          key={s.name}
                          className="text-[10px] font-bold px-2 py-1 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-full"
                        >
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                {eventOver ? (
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Vendas encerradas</p>
                ) : (
                <a
                  href={config.url_ingressos}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-6 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
                >
                  <Ticket size={18} /> Comprar Ingressos <ExternalLink size={14} />
                </a>
                )}
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
                      const nomeLote: string | null = r ? nomeDoLote(lotes, r.idx) : null;
                      const hint = r && r.proximo && r.lote.data_virada && Number(r.proximo.preco) > Number(r.lote.preco)
                        ? { proximoPreco: Number(r.proximo.preco), dataVirada: r.lote.data_virada, dias: diffDias(today, r.lote.data_virada) }
                        : null;
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
                              {preco > 0 ? `R$ ${formatPrecoBR(preco)}` : 'Grátis'}
                            </p>
                          </div>
                          {t.obs && <p className="text-[10px] text-slate-400">{t.obs}</p>}

                          {hint && !soldOut && (
                            <p className="text-[10px] font-bold text-[#ff0068]">
                              <AvisoViradaLote preco={hint.proximoPreco} dataVirada={hint.dataVirada} dias={hint.dias} formatPreco={n => `R$ ${formatPrecoBR(n)}`} />
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

                          {eventOver && (
                            <span className="self-start text-[10px] font-black uppercase tracking-widest text-amber-400 mt-2">Vendas encerradas</span>
                          )}

                          {/* Carrinho multi-tipo: +/− por tipo (padrão Sympla/Eventbrite).
                              Some "Comprar" individual; total vai pra sticky bar. */}
                          {!eventOver && salesEnabled && preco > 0 && !soldOut && (() => {
                            const key = String(realIdx);
                            const qty = cart[key] ?? 0;
                            const isMeia = String(t.nome).toLowerCase().includes('meia');
                            const remaining = stock?.remaining ?? Infinity;
                            const typeCap = Math.min(isMeia ? 1 : 99, remaining);
                            const atGlobalMax = cartTotalQty >= maxPurchase;
                            if (qty === 0) {
                              return (
                                <button
                                  type="button"
                                  disabled={atGlobalMax}
                                  aria-label={`Adicionar ${t.nome} ao carrinho`}
                                  onClick={() => setTypeQty(realIdx, 1)}
                                  title={atGlobalMax ? `Máximo de ${maxPurchase} ingressos por compra` : undefined}
                                  className="self-start inline-flex items-center gap-1.5 px-4 py-2 mt-2 bg-[#ff0068] text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                                >
                                  <Plus size={12} /> Adicionar
                                </button>
                              );
                            }
                            return (
                              <div className="self-start inline-flex items-center gap-3 mt-2">
                                <button
                                  type="button"
                                  aria-label={qty <= 1 ? `Remover ${t.nome} do carrinho` : `Diminuir quantidade de ${t.nome}`}
                                  onClick={() => setTypeQty(realIdx, qty - 1)}
                                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="text-base font-black tabular-nums w-5 text-center">{qty}</span>
                                <button
                                  type="button"
                                  aria-label={`Adicionar um ${t.nome}`}
                                  disabled={qty >= typeCap || atGlobalMax}
                                  title={atGlobalMax ? `Máximo de ${maxPurchase} ingressos por compra` : (qty >= typeCap ? 'Limite deste tipo atingido' : undefined)}
                                  onClick={() => setTypeQty(realIdx, Math.min(typeCap, qty + 1))}
                                  className="w-8 h-8 rounded-lg bg-[#ff0068]/80 hover:bg-[#ff0068] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            );
                          })()}
                          {!eventOver && !salesEnabled && t.link && (
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

        {/* Modalities — entry point modalidade-first.
            Cada card vira botão clicável que pré-seleciona a modalidade
            no fluxo de inscrição via ?modalidade=<nome>. Padrão Sympla/Eventbrite:
            usuário declara intenção (modalidade) antes de logar/preencher dados.
            Reduz fricção do passo "Complete seu perfil" obrigatório. */}
        {event.formacoes_config && event.formacoes_config.length > 0 && (
          <div id="inscricoes" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Music size={24} className="text-[#ff0068]" /> Inscrições disponíveis
            </h2>
            <p className="text-xs text-slate-400 -mt-2">
              Escolha a modalidade pra começar sua inscrição.
            </p>
            {/* Tags dos tipos de mostra aceitos. Padrão de mercado (Stripe/Linear):
                chips neutros com ícone, sempre visíveis pra explicitar o que o
                evento aceita. Default ['Competitiva'] quando produtor não
                configurou (fallback consistente com InscricaoWizard). */}
            {(() => {
              const tipos: string[] = Array.isArray(config?.tipos_apresentacao) && config.tipos_apresentacao.length > 0
                ? config.tipos_apresentacao
                : ['Competitiva'];
              const aceitaCompetitiva = tipos.includes('Competitiva');
              const aceitaAvaliada    = tipos.includes('Avaliada');
              return (
                <div className="flex flex-wrap items-center gap-2 -mt-1">
                  {aceitaCompetitiva && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
                      <Trophy size={12} className="text-[#ff0068]" />
                      Mostra Competitiva
                    </span>
                  )}
                  {aceitaAvaliada && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
                      <GraduationCap size={12} className="text-violet-400 dark:text-violet-300" />
                      Mostra Avaliada
                    </span>
                  )}
                </div>
              );
            })()}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.formacoes_config.map((mod: any, i: number) => {
                const today = todayISO();
                const lotes: Lote[] = Array.isArray(mod.lotes) ? mod.lotes : [];
                const r = resolveLote(lotes, today);
                const precoExibir = r ? Number(r.lote.preco ?? 0) : (mod.fee != null ? Number(mod.fee) : null);
                const nomeLote: string | null = r ? nomeDoLote(lotes, r.idx) : null;
                const hint = r && r.proximo && r.lote.data_virada && Number(r.proximo.preco) > Number(r.lote.preco)
                  ? { proximoPreco: Number(r.proximo.preco), dataVirada: r.lote.data_virada, dias: diffDias(today, r.lote.data_virada) }
                  : null;

                // PR-B: usa rota nova do wizard de 4 passos. PrivateRoute
                // redireciona pra login se necessário (preservando redirectTo).
                const targetUrl = `/festival/${idOrSlug}/inscrever/${encodeURIComponent(mod.name)}`;

                return (
                  <Link
                    key={i}
                    to={isRegistrationOpen ? targetUrl : '#'}
                    aria-disabled={!isRegistrationOpen}
                    onClick={e => { if (!isRegistrationOpen) e.preventDefault(); }}
                    className={`block bg-white/5 border border-white/10 rounded-2xl p-5 transition-all group ${
                      isRegistrationOpen
                        ? 'hover:border-[#ff0068]/50 hover:bg-[#ff0068]/5 cursor-pointer'
                        : 'opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="min-w-0">
                        <span className="font-black uppercase text-sm">{mod.name}</span>
                        {nomeLote && (
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{nomeLote}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[#ff0068] font-black text-sm">
                          {precoExibir != null && precoExibir > 0 ? `R$ ${formatPrecoBR(precoExibir)}` : 'Gratuito'}
                        </span>
                        {isRegistrationOpen && (
                          <ChevronRight size={16} className="text-slate-500 group-hover:text-[#ff0068] group-hover:translate-x-0.5 transition-all" />
                        )}
                      </div>
                    </div>
                    {!isRegistrationOpen && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mt-3 pt-3 border-t border-white/5">
                        Inscrições encerradas ou ainda não abertas
                      </p>
                    )}
                    {hint && isRegistrationOpen && (
                      <p className="text-[10px] font-bold mt-3 pt-3 border-t border-white/5 text-[#ff0068]">
                        <AvisoViradaLote preco={hint.proximoPreco} dataVirada={hint.dataVirada} dias={hint.dias} formatPreco={n => `R$ ${formatPrecoBR(n)}`} />
                      </p>
                    )}
                    {isRegistrationOpen && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-[#ff0068] mt-3 pt-3 border-t border-white/5 transition-colors">
                        Inscrever {mod.name.toLowerCase()} →
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
            {/* CTA fallback — pra quem ainda não escolheu modalidade. */}
            {isRegistrationOpen && (
              <Link
                to={`/festival/${slugOrId}/register`}
              onClick={onInscrevaseClick}
                className="mt-2 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3.5 bg-transparent border border-[#ff0068]/30 hover:bg-[#ff0068]/10 text-[#ff0068] rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
              >
                Ver todas e escolher depois <ChevronRight size={16} />
              </Link>
            )}
          </div>
        )}

        {/* Workshops do evento — cards com link pra vitrine individual + checkout */}
        {publicWorkshops.length > 0 && (
          <div id="workshops" className="space-y-4 scroll-mt-20">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <BrandIcon size={24} /> Workshops
            </h2>
            <p className="text-xs text-slate-400">Aprimore sua técnica com quem é referência. Inscritos da mostra têm preço especial.</p>

            {/* Passes (Day Pass/Full Pass) — destaque acima dos workshops avulsos,
                padrão de convenções de dança (NUVO/JUMP): pacote por nível de acesso. */}
            {publicPasses.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {publicPasses.map(pass => (
                  <button
                    key={pass.id}
                    onClick={() => !pass.esgotado && !eventOver && navigate(`/checkout-workshop-pass/${pass.id}`)}
                    disabled={pass.esgotado || eventOver}
                    className="text-left bg-gradient-to-br from-[#ff0068]/15 to-[#1de7f2]/10 border-2 border-[#ff0068]/40 hover:border-[#ff0068] rounded-2xl p-5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-[#ff0068] text-white px-2.5 py-1 rounded-full">
                        <Ticket size={11} />Pass
                      </span>
                      {pass.esgotado && !eventOver && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">Esgotado</span>
                      )}
                      {eventOver && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Vendas encerradas</span>
                      )}
                    </div>
                    <h3 className="font-black uppercase tracking-tight text-white text-base leading-tight">{pass.name}</h3>
                    {pass.description && <p className="text-xs text-slate-300 mt-1 line-clamp-2">{pass.description}</p>}
                    <p className="text-[11px] text-slate-400 mt-2">Inclui: {pass.workshop_names.filter(Boolean).join(', ')}</p>
                    <p className="text-lg font-black text-white pt-2">
                      {Number(pass.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    {pass.preco_inscritos_mostra != null && (
                      <p className="text-xs text-violet-300">↓ {Number(pass.preco_inscritos_mostra).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} p/ inscritos</p>
                    )}
                  </button>
                ))}
              </div>
            )}

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
                const loteAtivo = workshopActiveLot[ws.id];
                const preco = loteAtivo ? loteAtivo.preco : ws.preco_padrao;
                return (
                  <button
                    key={ws.id}
                    onClick={() => navigate(`/workshop/${ws.slug ?? ws.id}${discountToken ? `?discount_token=${discountToken}` : ''}`)}
                    className="text-left bg-white/5 border border-white/10 hover:border-[#ff0068]/40 rounded-2xl overflow-hidden transition-colors group"
                  >
                    <div className="aspect-[16/9] bg-gradient-to-br from-[#ff0068]/20 to-purple-500/20 relative overflow-hidden">
                      {(ws.cover_url || ws.professor_photo_url) && (
                        <img src={ws.cover_url || ws.professor_photo_url || ''} alt={ws.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
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
                      {loteAtivo && (
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{loteAtivo.nome}</p>
                      )}
                      <p className="text-sm font-black text-white pt-1">
                        {preco === 0
                          ? 'Grátis'
                          : Number(preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                      {loteAtivo?.proximo && (
                        <p className="text-[10px] font-bold text-[#ff0068]">
                          <AvisoViradaLote preco={loteAtivo.proximo.preco} dataVirada={loteAtivo.proximo.dataVirada} dias={loteAtivo.proximo.dias} formatPreco={n => `R$ ${formatPrecoBR(n)}`} />
                        </p>
                      )}
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
              {enabledAwards.map((award: any) => {
                // Sessão 2026-05-27 — card refatorado:
                // Nome → Valor R$ (se > 0, destaque emerald) → Descrição (se preenchida)
                // → badge formation (se != TODOS). Sem descrições padrão poluindo.
                const valor = typeof award.valor === 'number' && award.valor > 0 ? award.valor : null;
                return (
                  <div key={award.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
                    <p className="font-black uppercase text-sm tracking-tight text-slate-900 dark:text-white">{award.name}</p>
                    {valor && (
                      <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                        {valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    )}
                    {award.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{award.description}</p>
                    )}
                    {award.formation && award.formation !== 'TODOS' && (
                      <span className="inline-block mt-2 px-2 py-1 rounded-full bg-[#ff0068]/10 text-[#ff0068] text-[9px] font-black uppercase tracking-widest">
                        {award.formation}
                      </span>
                    )}
                  </div>
                );
              })}
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
                to={`/festival/${slugOrId}/register`}
              onClick={onInscrevaseClick}
                className="px-8 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] text-center hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/30 flex items-center justify-center gap-2"
              >
                Inscreva-se <ChevronRight size={16} />
              </Link>
            )}
            <Link
              to={`/festival/${slugOrId}/leaderboard`}
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

        {/* Espaçador pra sticky bar não cobrir o último bloco */}
        {cartTotalQty > 0 && <div className="h-24" aria-hidden="true" />}
      </div>

      {/* Sticky bar do carrinho — aparece quando há ≥1 ingresso selecionado.
          Mostra qty + total de face; checkout exibe taxa/cupom (padrão Sympla). */}
      {cartTotalQty > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-[60] bg-[#0b0b0f]/95 backdrop-blur border-t border-[#ff0068]/30 shadow-[0_-8px_30px_rgba(0,0,0,0.5)]">
          <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {cartTotalQty} ingresso{cartTotalQty === 1 ? '' : 's'}
              </p>
              <p className="text-lg font-black text-white tabular-nums leading-tight">
                R$ {formatPrecoBR(cartTotalBRL)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/checkout-ingresso/${slugOrId}`, { state: { cart } })}
              className="inline-flex items-center gap-2 px-5 sm:px-7 py-3 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f] shrink-0 shadow-lg shadow-[#ff0068]/20"
            >
              <Ticket size={14} /> Ir pro carrinho <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicEventPage;
