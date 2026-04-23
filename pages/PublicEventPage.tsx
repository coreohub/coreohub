import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Calendar, MapPin, Users, Music, Ticket, ExternalLink,
  ChevronRight, Trophy, Clock, Star, Loader2, ArrowLeft, Youtube, Radio
} from 'lucide-react';
import { motion } from 'motion/react';
import BrandIcon from '../components/BrandIcon';

const PublicEventPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [registrationsCount, setRegistrationsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: eventData }, { data: cfg }, { count }] = await Promise.all([
          supabase.from('events').select('*').eq('id', id).single(),
          supabase.from('configuracoes').select('*').eq('id', 1).single(),
          supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('event_id', id)
        ]);

        setEvent(eventData);
        setConfig(cfg);
        setRegistrationsCount(count || 0);
      } catch (err) {
        console.error('Erro ao carregar evento:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

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
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-[#ff0068] font-black uppercase text-sm">
          <ArrowLeft size={16} /> Voltar
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
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#ff0068]/20 via-transparent to-[#050505]" />
        {event.cover_url ? (
          <img src={event.cover_url} alt={event.name} className="w-full h-[50vh] object-cover opacity-30" />
        ) : (
          <div className="w-full h-[50vh] bg-gradient-to-br from-[#ff0068]/10 via-slate-900 to-[#050505]" />
        )}

        <div className="absolute inset-0 flex flex-col justify-end p-8 lg:p-16">
          <div className="max-w-4xl">
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
              {event.address && (
                <div className="flex items-center gap-2 text-slate-300">
                  <MapPin size={16} className="text-[#ff0068]" />
                  {event.address}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-8 py-16 space-y-12">
        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Inscrições', value: registrationsCount, icon: Users },
            { label: 'Vagas', value: event.slots_limit ?? '∞', icon: Star },
            { label: 'Prazo', value: formatDate(event.registration_deadline), icon: Clock },
            { label: 'Premiação', value: config?.premiacao || '—', icon: Trophy },
          ].map(({ label, value, icon: Icon }) => (
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
            <p className="text-slate-400 leading-relaxed">{event.description}</p>
          </div>
        )}

        {/* Modalities */}
        {event.modalities_config && event.modalities_config.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Music size={24} className="text-[#ff0068]" /> Modalidades
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.modalities_config.map((mod: any, i: number) => (
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
                to={`/festival/${id}/register`}
                className="px-8 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] text-center hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/30 flex items-center justify-center gap-2"
              >
                Inscrever-se <ChevronRight size={16} />
              </Link>
            )}
            <Link
              to={`/festival/${id}/leaderboard`}
              className="px-8 py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] text-center hover:border-[#ff0068]/50 transition-all flex items-center justify-center gap-2"
            >
              <Trophy size={16} /> Ver Ranking
            </Link>
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
