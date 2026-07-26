import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight, Sparkles, FileText, Wifi, Link as LinkIcon,
  Trophy, Shield, Award, GraduationCap, Mic2, Check, X, ChevronDown,
  AlertTriangle, ArrowRight, Menu,
  CalendarClock, Globe, IdCard, QrCode,
  Smartphone, Share2, Mail,
} from 'lucide-react';
import { motion } from 'motion/react';

const LandingPage = () => {
  const navigate = useNavigate();
  const [calcInscricoes, setCalcInscricoes] = useState(200);
  const [calcTicket, setCalcTicket] = useState(150);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const calcReceita = calcInscricoes * calcTicket;
  const calcComissao = calcReceita * 0.10;
  const calcLiquido = calcReceita - calcComissao;
  const fmtBRL = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

  useEffect(() => {
    document.title = 'CoreoHub — Gestão inteligente para festivais e mostras de dança';
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // menu mobile: fecha no Escape e trava o scroll do fundo enquanto aberto
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <header className={`fixed top-0 left-0 right-0 z-50 px-6 py-4 transition-all duration-300 ${scrolled ? 'bg-slate-950/80 backdrop-blur-md border-b border-white/10' : ''}`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/coreohub-avatar.webp" alt="CoreoHub" width={32} height={32} className="w-8 h-8" />
            <span className="text-sm font-black uppercase tracking-tight text-white">CoreoHub</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6">
            <Link to="/festivais" className="text-xs font-bold text-slate-300 hover:text-white transition-colors">
              Festivais
            </Link>
            <Link to="/governo" className="text-xs font-bold text-slate-300 hover:text-white transition-colors">
              Setor público
            </Link>
            <a
              href="https://app.coreohub.com/login"
              className="text-xs font-bold text-slate-300 hover:text-white transition-colors"
            >
              Entrar
            </a>
            <button
              onClick={() => navigate('/criar-evento')}
              className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform"
            >
              Criar festival →
            </button>
          </nav>
          {/* mobile: hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="sm:hidden p-2 text-white"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {/* mobile menu */}
        {menuOpen && (
          <div className="sm:hidden bg-slate-950/95 backdrop-blur-md border-t border-white/10 px-6 py-4 space-y-1">
            <Link to="/festivais" onClick={() => setMenuOpen(false)} className="block text-sm font-bold text-slate-300 hover:text-white transition-colors py-3 border-b border-white/5">
              Festivais
            </Link>
            <Link to="/governo" onClick={() => setMenuOpen(false)} className="block text-sm font-bold text-slate-300 hover:text-white transition-colors py-3 border-b border-white/5">
              Setor público
            </Link>
            <a href="https://app.coreohub.com/login" className="block text-sm font-bold text-slate-300 hover:text-white transition-colors py-3 border-b border-white/5">
              Entrar
            </a>
            <div className="pt-3">
              <button
                onClick={() => { navigate('/criar-evento'); setMenuOpen(false); }}
                className="w-full px-4 py-3 bg-[#ff0068] text-white rounded-xl text-sm font-black uppercase tracking-widest"
              >
                Criar festival →
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ─── 1. HERO ──────────────────────────────────────────────── */}
      <section className="relative min-h-[90vh] flex flex-col overflow-hidden bg-black">
        <img
          src="/hero-festival.webp"
          alt=""
          aria-hidden="true"
          width={1920}
          height={1072}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-[50%_35%]"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.20)_40%,transparent_65%)]" />

        {/* conteúdo ancorado no rodapé do hero — mesmo padrão de PageHero (usualdance) */}
        <div className="relative z-10 flex-1 flex flex-col justify-end px-4 pb-10 pt-28 text-center sm:px-6 sm:text-left lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-xl px-5 sm:mx-0 sm:px-0"
          >
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white">Chega de planilha.</p>
            <h1 className="mt-2 sm:mt-3 text-[2.2rem] sm:text-[3.3rem] font-black tracking-normal uppercase leading-[1.06]">
              Plataforma de gestão para festivais e mostras de dança
            </h1>

            <p className="mt-3 sm:mt-4 text-slate-200 text-sm sm:text-base font-medium leading-snug">
              Do regulamento ao palco: inscrições, júri e cronograma numa única
              plataforma — sem surpresa no dia do evento.
            </p>

            <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 sm:justify-start">
              <button
                onClick={() => navigate('/criar-evento')}
                className="group relative px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Criar meu festival grátis <ChevronRight size={18} />
                </span>
              </button>
            </div>

          </motion.div>
        </div>

        {/* barra de stats */}
        <div className="relative z-10 max-w-5xl mx-auto w-full grid grid-cols-3 gap-4 border-t border-white/10 px-6 pt-6 pb-8">
          {[
            { val: '10%', label: 'só quando vende' },
            { val: 'R$ 0', label: 'de mensalidade' },
            { val: '100%', label: 'digital, sem papel' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-2xl md:text-4xl font-black text-white tracking-tighter">{s.val}</p>
              <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 2. PROBLEMA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400 mb-3">Reconhece a rotina?</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-8">
            Você começou pra<br />
            produzir arte.<br />
            <span className="text-rose-400">Virou produtor de planilha.</span>
          </h2>
          <div className="space-y-4 text-slate-300 text-lg leading-relaxed">
            <p>Inscrição chega. Você confere comprovante de Pix manualmente.</p>
            <p>Bailarino manda DM com dúvida que já está no regulamento.</p>
            <p>Resultado fica preso numa planilha que você ainda não terminou.</p>
            <p>Certificado por certificado, à mão.</p>
            <p className="text-white font-bold pt-2">
              Cada hora apagando incêndio é uma hora longe do palco. E é o palco que te trouxe aqui.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 3. AGITAÇÃO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-400 mb-3">E só piora</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-8">
            O festival cresce.<br />
            <span className="text-amber-400">O caos também.</span>
          </h2>
          <div className="space-y-5 text-slate-300 text-lg leading-relaxed">
            <p>
              100 inscrições viram 300. Três ajudantes no Excel viram cinco pessoas sem comunicação.
              A reputação que você construiu em anos pode ir embora numa noite de resultado atrasado ou certificado errado.
            </p>
            <p className="text-white font-bold">
              Quanto maior o festival, maior o risco de você ser lembrado pelo que deu errado —
              não pelo que deu certo no palco.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 4. SOLUÇÃO ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 border-t border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.08),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">A solução</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
              A CoreoHub é o sistema<br />
              <span className="text-[#ff0068]">operacional do seu festival.</span>
            </h2>
            <p className="text-slate-300 text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
              Cole o regulamento, publique o festival e deixe a plataforma trabalhar.
              Cada etapa — da inscrição ao certificado — roda sozinha enquanto você cuida do palco.
            </p>
          </div>

          {/* 3 passos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                num: '01',
                icon: FileText,
                title: 'Faça upload do regulamento',
                body: 'IA extrai categorias, formações, lotes, prêmios e critérios em 30 segundos. Você revisa e publica.',
              },
              {
                num: '02',
                icon: LinkIcon,
                title: 'Seu festival ganha uma página oficial.',
                body: 'Compartilhe o link: inscrições, pagamentos e confirmações no automático.',
              },
              {
                num: '03',
                icon: Trophy,
                title: 'O festival roda. Você finalmente respira.',
                body: 'Júri avalia (até offline), resultado calcula sozinho, certificado sai com QR. Você foca no palco.',
              },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/10 rounded-3xl p-6 hover:border-[#ff0068]/30 transition-all">
                  <p className="text-5xl font-black tracking-tighter text-[#ff0068]/30 mb-4">{step.num}</p>
                  <Icon size={24} className="text-[#ff0068] mb-3" />
                  <h3 className="text-xl font-black uppercase tracking-tight text-white">{step.title}</h3>
                  <p className="text-sm text-slate-400 mt-2 leading-relaxed">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 5. IA CONFIGURA ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Setup em 30 segundos"
        title={<>Cole o PDF do <span className="text-[#ff0068]">regulamento</span>.<br />Seu festival, pronto para publicar.</>}
        body="Nossa IA lê o regulamento (ou edital público de governo) e extrai TUDO: categorias, formações, lotes de preço, prêmios, critérios, tolerâncias. Em 30 segundos você está revisando, não digitando."
        bullets={[
          'Reconhece editais públicos, regulamentos próprios e mostras municipais',
          'Extrai ingressos, workshops, programação e patrocinadores',
          'Separa preâmbulo legal do que importa pra você',
          'Você revisa e publica — sem decifrar PDF de 40 páginas',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3 shadow-2xl">
            <div className="flex items-center gap-2 pb-3 border-b border-white/10">
              <FileText size={14} className="text-[#ff0068]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">regulamento-seu-festival-2026.pdf</span>
            </div>
            {[
              { label: 'Categorias detectadas', value: 'Infantil · Juvenil · Adulto · Profissional' },
              { label: 'Formações + preços', value: 'Solo R$120 · Duo R$180 · Trio R$240 · Grupo R$55/p' },
              { label: 'Lotes', value: '1º Lote · 2º Lote · Último Lote' },
              { label: 'Prêmios especiais', value: '5 prêmios identificados' },
              { label: 'Política meia-entrada', value: 'Estudante / Idoso / Doador de sangue' },
            ].map((row, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Check size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-slate-300">{row.label}</p>
                  <p className="text-[10px] text-slate-500">{row.value}</p>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Pronto pra publicar</span>
              <span className="text-[10px] text-slate-500">28s</span>
            </div>
          </div>
        }
      />

      {/* ─── 6. SELETIVA DE VÍDEO ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Seletiva de Vídeo"
        title={<>Seletiva por <span className="text-[#ff0068]">vídeo</span>.<br />Cronograma só com quem passou.</>}
        body="Bailarino envia o vídeo direto no formulário de inscrição. A banca avalia pelo tablet, antes do festival começar — sem precisar de dia extra de eliminatórias. No dia, o cronograma já vem filtrado só com os classificados: você economiza palco, banca e horário."
        bullets={[
          'Vídeo enviado no cadastro (link YouTube)',
          'Banca avalia remotamente, antes do festival',
          'Notificação automática pro inscrito (passou / não passou)',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/10 bg-slate-950">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Seletiva de Vídeo · 14 pendentes</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">Período aberto</span>
            </div>
            <div className="p-4 space-y-3">
              {[
                { name: 'Arabesque Neoclássico', who: 'Luiza Moraes · Solo · Infantil', color: 'bg-white/5 border-white/10', badge: null },
                { name: 'Carmen Reinventada', who: 'Cia Étoile · Grupo · Juvenil', color: 'bg-emerald-500/10 border-emerald-500/30', badge: { label: 'Aprovado', cls: 'text-emerald-400' } },
                { name: 'Bolero em 7/8', who: 'Pedro & Ana · Duo · Adulto', color: 'bg-rose-500/10 border-rose-500/30', badge: { label: 'Reprovado', cls: 'text-rose-400' } },
              ].map((s, i) => (
                <div key={i} className={`border rounded-xl p-3 ${s.color}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold text-white">{s.name}</p>
                    {s.badge && <span className={`text-[9px] font-black uppercase tracking-wider ${s.badge.cls}`}>{s.badge.label}</span>}
                  </div>
                  <p className="text-[10px] text-slate-500">{s.who}</p>
                  {i === 0 && (
                    <div className="flex gap-2 mt-2">
                      {['Aprovar', 'Cond.', 'Reprovar'].map((btn, j) => (
                        <button key={j} className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                          j === 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          j === 2 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                          'bg-white/5 text-slate-400 border border-white/10'
                        }`}>{btn}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">Notificações enviadas automaticamente</span>
                <span className="text-[10px] font-black text-emerald-400">✓ 8 aprovados</span>
              </div>
            </div>
          </div>
        }
      />

      {/* ─── 6.5. JÚRI DIGITAL ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Júri Digital"
        title={<>Jurado avalia no tablet<br />ou notebook. <span className="text-[#ff0068]">Mesmo sem Wi-Fi.</span></>}
        body="Esqueça a súmula de papel. O júri acessa com PIN de 4 dígitos — sem cadastro. Você acompanha cada nota em tempo real no painel, o Coordenador do Júri revisa antes de publicar, e os resultados ficam disponíveis no fim da apresentação. Sem Wi-Fi? Funciona do mesmo jeito."
        bullets={[
          'Login por PIN de 4 dígitos — sem cadastro, sem senha para lembrar',
          'Notas chegam em tempo real no painel do produtor',
          'Coordenador do Júri valida antes de publicar',
          'Modo Kiosk — tablet vira terminal dedicado sem distração',
        ]}
        mockup={
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10">
            <img
              src="/jurada-tablet-nova.webp"
              alt="Jurada com microfone avaliando no tablet durante apresentação de dança"
              className="w-full h-auto block object-cover object-center"
              loading="lazy"
            />
          </div>
        }
      />

      {/* ─── 7. CRONOGRAMA INTELIGENTE ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Conflito? Antes de acontecer."
        title={<>Bailarina em <span className="text-[#ff0068]">5 coreografias</span>?<br />O sistema calcula o intervalo.</>}
        body="O cronograma identifica quando o mesmo bailarino aparece em apresentações próximas e respeita um intervalo mínimo pra troca de figurino. Se há conflito, ele alerta antes de você publicar. Reordena com 1 toque, sem refazer planilha."
        bullets={[
          'Detecta bailarinos em múltiplas coreografias (solo, duo, grupo)',
          'Calcula intervalo mínimo entre apresentações da mesma pessoa',
          'Aviso visual antes de publicar',
          'Drag-to-reorder respeitando blocos do regulamento',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <CalendarClock size={14} className="text-[#ff0068]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cronograma · Sáb 06 jun</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">1 conflito detectado</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                { hour: '14:32', name: 'Lago dos Cisnes Moderno', who: 'Júlia Marques (solo)', tone: 'ok' },
                { hour: '14:35', name: 'Carmen Reinventada',      who: 'Júlia + Cia Étoile',  tone: 'ok' },
                { hour: '14:38', name: 'Bolero em 7/8',           who: 'Júlia (duo c/ Pedro)', tone: 'warn' },
                { hour: '14:51', name: 'Réquiem',                 who: 'Cia Versus',           tone: 'ok' },
              ].map((p, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-lg p-2.5 border ${
                  p.tone === 'warn'
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-white/5 border-white/10'
                }`}>
                  <span className={`text-[10px] font-mono font-black tabular-nums shrink-0 ${
                    p.tone === 'warn' ? 'text-amber-400' : 'text-slate-400'
                  }`}>{p.hour}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{p.who}</p>
                  </div>
                  {p.tone === 'warn' && (
                    <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                  )}
                </div>
              ))}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2 mt-3">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-black uppercase tracking-tight text-amber-400">Intervalo de 6min</p>
                  <p className="text-[10px] text-slate-300 mt-0.5">Júlia precisa de 12min entre coreografias. Reordenar?</p>
                </div>
              </div>
            </div>
          </div>
        }
      />

      {/* ─── 8. CREDENCIAIS FÍSICAS ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Credenciais físicas em PDF"
        title={<>Imprime no <span className="text-[#ff0068]">offset</span> da esquina.<br />Cola na credencial.</>}
        body="Selecione os inscritos, escolha o modo de impressão (A6 com cordão ou adesivo Pimaco 6280) e o sistema gera o PDF pronto pra gráfica. Foto, nome, função e QR de check-in — tudo organizado nas margens exatas do papel."
        bullets={[
          'Modo A6 cordão: 4 credenciais por folha A4 em papel cartão 250g',
          'Modo Pimaco 6280: adesivos prontos pra colar em credencial pré-impressa',
          'Tipos suportados: inscrito, workshop, equipe e jurados',
          'Cor automática por tipo (rosa, azul, dourado, roxo)',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-slate-950">
              <IdCard size={14} className="text-[#ff0068]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pré-visualização · 7 adesivos · Pimaco 6280</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {[
                { name: 'Luiza Moraes',  studio: 'Cia Arte em Movimento', cat: 'Infantil · Solo',  type: 'Inscrita', color: 'border-[#ff0068]/40 bg-[#ff0068]/5',   badge: 'text-[#ff0068] bg-[#ff0068]/10' },
                { name: 'Pedro Alves',   studio: 'Núcleo Dança Livre',    cat: 'Adulto · Duo',    type: 'Inscrito', color: 'border-[#ff0068]/40 bg-[#ff0068]/5',   badge: 'text-[#ff0068] bg-[#ff0068]/10' },
                { name: 'Ana Beatriz',   studio: 'Oficina de Movimento',  cat: 'Workshop',         type: 'Workshop', color: 'border-blue-400/40 bg-blue-500/5',     badge: 'text-blue-400 bg-blue-500/10' },
                { name: 'Carlos Lima',   studio: 'Coordenação Geral',     cat: 'Equipe',           type: 'Equipe',   color: 'border-yellow-400/40 bg-yellow-500/5', badge: 'text-yellow-400 bg-yellow-500/10' },
              ].map((c, i) => (
                <div key={i} className={`border rounded-xl p-3 flex flex-col gap-2 ${c.color}`}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-white leading-tight truncate">{c.name}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5 truncate">{c.studio}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5">{c.cat}</p>
                    </div>
                    <div className="w-8 h-8 flex-shrink-0 grid grid-cols-3 gap-px bg-white/5 rounded p-1">
                      {[1,0,1,0,1,0,1,0,1].map((v, j) => (
                        <div key={j} className={`rounded-[1px] ${v ? 'bg-white/60' : 'bg-white/15'}`} />
                      ))}
                    </div>
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-widest self-start px-1.5 py-0.5 rounded ${c.badge}`}>{c.type}</span>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Modo Pimaco 6280 · A4</span>
              <span className="text-[10px] font-black text-emerald-400">Pronto pra gráfica</span>
            </div>
          </div>
        }
      />

      {/* ─── 9. NARRAÇÃO IA ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Narração profissional por IA"
        title={<>Voz <span className="text-[#ff0068]">profissional</span> anuncia<br />cada coreografia.</>}
        body="A IA gera a narração de abertura, transição e encerramento com voz natural em português. Geração em lote antes do evento, fallback automático se a internet cair. Não fique mais refém de locutor cobrando caro."
        bullets={[
          'Voz natural em português, ritmo de locutor profissional',
          'Lê nome do bailarino, coreografia, categoria e estúdio',
          'Geração em lote antes do festival — pronto pra rodar offline',
          'Customize abertura, transições e encerramento separadamente',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Mic2 size={14} className="text-[#ff0068]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Narração · Bloco 03</span>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">12 / 38 geradas</span>
            </div>
            <div className="p-4 space-y-3">
              {[
                { tag: 'Abertura', text: 'A próxima coreografia... Lago dos Cisnes Moderno.', dur: '0:14' },
                { tag: 'Transição', text: 'Aplausos pra Cia Étoile. Em seguida...', dur: '0:08' },
                { tag: 'Encerramento', text: 'Encerramos o bloco infantil. Voltamos em 15 minutos.', dur: '0:11' },
              ].map((n, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">{n.tag}</span>
                    <span className="text-[10px] text-slate-500 font-mono tabular-nums">{n.dur}</span>
                  </div>
                  <p className="text-xs text-slate-300 italic mb-2 leading-relaxed">"{n.text}"</p>
                  <div className="flex items-center gap-0.5 h-6">
                    {Array.from({ length: 32 }).map((_, j) => {
                      const h = ((j * 7 + i * 11) % 100) / 100;
                      return (
                        <div
                          key={j}
                          className="flex-1 bg-[#ff0068]/40 rounded-full"
                          style={{ height: `${20 + h * 80}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4 border-t border-white/10 pt-3 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Voz: pt-BR · masculina</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Cache offline ativo</span>
            </div>
          </div>
        }
      />

      {/* ─── 10. PROVA SOCIAL ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Depoimentos</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Quem já usou,<br />
              <span className="text-[#ff0068]">aprova.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
              <p className="text-slate-300 text-sm leading-relaxed flex-1">"Uma das plataformas de gestão de eventos mais completas que já utilizei. Além da praticidade, ela entrega praticamente TUDO em um formato prático e didático. Tive a honra de conhecer e utilizar na produção do Usualdance Festival, e com certeza daqui pra frente estará no Extreme Festival."</p>
              <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                <img src="/will-nunes.webp" alt="Will Nunes" className="w-10 h-10 rounded-full object-cover object-top shrink-0" />
                <div>
                  <p className="text-white text-sm font-black">Will Nunes</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Produtor do Extreme Festival</p>
                </div>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
              <p className="text-slate-300 text-sm leading-relaxed flex-1">"Avaliar pela CoreoHub foi extremamente positivo — processo organizado, prático e eficiente. O sistema agiliza o trabalho do júri sem comprometer a qualidade técnica, entregando uma avaliação transparente e padronizada. Uma solução moderna que eleva o nível do festival. Nota 1000."</p>
              <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                <img src="/jonathan-lupe.webp" alt="Jonathan Lupe" className="w-10 h-10 rounded-full object-cover object-center shrink-0" />
                <div>
                  <p className="text-white text-sm font-black">Jonathan Lupe</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Jurado · Usualdance Festival</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 11. PREÇO / CALCULADORA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Modelo transparente</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Você só paga <span className="text-[#ff0068]">quando vende</span>.<br />
            E o dinheiro cai direto na sua conta.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed mb-12">
            10% por inscrição vendida. Zero mensalidade. Zero fidelidade.
            Se o evento não rolar, você não paga nada. O dinheiro cai direto na sua conta via Asaas
            — regulamentado pelo Banco Central — sem esperar repasse mensal.
          </p>

          <div className="max-w-3xl mx-auto bg-gradient-to-br from-[#ff0068]/10 via-white/5 to-purple-700/10 border border-white/10 rounded-3xl p-6 md:p-10 backdrop-blur-xl">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">Simule seu festival</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
              <div className="text-left">
                <label htmlFor="calc-inscricoes" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Inscrições no festival: <span className="text-[#ff0068] font-mono">{calcInscricoes}</span>
                </label>
                <input
                  id="calc-inscricoes"
                  type="range" min={20} max={1000} step={10}
                  value={calcInscricoes}
                  onChange={(e) => setCalcInscricoes(Number(e.target.value))}
                  aria-label="Número de inscrições no festival"
                  aria-valuetext={`${calcInscricoes} inscrições`}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>20</span><span>1000</span>
                </div>
              </div>
              <div className="text-left">
                <label htmlFor="calc-ticket" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Ticket médio: <span className="text-[#ff0068] font-mono">{fmtBRL(calcTicket)}</span>
                </label>
                <input
                  id="calc-ticket"
                  type="range" min={50} max={500} step={10}
                  value={calcTicket}
                  onChange={(e) => setCalcTicket(Number(e.target.value))}
                  aria-label="Ticket médio por inscrição"
                  aria-valuetext={fmtBRL(calcTicket)}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>R$ 50</span><span>R$ 500</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Receita bruta</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-white mt-1">{fmtBRL(calcReceita)}</p>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-rose-400">Comissão (10%)</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-rose-400 mt-1">{fmtBRL(calcComissao)}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Você fica com</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-emerald-400 mt-1">{fmtBRL(calcLiquido)}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-6">
              No modelo tradicional: você paga <span className="text-rose-400 font-bold">R$ 290 a R$ 990/mês</span> de
              mensalidade pra outras plataformas, mesmo quando o evento não rolou.
              Aqui é zero — só paga quando inscrição entra.
            </p>
          </div>

          <div className="max-w-3xl mx-auto mt-8 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-left">
              <p className="text-white font-bold text-sm">Prefeitura ou instituição?</p>
              <p className="text-slate-400 text-sm mt-1">Secretarias de cultura e editais públicos têm modelo de proposta próprio.</p>
            </div>
            <a
              href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20Sou%20de%20uma%20institui%C3%A7%C3%A3o%20p%C3%BAblica%20e%20gostaria%20de%20falar%20sobre%20a%20CoreoHub"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-colors shrink-0"
            >
              Falar no WhatsApp <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* ─── 12. COMPARATIVO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Por que a CoreoHub</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              O que ninguém mais faz.
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-4 pr-4 text-[10px] font-black uppercase tracking-widest text-slate-500"></th>
                  <th className="py-4 px-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-sm font-black uppercase tracking-tight text-[#ff0068]">CoreoHub</span>
                      <span className="text-[9px] text-slate-500">10% só quando vende</span>
                    </div>
                  </th>
                  <th className="py-4 px-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-xs font-bold text-slate-400">Sistemas dedicados</span>
                      <span className="text-[9px] text-slate-500">Mensalidade fixa*</span>
                    </div>
                  </th>
                  <th className="py-4 px-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-xs font-bold text-slate-400">Marketplace genérico</span>
                      <span className="text-[9px] text-slate-500">7-12% + taxa fixa</span>
                    </div>
                  </th>
                  <th className="py-4 px-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-xs font-bold text-slate-400">Planilha + Pix</span>
                      <span className="text-[9px] text-slate-500">Seu tempo: ~3h/dia</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  { f: 'Preço', type: 'text' as const, c: '10% só quando vende', d: 'Mensalidade fixa*', m: '7-12% + taxa fixa', p: 'Seu tempo: ~3h/dia' },
                  { f: 'Configura o evento a partir do seu regulamento', type: 'text' as const, c: 'Automático — cole o PDF, a IA extrai tudo', d: 'Manual, categoria por categoria', m: false, p: false },
                  { f: 'Júri avalia mesmo com Wi-Fi caindo',              type: 'bool' as const, c: true, d: false, m: false, p: false },
                  { f: 'Detecta conflito de bailarino em várias coreografias', type: 'bool' as const, c: true, d: false, m: false, p: false },
                  { f: 'Certificado com QR de validação pública',         type: 'bool' as const, c: true, d: false, m: false, p: false },
                  { f: 'Sem mensalidade, mesmo se o evento não rolar',    type: 'bool' as const, c: true, d: false, m: true,  p: true  },
                ].map((row, i) => {
                  const renderCell = (val: string | boolean, colorClass: string) => {
                    if (typeof val === 'string') return <span className={`text-xs font-bold ${colorClass}`}>{val}</span>;
                    return val
                      ? <Check size={16} className={`inline ${colorClass}`} />
                      : <X size={16} className="inline text-rose-500/60" />;
                  };
                  return (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-3 pr-4 text-slate-300">{row.f}</td>
                      <td className="py-3 px-3 text-center">{renderCell(row.c, 'text-emerald-400')}</td>
                      <td className="py-3 px-3 text-center">{renderCell(row.d, 'text-slate-400')}</td>
                      <td className="py-3 px-3 text-center">{renderCell(row.m, 'text-slate-400')}</td>
                      <td className="py-3 px-3 text-center">{renderCell(row.p, 'text-slate-400')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-slate-500 text-center mt-6 italic">
            *Valores de mensalidade variam por fornecedor — consulte os próprios sites para comparação atualizada.<br />
            Sistemas dedicados = especialistas em festivais (mensalidade). Marketplace genérico = plataformas de eventos não-especializadas. Planilha + Pix = o jeito artesanal.
          </p>
        </div>
      </section>

      {/* ─── 13. FAQ ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Dúvidas frequentes</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Tudo o que você quer<br />perguntar.
            </h2>
          </div>
          <div className="space-y-2">
            {[
              {
                q: 'Como recebo o dinheiro das inscrições?',
                a: 'Direto na sua conta bancária via Asaas (regulamentado pelo Banco Central). Cada inscrição paga gera split na hora — 90% pra você, 10% comissão CoreoHub. Sem boleto perdido, sem espera de 30 dias, sem repasse mensal.',
              },
              {
                q: 'Funciona mesmo offline?',
                a: 'Sim. Avaliação de jurados, cronograma, check-in por QR e narração funcionam mesmo sem internet no local — o app sincroniza automaticamente quando a conexão volta. Você só precisa de internet pra publicar o evento e receber pagamentos.',
              },
              {
                q: 'E se eu quiser sair? Tem fidelidade?',
                a: 'Não. Não existe contrato de permanência nem multa de cancelamento — você usa enquanto fizer sentido pro seu festival. Se decidir sair, seu histórico de eventos, inscrições e certificados continua acessível e exportável, sem prazo de expiração.',
              },
              {
                q: 'Tem suporte técnico?',
                a: 'Sim, direto por WhatsApp com nossa equipe — sem ticket, sem fila de atendimento genérico. Na semana do seu festival, o suporte é prioritário: se algo travar no dia, você fala com a gente na hora, não espera resposta de central.',
              },
              {
                q: 'Quantos festivais por mês posso criar?',
                a: 'Quantos quiser. Não há limite de festivais, edições ou mostras — você paga só a comissão de cada inscrição vendida, então pode rodar um evento por mês ou dez, sem custo fixo te travando.',
              },
              {
                q: 'Funciona pra evento gratuito ou edital público?',
                a: 'Sim — temos modelo específico para eventos gratuitos, mostras municipais e editais públicos. Como cada caso tem particularidades (tipo de evento, instituição, verba), fale com a gente pelo WhatsApp e montamos a proposta certa pro seu caso.',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-panel-${i}`}
                  id={`faq-trigger-${i}`}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <span className="text-base font-black uppercase tracking-tight text-white">{item.q}</span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div
                    id={`faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`faq-trigger-${i}`}
                    className="px-5 pb-5 -mt-1 text-sm text-slate-300 leading-relaxed"
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 14. CTA FINAL ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.18),transparent_70%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
            Chega de apagar incêndio<br />
            <span className="text-[#ff0068]">antes de cada festival.</span>
          </h2>
          <p className="text-slate-300 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed mb-10">
            Crie seu festival agora. Compartilhe o link hoje à noite. Receba a primeira inscrição amanhã.
          </p>
          <button
            onClick={() => navigate('/criar-evento')}
            className="inline-flex items-center gap-2 px-10 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
          >
            Criar meu festival grátis <ArrowRight size={18} />
          </button>
          <p className="text-xs text-slate-500 mt-5">
            Sem cartão de crédito · Você só paga quando vende · Cancela quando quiser
          </p>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="px-6 py-16 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <img src="/coreohub-avatar.webp" alt="CoreoHub" width={40} height={40} className="w-10 h-10" />
                <div>
                  <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                  <p className="text-[10px] text-slate-500">Gestão Inteligente para Festivais e Mostras de Dança</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Sistema operacional pra festivais e mostras de dança. Inscrições, jurados, palco,
                ingressos e certificados num único link.
              </p>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">Produto</p>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li><a href="https://app.coreohub.com/festivais" className="hover:text-[#ff0068]">Festivais ativos</a></li>
                <li><a href="https://app.coreohub.com/criar-evento" className="hover:text-[#ff0068]">Criar meu festival</a></li>
                <li><a href="https://app.coreohub.com/login" className="hover:text-[#ff0068]">Entrar</a></li>
                <li><Link to="/governo" className="hover:text-[#ff0068]">Para o setor público</Link></li>
              </ul>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">Contato</p>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li><a href="mailto:contato@coreohub.com" className="hover:text-[#ff0068]">contato@coreohub.com</a></li>
                <li>
                  <a href="https://wa.me/5517997936169" target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068]">
                    +55 17 99793-6169
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="text-[10px] text-slate-500 leading-relaxed">
              <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub Tecnologia LTDA</p>
              <p>Votuporanga/SP</p>
              <p className="mt-1">Pagamentos processados pela Asaas IP S.A. (CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
              <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
              <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.</p>
            </div>
          </div>
        </div>
      </footer>

      {/* ─── BOTÃO FLUTUANTE WHATSAPP ──────────────────────────────────────────────── */}
      <a
        href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20Coreohub"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center shadow-[0_8px_24px_rgba(37,211,102,0.45)] hover:scale-105 active:scale-95 transition-transform"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-[#052e16]" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.768.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
        </svg>
      </a>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────
   Bloco reusável: feature com título, body, bullets e mockup
   ──────────────────────────────────────────────────────────────────── */
interface FeatureSectionProps {
  kicker: string;
  title: React.ReactNode;
  body: string;
  bullets: string[];
  mockup: React.ReactNode;
  reverse?: boolean;
}
const FeatureSection: React.FC<FeatureSectionProps> = ({ kicker, title, body, bullets, mockup, reverse }) => (
  <section className="px-6 py-24 lg:py-32 border-t border-white/5">
    <div className={`max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">{kicker}</p>
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
          {title}
        </h2>
        <p className="text-slate-300 text-lg leading-relaxed mb-6">{body}</p>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-slate-300">
              <Check size={16} className="text-[#ff0068] shrink-0 mt-1" />
              <span className="text-sm leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>{mockup}</div>
    </div>
  </section>
);

export default LandingPage;
