import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Trophy, Users, Sparkles, ChevronRight, Play, Star } from 'lucide-react';
import { motion } from 'motion/react';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#3b0764,transparent)] opacity-40" />
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10" />
        
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 space-y-8 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-xl">
            <Sparkles size={14} className="text-[#e3ff0a]" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#e3ff0a]">The Future of Dance Management</span>
          </div>
          
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase leading-[0.9] italic">
            Coreo<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff0068] to-[#e3ff0a]">Hub</span>
          </h1>
          
          <p className="text-slate-400 text-lg md:text-xl font-medium max-w-2xl mx-auto leading-relaxed">
            A plataforma definitiva para festivais de dança. Gestão técnica, avaliações em tempo real e inteligência artificial para o seu palco.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <button onClick={() => navigate('/login')} className="group relative px-12 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(255,0,104,0.3)] hover:scale-105 transition-all overflow-hidden">
              <span className="relative z-10 flex items-center gap-2">Entrar na Plataforma <ChevronRight size={18} /></span>
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            </button>
            <button onClick={() => navigate('/festival/1')} className="px-12 py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-white/10 transition-all">
              Ver Festivais Ativos
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="absolute bottom-12 left-0 w-full px-6">
          <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-white/5 pt-12">
            {[
              { label: 'Festivais', val: '150+' },
              { label: 'Bailarinos', val: '45k+' },
              { label: 'Avaliações', val: '120k+' },
              { label: 'Uptime', val: '99.9%' }
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl font-black text-white tracking-tighter">{stat.val}</div>
                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 px-6 bg-slate-950 relative">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: Music, title: 'Sonoplastia Cloud', desc: 'Upload e gestão de trilhas sonoras com backup redundante e player técnico dedicado.' },
            { icon: Star, title: 'Júri Digital', desc: 'Terminais de avaliação offline-first para jurados, com feedbacks em áudio e texto.' },
            { icon: Users, title: 'Gestão de Escolas', desc: 'Painel completo para diretores gerenciarem bailarinos, inscrições e pagamentos.' }
          ].map((feat, idx) => (
            <div key={idx} className="p-10 bg-white/5 border border-white/5 rounded-[3rem] hover:border-[#ff0068]/30 transition-all group">
              <div className="w-14 h-14 bg-[#ff0068]/10 text-[#ff0068] rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <feat.icon size={28} />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-4">{feat.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed font-medium">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
