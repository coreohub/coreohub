import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { Instagram, Globe, MessageCircle, ArrowLeft, Loader2, MapPin, Calendar, User } from 'lucide-react';
import BrandIcon from '../components/BrandIcon';
import { Event } from '../types';

interface PublicProducer {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  public_slug: string;
  instagram_producer: string | null;
  whatsapp_producer: string | null;
  website_producer: string | null;
}

const formatDateRange = (start?: string, end?: string) => {
  if (!start) return 'Em breve';
  const d1 = new Date(start + 'T12:00:00');
  const clean = (s: string) => s.replace(/\./g, '').replace(/,/g, '').trim();
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => clean(d.toLocaleDateString('pt-BR', opts));
  const fullOpts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: 'short' };
  if (!end || end === start) return fmt(d1, fullOpts);
  const d2 = new Date(end + 'T12:00:00');
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
  if (sameMonth) return `${fmt(d1, { day: '2-digit' })} A ${fmt(d2, fullOpts)}`;
  return `${fmt(d1, fullOpts)} A ${fmt(d2, fullOpts)}`;
};

const normalizeInstagramUrl = (handle: string) =>
  handle.startsWith('http') ? handle : `https://instagram.com/${handle.replace('@', '')}`;

const normalizeWhatsappUrl = (raw: string) => {
  if (raw.startsWith('http')) return raw;
  const digits = raw.replace(/\D/g, '');
  return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`;
};

const normalizeWebsiteUrl = (raw: string) => (raw.startsWith('http') ? raw : `https://${raw}`);

const ProducerPublicPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [producer, setProducer] = useState<PublicProducer | null | undefined>(undefined); // undefined = carregando
  const [events, setEvents] = useState<Event[]>([]);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      const { data: producerData, error: producerError } = await supabase
        .rpc('get_public_producer', { p_slug: slug })
        .maybeSingle();
      if (producerError) {
        console.error('[ProducerPublicPage] erro ao buscar produtor:', producerError);
      }
      if (!producerData) {
        setProducer(null);
        return;
      }
      setProducer(producerData as PublicProducer);

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, slug, name, cover_url, start_date, end_date, location, city, state, edition_year, is_public')
        .eq('created_by', (producerData as PublicProducer).id)
        .eq('is_public', true)
        .order('start_date', { ascending: false });
      if (eventsError) {
        console.error('[ProducerPublicPage] erro ao buscar eventos do produtor:', eventsError);
      }
      const complete = (eventsData ?? []).filter((e: any) => e.cover_url);
      setEvents(complete as Event[]);
    };
    load();
  }, [slug]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const proximos = useMemo(() => events.filter(e => !e.end_date || e.end_date >= today), [events, today]);
  const passados = useMemo(() => events.filter(e => e.end_date && e.end_date < today), [events, today]);

  if (producer === undefined) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="text-[#ff0068] animate-spin" size={48} />
      </div>
    );
  }

  if (producer === null) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-6 p-8">
        <User size={64} className="text-slate-700" />
        <h1 className="text-3xl font-black uppercase tracking-tighter">Página não encontrada</h1>
        <button onClick={() => navigate('/festivais')} className="flex items-center gap-2 text-[#ff0068] font-black uppercase text-sm">
          <ArrowLeft size={16} /> Ver festivais
        </button>
      </div>
    );
  }

  const socialLinks = [
    producer.instagram_producer && { href: normalizeInstagramUrl(producer.instagram_producer), label: 'Instagram', Icon: Instagram },
    producer.whatsapp_producer && { href: normalizeWhatsappUrl(producer.whatsapp_producer), label: 'WhatsApp', Icon: MessageCircle },
    producer.website_producer && { href: normalizeWebsiteUrl(producer.website_producer), label: 'Site', Icon: Globe },
  ].filter(Boolean) as { href: string; label: string; Icon: any }[];

  const displayed = showPast ? passados : proximos;

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <nav aria-label="Breadcrumb" className="bg-black/40 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-5xl mx-auto px-8 py-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Link to="/festivais" className="hover:text-[#ff0068] transition-colors flex items-center gap-1.5">
            <ArrowLeft size={12} /> Vitrine de festivais
          </Link>
        </div>
      </nav>

      <header className="px-8 lg:px-16 pt-12 pb-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#ff0068] to-[#d4005a] flex items-center justify-center text-white font-black text-3xl shadow-lg shadow-[#ff0068]/20 overflow-hidden shrink-0">
            {producer.avatar_url
              ? <img src={producer.avatar_url} alt={producer.full_name} className="w-full h-full object-cover" />
              : (producer.full_name?.[0]?.toUpperCase() || <User size={28} />)}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-black uppercase tracking-tighter italic">{producer.full_name}</h1>
            {producer.bio && (
              <p className="text-slate-400 text-sm leading-relaxed mt-2 max-w-2xl">{producer.bio}</p>
            )}
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-2 mt-4">
                {socialLinks.map(({ href, label, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/30 transition-colors"
                  >
                    <Icon size={15} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-8 lg:px-16 pb-24">
        <div className="flex items-center gap-2 mb-6 border-b border-white/10">
          <button
            onClick={() => setShowPast(false)}
            className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors ${
              !showPast ? 'border-[#ff0068] text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Próximos ({proximos.length})
          </button>
          <button
            onClick={() => setShowPast(true)}
            className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors ${
              showPast ? 'border-[#ff0068] text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Edições passadas ({passados.length})
          </button>
        </div>

        {displayed.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            {showPast ? 'Nenhuma edição passada por aqui ainda.' : 'Nenhum evento aberto no momento.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map(event => (
              <Link
                key={event.id}
                to={`/evento/${event.slug ?? event.id}`}
                className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 hover:border-[#ff0068]/40 transition-all flex flex-col ${showPast ? 'opacity-70 hover:opacity-100' : ''}`}
              >
                <div className="relative aspect-[1200/630] overflow-hidden bg-slate-900">
                  {event.cover_url ? (
                    <img src={event.cover_url} alt={event.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#ff0068]/20 via-purple-900/20 to-slate-900 flex items-center justify-center">
                      <BrandIcon size={40} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#ff0068]/90 backdrop-blur rounded-full">
                      <Calendar size={12} />
                      <span className="text-[10px] font-black uppercase tracking-widest">{formatDateRange(event.start_date, event.end_date)}</span>
                    </div>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="text-base font-black uppercase tracking-tighter line-clamp-2 mb-2 group-hover:text-[#ff0068] transition-colors">
                    {event.name}
                  </h3>
                  {(event.city || (event as any).location) && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                      <MapPin size={12} className="text-[#ff0068] shrink-0" />
                      <span className="truncate">{[event.city, event.state].filter(Boolean).join(' / ') || (event as any).location}</span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default ProducerPublicPage;
