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

        const { data: cfg } = await supabase
          .from('configuracoes')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        setEvent(eventData);
        setConfig(cfg);
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
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
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
  const premiacaoLabel = enabledAwards.length > 0
    ? `${enabledAwards.length} prêmio${enabledAwards.length !== 1 ? 's' : ''}`
    : '—';

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
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
                  {formatDate(event.start_date)}
                  {event.end_date && event.end_date !== event.start_date && ` — ${formatDate(event.end_date)}`}
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
            { label: 'Premiação', value: premiacaoLabel, icon: Trophy },
          ].filter(Boolean) as { label: string; value: any; icon: any }[]).map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <Icon size={20} className="text-[#ff0068] mb-3" />
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</p>
              <p className="text-xl font-black text-white tracking-tighter mt-1">{String(value)}</p>
            </div>
          ))}
        </div>

        {/* Description */}
        {event.description && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter">Sobre o Evento</h2>
            <p className="text-slate-400 leading-relaxed whitespace-pre-line">{event.description}</p>
          </div>
        )}

        {/* Programação */}
        {Array.isArray(event.programacao_config) && event.programacao_config.length > 0 && (
          <div className="space-y-4">
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

        {/* Ingressos para Audiência */}
        {Array.isArray(event.ingressos_config) && event.ingressos_config.filter((t: any) => t.nome).length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Ticket size={24} className="text-[#ff0068]" /> Ingressos
            </h2>
            <p className="text-xs text-slate-400">Para o público que vai assistir. Bailarinos inscritos não precisam comprar.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.ingressos_config
                .filter((t: any) => t.nome)
                .map((t: any, i: number) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-2 hover:border-[#ff0068]/40 transition-colors">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-black uppercase text-sm text-white">{t.nome}</p>
                      <p className="text-[#ff0068] font-black text-lg">
                        {Number(t.preco) > 0 ? `R$ ${Number(t.preco).toFixed(2)}` : 'Grátis'}
                      </p>
                    </div>
                    {t.obs && <p className="text-[10px] text-slate-400">{t.obs}</p>}
                    {t.link && (
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
                ))}
            </div>
          </div>
        )}

        {/* Modalities */}
        {event.formacoes_config && event.formacoes_config.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Music size={24} className="text-[#ff0068]" /> Inscrições disponíveis
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.formacoes_config.map((mod: any, i: number) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex justify-between items-center">
                  <span className="font-black uppercase text-sm">{mod.name}</span>
                  <span className="text-[#ff0068] font-black text-sm">
                    {mod.fee ? `R$ ${Number(mod.fee).toFixed(2)}` : 'Gratuito'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prêmios habilitados */}
        {enabledAwards.length > 0 && (
          <div className="space-y-4">
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
                Inscrever-se <ChevronRight size={16} />
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

        {/* Regulamento PDF — download direto */}
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

        {/* Ticket link */}
        {config?.url_ingressos && (
          <div className="flex justify-center">
            <a
              href={config.url_ingressos}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-[#ff0068] transition-all"
            >
              <Ticket size={16} /> Comprar Ingresso de Plateia <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicEventPage;
