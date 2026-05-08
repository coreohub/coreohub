import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight, Sparkles, FileText, Wifi, Link as LinkIcon, DollarSign,
  Trophy, Shield, Award, GraduationCap, Mic2, Check, X, ChevronDown,
  Zap, Users, Clock, AlertTriangle, ArrowRight,
  CalendarClock, Globe, IdCard, QrCode,
  Smartphone, Share2, Mail, MapPin, Search,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../services/supabase';

const PINK = '#ff0068';

interface FestivalAtivo {
  id: string;
  slug: string | null;
  name: string;
  cover_url: string | null;
  start_date: string | null;
  city: string | null;
  state: string | null;
}

const LandingPage = () => {
  const navigate = useNavigate();
  const [calcInscricoes, setCalcInscricoes] = useState(200);
  const [calcTicket, setCalcTicket] = useState(150);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [festivaisAtivos, setFestivaisAtivos] = useState<FestivalAtivo[]>([]);

  useEffect(() => {
    const fetchAtivos = async () => {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const { data, error } = await supabase
          .from('events')
          .select('id, slug, name, cover_url, start_date, city, state, is_demo')
          .eq('is_public', true)
          .eq('is_demo', false)
          .gte('start_date', today)
          .order('start_date', { ascending: true })
          .limit(8);
        if (error) throw error;
        setFestivaisAtivos((data ?? []) as FestivalAtivo[]);
      } catch (err) {
        console.error('[LP] erro ao buscar festivais ativos:', err);
      }
    };
    fetchAtivos();
  }, []);

  const calcReceita = calcInscricoes * calcTicket;
  const calcComissao = calcReceita * 0.10;
  const calcLiquido = calcReceita - calcComissao;
  const fmtBRL = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

  const fmtFestivalDate = (d?: string | null) => {
    if (!d) return 'Em breve';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">

      {/* ─── 1. HERO ──────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col px-6 pt-24 pb-12 overflow-hidden">
        {/* Foto de fundo — palco em ação */}
        <img
          src="/hero-festival.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-40"
        />
        {/* Overlay escuro pra garantir contraste com a tipografia */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/75 to-slate-950" />
        {/* Glow rosa da marca (preserva identidade) */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,0,104,0.22),transparent_60%)]" />
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-[#ff0068]/10 blur-[140px] rounded-full" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-purple-700/10 blur-[140px] rounded-full" />

        {/* Conteúdo central */}
        <div className="relative z-10 flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl text-center space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-xl">
              <Sparkles size={12} className="text-[#ff0068]" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">
                Para festivais e mostras de dança
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tighter uppercase leading-[0.95]">
              A primeira <span className="text-[#ff0068]">IA</span> que monta<br />
              seu festival de dança<br />
              em <span className="text-[#ff0068]">30 segundos.</span>
            </h1>

            <p className="text-slate-300 text-lg md:text-2xl font-medium max-w-3xl mx-auto leading-relaxed">
              Cole o regulamento. Inscrições, banca, palco, ingressos e certificados num link só.
              <br className="hidden md:block" />
              <span className="text-slate-400">Você produz arte. CoreoHub cuida do resto.</span>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
              <button
                onClick={() => navigate('/criar-evento')}
                className="group relative px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Criar meu festival grátis <ChevronRight size={18} />
                </span>
              </button>
              <a
                href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20Gostaria%20de%20Falar%20sobre%20a%20CoreoHub"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-2"
              >
                Falar no WhatsApp →
              </a>
            </div>

            <p className="text-xs text-slate-500">
              Sem mensalidade · Sem planilha · Sem locutor · Você só paga quando vende
            </p>
          </motion.div>
        </div>

        {/* Stats no rodapé do hero — flexbox normal, sem absolute */}
        <div className="relative z-10 max-w-5xl mx-auto w-full grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/5 pt-8 mt-12">
          {[
            { val: '10%', label: 'Comissão única' },
            { val: '0', label: 'Mensalidade' },
            { val: '30s', label: 'Pra publicar evento' },
            { val: '24/7', label: 'Funciona offline' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-2xl md:text-4xl font-black text-white tracking-tighter">{s.val}</p>
              <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 2. DOR ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400 mb-3">
              Reconhece a rotina?
            </p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Você queria produzir arte.<br />
              <span className="text-rose-400">Hoje produz planilha.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Inscrição cobrada no Pix manual', body: 'Bailarino paga, manda print, você confere planilha, esquece de aprovar. 3 horas por dia checando comprovantes.' },
              { title: 'Regulamento que ninguém lê', body: 'Você escreve, ninguém abre, todo mundo manda DM perguntando o mesmo. Suporte virou seu trabalho de tempo integral.' },
              { title: 'Resultado sai 3 dias depois', body: 'Você ainda calculando médias na planilha enquanto bailarinos enchem seu DM. Reputação queimando junto.' },
              { title: 'Certificado feito no Photoshop', body: 'Você fica até 2h da manhã substituindo nome em template. Pra um festival de 200 bailarinos. Todo ano.' },
            ].map((p, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-rose-500/30 transition-colors">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-base font-black uppercase tracking-tight text-white">{p.title}</h3>
                    <p className="text-sm text-slate-400 mt-2 leading-relaxed">{p.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-slate-400 text-lg mt-12 max-w-2xl mx-auto">
            Cada hora apagando incêndio é uma hora <span className="text-white font-bold">longe do palco</span>.
            E o palco é por que você começou tudo isso.
          </p>
        </div>
      </section>

      {/* ─── 3. SOLUÇÃO ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 border-t border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.08),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">A solução</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Do regulamento ao certificado<br />
            <span className="text-[#ff0068]">numa plataforma só.</span>
          </h2>
          <p className="text-slate-300 text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
            A CoreoHub é o sistema operacional do seu festival.{' '}
            <span className="text-white font-bold">A IA configura o evento em 30 segundos.</span>{' '}
            Bailarino se inscreve, paga e baixa certificado num único link.
            Você vê tudo em tempo real, no celular ou no computador.
          </p>

          {/* Fluxo visual */}
          <div className="mt-16 grid grid-cols-5 gap-2 md:gap-3">
            {[
              { icon: FileText, label: 'PDF do regulamento' },
              { icon: Sparkles, label: 'IA configura' },
              { icon: LinkIcon, label: 'Link público' },
              { icon: Wifi, label: 'Festival roda' },
              { icon: Award, label: 'Resultado + certificado' },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-[#ff0068]/10 border border-[#ff0068]/30 flex items-center justify-center">
                    <Icon size={18} className="text-[#ff0068] md:hidden" />
                    <Icon size={22} className="text-[#ff0068] hidden md:block" />
                  </div>
                  <p className="text-[8px] md:text-[10px] font-black uppercase tracking-widest text-slate-300 text-center leading-tight">{step.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 4. IA configura ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Setup em 30 segundos"
        title={<>Cole o PDF do <span className="text-[#ff0068]">regulamento</span>.<br />Festival pronto pra publicar.</>}
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
              { label: 'Categorias detectadas', value: 'Infantil · Juvenil · Adulto · Profissional', color: 'emerald' },
              { label: 'Formações + preços', value: 'Solo R$120 · Duo R$180 · Trio R$240 · Grupo R$55/p', color: 'emerald' },
              { label: 'Lotes', value: '1º Lote · 2º Lote · Último Lote', color: 'emerald' },
              { label: 'Prêmios especiais', value: '5 prêmios identificados', color: 'emerald' },
              { label: 'Política meia-entrada', value: 'Estudante / Idoso / Doador de sangue', color: 'emerald' },
            ].map((row, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-xs">
                <div className="flex items-start gap-2 min-w-0">
                  <Check size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-300">{row.label}</p>
                    <p className="text-[10px] text-slate-500 truncate">{row.value}</p>
                  </div>
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

      {/* ─── 5.4 SELETIVA DE VÍDEO ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Seletiva de Vídeo"
        title={<>Seletiva por <span className="text-[#ff0068]">vídeo</span>.<br />Cronograma só com quem passou.</>}
        body="Bailarino envia o vídeo direto no formulário de inscrição. A banca avalia pelo tablet, antes do festival começar — sem precisar de dia extra de eliminatórias. No dia, o cronograma já vem filtrado só com os classificados: você economiza palco, banca e horário."
        bullets={[
          'Vídeo enviado no cadastro (link YouTube ou upload direto)',
          'Banca avalia pelo tablet, na semana antes do festival',
          'Cronograma do dia já vem filtrado com os classificados',
          'Notificação automática pro inscrito (passou / não passou)',
        ]}
        mockup={
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900">
            <img
              src="/screenshots/seletiva-revisar.png"
              alt="Tela de revisão de vídeo da seletiva no CoreoHub: player, dados do inscrito e botões de decisão (Aprovar, Condicional, Favoritar, Reprovar)"
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        }
      />

      {/* ─── 5.5 EM CAMPO (foto produto-em-uso) ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/5">
        {/* Wrapper full-bleed com imagem cinematográfica */}
        <div className="relative w-full h-[70vh] md:h-[85vh] min-h-[500px] max-h-[800px]">
          <img
            src="https://i.imgur.com/hGkjZ6J.jpg"
            alt="Jurada avaliando uma apresentação ao vivo num festival CoreoHub: tablet em mãos exibindo o terminal, microfone para feedback de áudio, palco iluminado ao fundo"
            className="absolute inset-0 w-full h-full object-cover object-[70%_center] md:object-center"
            loading="lazy"
          />

          {/* Gradient overlay pra legibilidade do texto */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 via-transparent to-transparent" />

          {/* Badge AO VIVO no canto superior esquerdo */}
          <div className="absolute top-6 left-6 md:top-10 md:left-10">
            <div className="inline-flex items-center gap-2 px-3 py-2 bg-rose-500/20 border border-rose-500/40 backdrop-blur-md rounded-full">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white">
                Ao vivo · 3 jurados conectados
              </span>
            </div>
          </div>

          {/* Headline no rodapé da imagem */}
          <div className="absolute inset-x-0 bottom-0 px-6 pb-12 md:pb-20">
            <div className="max-w-5xl mx-auto">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">
                Em campo
              </p>
              <h2 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tighter uppercase leading-[0.95] max-w-3xl">
                Banca avalia no tablet<br />
                em <span className="text-[#ff0068]">tempo real.</span>
              </h2>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 5.6 Galeria "Quem usa" — 2 fotos lado a lado ──────────────────────────────────────────────── */}
      <section className="px-6 py-16 lg:py-24 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Quem está por trás</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Produtores brasileiros<br />
              <span className="text-[#ff0068]">deixaram a planilha pra trás.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <figure className="relative rounded-2xl overflow-hidden aspect-[4/3] bg-slate-900">
              <img
                src="https://i.imgur.com/oE8vBcp.jpg"
                alt="Produtor acompanhando festival ao vivo pelo tablet"
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
              <figcaption className="absolute bottom-0 left-0 right-0 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-1">Direção</p>
                <p className="text-white text-sm font-bold">Dashboard ao vivo na palma da mão — sem voltar pra trás-cena pra checar planilha.</p>
              </figcaption>
            </figure>
            <figure className="relative rounded-2xl overflow-hidden aspect-[4/3] bg-slate-900">
              <img
                src="https://i.imgur.com/pywXpKV.jpg"
                alt="Equipe de produção coordenando bastidores"
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
              <figcaption className="absolute bottom-0 left-0 right-0 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-1">Bastidores</p>
                <p className="text-white text-sm font-bold">Coordenadora e marcador trocando ideia em segundos — porque o app já avisou tudo.</p>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ─── 6. Vitrine vende sozinha ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Um link, mil ações"
        title={<>Compartilhe <span className="text-[#ff0068]">1 link</span>.<br />Sistema faz o resto.</>}
        body="Bailarino clica no Instagram, encontra a página completa do festival: regulamento, jurados, preços, programação. Inscreve, paga (cartão, Pix, boleto), recebe ingresso, baixa certificado, vê resultado — sem você apertar 1 botão."
        bullets={[
          'Vitrine pública linda em /festival/<seu-evento> (também serve de site oficial)',
          'Lotes progressivos (early-bird, último lote) com data ou esgotamento',
          'Cupons com escopo: só inscrição, só ingresso, ou ambos',
          'Workshops + ingresso de plateia no mesmo carrinho',
          'Reembolso em 1 clique — sem chamado, sem planilha',
          'Certificado com QR code de validação pública',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-slate-950 px-4 py-2 border-b border-white/10 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
              </div>
              <div className="flex-1 mx-3 px-3 py-1 bg-white/5 rounded text-[10px] text-slate-500 font-mono truncate">
                app.coreohub.com/festival/coreohub-open
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068]">Festival nacional</p>
                <p className="text-2xl font-black uppercase tracking-tighter text-white mt-1 leading-none">CoreoHub Open 2026</p>
                <p className="text-[10px] text-slate-400 mt-2">Sáb 06 jun · São Paulo / SP</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Solo', val: 'R$ 120' },
                  { label: 'Duo', val: 'R$ 180' },
                  { label: 'Trio', val: 'R$ 240' },
                  { label: 'Grupo', val: 'R$ 55/p' },
                ].map((r, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">{r.label}</span>
                    <span className="text-sm font-black text-[#ff0068]">{r.val}</span>
                  </div>
                ))}
              </div>
              <button className="w-full bg-[#ff0068] text-white text-xs font-black uppercase tracking-widest py-3 rounded-xl">
                Inscrever minha coreografia
              </button>
            </div>
          </div>
        }
      />

      {/* ─── 6.5 CRONOGRAMA INTELIGENTE ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Conflito? Antes de acontecer."
        title={<>Bailarina em <span className="text-[#ff0068]">5 coreografias</span>?<br />Sistema calcula o intervalo.</>}
        body="O cronograma identifica quando o mesmo bailarino aparece em apresentações próximas e respeita um intervalo mínimo pra troca de figurino. Se há conflito, ele alerta antes de você publicar — não na frente do público. Reordena com 1 toque, sem refazer planilha."
        bullets={[
          'Detecta bailarinos em múltiplas coreografias (solo, duo, grupo)',
          'Calcula intervalo mínimo entre apresentações da mesma pessoa',
          'Aviso visual antes de publicar — não no dia, no meio do festival',
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

      {/* ─── 7. PRICING / CALCULADORA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Modelo transparente</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Você só paga <span className="text-[#ff0068]">quando vende</span>.<br />
            E o dinheiro cai direto na sua conta.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed mb-12">
            10% de comissão por inscrição vendida. Zero mensalidade. Zero fidelidade.
            Asaas (regulamentado pelo Banco Central) faz o split na hora — você recebe líquido, sem boleto perdido.
          </p>

          {/* Calculadora interativa */}
          <div className="max-w-3xl mx-auto bg-gradient-to-br from-[#ff0068]/10 via-white/5 to-purple-700/10 border border-white/10 rounded-3xl p-6 md:p-10 backdrop-blur-xl">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">Simule seu festival</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
              <div className="text-left">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Inscrições no festival: <span className="text-[#ff0068] font-mono">{calcInscricoes}</span>
                </label>
                <input
                  type="range" min={20} max={1000} step={10}
                  value={calcInscricoes}
                  onChange={(e) => setCalcInscricoes(Number(e.target.value))}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>20</span><span>1000</span>
                </div>
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Ticket médio: <span className="text-[#ff0068] font-mono">{fmtBRL(calcTicket)}</span>
                </label>
                <input
                  type="range" min={50} max={500} step={10}
                  value={calcTicket}
                  onChange={(e) => setCalcTicket(Number(e.target.value))}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>R$ 50</span><span>R$ 500</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-left">
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
        </div>
      </section>

      {/* ─── 8. COMPARATIVO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Por que CoreoHub</p>
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
                      <span className="text-[9px] text-slate-500">10% por venda</span>
                    </div>
                  </th>
                  <th className="py-4 px-3 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-xs font-bold text-slate-400">Sistemas dedicados</span>
                      <span className="text-[9px] text-slate-500">R$ 290 a R$ 990/mês</span>
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
                      <span className="text-[9px] text-slate-500">Você é o sistema</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  { f: 'IA configura festival pelo PDF',           c: true,  d: false, m: false, p: false },
                  { f: 'Júri avaliando offline (Wi-Fi caiu)',       c: true,  d: false, m: false, p: false },
                  { f: 'Seletiva de vídeo integrada',              c: true,  d: false, m: false, p: false },
                  { f: 'Cronograma com detecção de conflitos',     c: true,  d: false, m: false, p: false },
                  { f: 'Júri multi-idioma (PT/EN/ES)',             c: true,  d: false, m: false, p: false },
                  { f: 'Áudio de feedback do jurado',              c: true,  d: false, m: false, p: false },
                  { f: 'Narração IA com voz profissional',         c: true,  d: false, m: false, p: false },
                  { f: 'Workshops + ingressos no mesmo carrinho',  c: true,  d: false, m: true,  p: false },
                  { f: 'Certificado com QR de validação',          c: true,  d: true,  m: false, p: false },
                  { f: 'Vitrine pública pronta como site',         c: true,  d: true,  m: true,  p: false },
                  { f: 'Equipe com permissões granulares',         c: true,  d: true,  m: false, p: false },
                  { f: 'Sem mensalidade',                          c: true,  d: false, m: true,  p: true  },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-3 pr-4 text-slate-300">{row.f}</td>
                    <td className="py-3 px-3 text-center">{row.c ? <Check size={16} className="inline text-emerald-400" /> : <X size={16} className="inline text-rose-500" />}</td>
                    <td className="py-3 px-3 text-center">{row.d ? <Check size={16} className="inline text-slate-400" />  : <X size={16} className="inline text-rose-500/60" />}</td>
                    <td className="py-3 px-3 text-center">{row.m ? <Check size={16} className="inline text-slate-400" />  : <X size={16} className="inline text-rose-500/60" />}</td>
                    <td className="py-3 px-3 text-center">{row.p ? <Check size={16} className="inline text-slate-400" />  : <X size={16} className="inline text-rose-500/60" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[9px] text-slate-500 text-center mt-6 italic">
            Comparação por categoria. Sistemas dedicados = especialistas em festivais (mensalidade). Marketplace genérico = plataformas de eventos não-especializadas. Planilha + Pix = o jeito artesanal.
          </p>
        </div>
      </section>

      {/* ─── 9. 3 PASSOS ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Como funciona</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Do PDF ao palco<br />
              em <span className="text-[#ff0068]">3 passos</span>.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                num: '01',
                icon: FileText,
                title: 'Cole o regulamento',
                body: 'IA lê o PDF e configura categorias, formações, lotes, prêmios e critérios. Você revisa e publica.',
              },
              {
                num: '02',
                icon: LinkIcon,
                title: 'Compartilhe o link',
                body: 'Bailarinos se inscrevem, pagam e recebem confirmação. Você acompanha em tempo real, no celular.',
              },
              {
                num: '03',
                icon: Trophy,
                title: 'Festival roda',
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

      {/* ─── 9.5 DIA DO EVENTO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Dia do evento</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Operação física,<br />
              <span className="text-[#ff0068]">sem operador.</span>
            </h2>
            <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed mt-6">
              Credenciais impressas, check-in na entrada, palco rolando e voz anunciando.
              Tudo o que antes precisava de 4 pessoas no Excel, hoje sai sozinho.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                icon: QrCode,
                title: 'Check-in QR pra 5 perfis',
                body: 'Inscrito, ingresso de plateia, workshop, equipe e jurado — tudo num único leitor. Aponta a câmera, sistema reconhece o tipo e libera o que precisa.',
              },
              {
                icon: Clock,
                title: 'Marcação de palco com cronômetro',
                body: 'Cronômetro respeita o tempo do regulamento. Marcador clica "Pronto" e cronograma anda sozinho. Atraso fica visível pra todo mundo na hora.',
              },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/10 rounded-3xl p-6 hover:border-[#ff0068]/30 transition-all">
                  <div className="w-12 h-12 rounded-xl bg-[#ff0068]/10 border border-[#ff0068]/20 flex items-center justify-center mb-4">
                    <Icon size={22} className="text-[#ff0068]" />
                  </div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 9.6 CREDENCIAIS FÍSICAS ──────────────────────────────────────────────── */}
      <FeatureSection
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
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-slate-950">
              <IdCard size={14} className="text-[#ff0068]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pré-visualização · 7 adesivos · Pimaco 6280</span>
            </div>
            <img
              src="/screenshots/credenciais-pdf.png"
              alt="Pré-visualização do PDF gerado pelo CoreoHub: adesivos Pimaco 6280 com nome, estúdio, categoria e QR code"
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        }
      />

      {/* ─── 9.7 NARRAÇÃO IA ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Sem locutor cobrando cachê"
        title={<>Voz <span className="text-[#ff0068]">profissional</span> anuncia<br />cada coreografia.</>}
        body="A IA gera a narração de abertura, transição e encerramento com voz natural em português. Geração em lote antes do evento, fallback automático se a internet cair. Acabou ficar refém de locutor cobrando cachê — e acabou microfone do produtor estourando ao vivo."
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
                  {/* Waveform fake */}
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

      {/* ─── 10. FEATURES GRID (resto que vale destaque) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5 bg-gradient-to-b from-transparent via-[#ff0068]/[0.02] to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Tudo incluso</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Não é um produto.<br />
              <span className="text-[#ff0068]">É o seu time invisível.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: GraduationCap, title: 'Workshops integrados',     body: 'Vende workshop como entidade própria, com lotes, professor e combo pra inscritos da mostra. Presença por QR libera certificado.' },
              { icon: Award,         title: 'Certificados em massa',    body: 'Mostra competitiva + workshop, dois templates. Lazy-cache: o PDF só é gerado quando o inscrito baixa. QR de validação pública.' },
              { icon: Shield,        title: 'Equipe sob controle',      body: 'Coordenador, Sonoplasta, Recepção, Marcador, Mesário, Coordenador do Júri. Cada um vê só o que precisa. Você dorme em paz.' },
              { icon: Trophy,        title: 'Premiação configurável',   body: 'Por nota mínima (Ouro/Prata/Bronze), por colocação (1º/2º/3º) ou prêmios especiais com deliberação da banca. Mude num clique.' },
              { icon: Share2,        title: 'Leaderboard público',      body: 'Resultado oficial em link compartilhável: capa, medalhistas por categoria e exportação PDF. Bailarino reposta no story.' },
              { icon: Globe,         title: 'Júri em 3 idiomas',        body: 'Jurado escolhe PT, EN ou ES no PIN — termos técnicos traduzidos. Pronto pra evento internacional sem refazer banca.' },
              { icon: Smartphone,    title: 'PWA instalável',           body: 'Bailarino, jurado e equipe instalam o app pelo navegador, sem app store. Ícone na home, abre offline, atualiza sozinho.' },
              { icon: Mail,          title: '8 e-mails automáticos',    body: 'Pagamento confirmado, ingresso enviado, presença registrada, certificado disponível, resultado publicado. Zero copy-paste.' },
              { icon: Sparkles,      title: 'Modo demo recriável',      body: 'Festival completo (50 inscrições, workshops, júri, equipe) clonável em 1 clique. Treina equipe sem sujar dados reais.' },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.07] transition-all">
                  <div className="w-12 h-12 rounded-xl bg-[#ff0068]/10 border border-[#ff0068]/20 flex items-center justify-center mb-4">
                    <Icon size={20} className="text-[#ff0068]" />
                  </div>
                  <h3 className="text-base font-black uppercase tracking-tight text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 11. DEMO CTA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-br from-[#ff0068]/15 via-white/5 to-purple-700/10 border border-[#ff0068]/20 rounded-3xl p-10 lg:p-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-full mb-6">
            <Zap size={12} className="text-[#ff0068]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Festival demo navegável</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase mb-4">
            Crie sua conta e<br />navegue por um festival completo.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            Ao criar conta, você ganha acesso a um evento demo com 50 inscrições,
            150 bailarinos fictícios, 3 jurados com PIN, workshops, ingressos e resultados publicados.
            Recriável em 1 clique — testa, brinca, quebra. Sem sujar dados reais.
          </p>
          <button
            onClick={() => navigate('/criar-evento')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 active:scale-95 transition-all"
          >
            Criar conta e abrir o demo <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ─── 11.5 FESTIVAIS ATIVOS (condicional — só renderiza com 3+ eventos) ──────────────────────────────────────────────── */}
      {festivaisAtivos.length >= 3 && (
        <section className="px-6 py-24 lg:py-32 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Acontecendo agora</p>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
                Festivais ativos<br />
                <span className="text-[#ff0068]">no CoreoHub.</span>
              </h2>
              <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed mt-6">
                Eventos com inscrições abertas neste momento — não é mockup, é a vitrine pública dos produtores que já estão rodando.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {festivaisAtivos.slice(0, 8).map((f) => (
                <Link
                  key={f.id}
                  to={`/evento/${f.slug ?? f.id}`}
                  className="group relative rounded-2xl overflow-hidden bg-slate-900 border border-white/10 hover:border-[#ff0068]/40 transition-all aspect-[3/4]"
                >
                  {f.cover_url ? (
                    <img
                      src={f.cover_url}
                      alt={f.name}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#ff0068]/20 via-purple-700/10 to-slate-900" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-1">
                      {fmtFestivalDate(f.start_date)}
                      {f.city && ` · ${f.city}${f.state ? `/${f.state}` : ''}`}
                    </p>
                    <p className="text-sm font-black uppercase tracking-tight text-white leading-tight line-clamp-2">{f.name}</p>
                  </div>
                </Link>
              ))}
            </div>

            <div className="text-center mt-10">
              <button
                onClick={() => navigate('/festivais')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Ver todos os festivais <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ─── 11.7 FEITO POR QUEM DANÇA (founder manifesto) ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 border-t border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,0,104,0.08),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14 items-center">
            {/* Foto */}
            <div className="lg:col-span-2">
              <div className="relative aspect-square rounded-3xl overflow-hidden bg-gradient-to-br from-[#ff0068]/30 via-purple-700/20 to-slate-900 border border-white/10">
                {/* Placeholder até receber foto real — substituir src abaixo */}
                <img
                  src="/tickobboy.jpg.jpeg"
                  alt="Ticko Bboy, fundador do CoreoHub"
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-7xl font-black tracking-tighter text-white/20">TB</span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-slate-950/90 to-transparent">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068]">Fundador</p>
                  <p className="text-lg font-black uppercase tracking-tight text-white mt-1">Ticko Bboy</p>
                </div>
              </div>
            </div>

            {/* Manifesto */}
            <div className="lg:col-span-3">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Por trás do CoreoHub</p>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter uppercase leading-[0.95] mb-8">
                Feito por <span className="text-[#ff0068]">quem dança.</span>
              </h2>

              <div className="space-y-5 text-slate-300 text-base md:text-lg leading-relaxed">
                <p>
                  Há mais de 25 anos eu vivo as danças urbanas — pisei em palco no Brasil, Portugal, Equador,
                  França e Argentina, e produzi festival com planilha, comprovante de Pix e
                  Photoshop até as 2 da manhã.
                </p>
                <p>
                  Hoje produzo o <span className="text-white font-bold">Usualdance Festival</span>, produzi o{' '}
                  <span className="text-white font-bold">Gravidade Festival</span> e fiz parte da equipe do{' '}
                  <span className="text-white font-bold">FIH2</span> — o maior evento de danças urbanas da América Latina.
                </p>
                <p>
                  CoreoHub nasceu da dor que eu mesmo tive. Não é software de quem viu o festival de longe —
                  é a ferramenta que eu queria ter tido em cada evento que produzi.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-white font-bold">Ticko Bboy</span> — empreendedor cultural, dançarino e MBA em Dança.
                  Fundador da <span className="text-white">Usualdance</span> e do CoreoHub.
                  Atua como ponte entre culturas urbanas, formação artística e o mercado da dança.
                </p>
              </div>
            </div>
          </div>
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
                a: 'Sim. O terminal de jurado é a única parte que precisa ser robusta a queda de Wi-Fi (porque é o ponto crítico ao vivo). Sistema salva nota localmente no tablet, mostra indicador visual de pendentes, e sincroniza assim que rede voltar. Áudio de feedback também fica em fila se necessário.',
              },
              {
                q: 'E se eu quiser sair? Tem fidelidade?',
                a: 'Nenhuma. Você cria evento quando quiser, paga só quando vende inscrição, e leva todos os dados em CSV / PDF quando quiser. Sem multa, sem letra miúda. Acreditamos que se o produto for bom, você fica.',
              },
              {
                q: 'Tem suporte técnico?',
                a: 'Sim. WhatsApp e email com resposta em até 4h em dia útil, dia do evento com plantão em horário ampliado. Se tiver problema crítico durante o festival ao vivo, atendemos imediatamente.',
              },
              {
                q: 'Quantos festivais por mês posso criar?',
                a: 'Quantos quiser. Não há limite de eventos, inscrições, jurados ou workshops. O modelo de comissão é por venda, não por volume — é o nosso sucesso é seu sucesso.',
              },
              {
                q: 'Funciona pra evento gratuito ou edital público?',
                a: 'Sim. Eventos com inscrição grátis (mostras municipais, JOMI, editais públicos) usam todas as features sem pagar nada. Comissão é só sobre inscrição paga. Cobramos plateia separadamente se você ativar venda de ingressos.',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <span className="text-base font-black uppercase tracking-tight text-white">{item.q}</span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 -mt-1 text-sm text-slate-300 leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 13.5 BAILARINO PROCURANDO FESTIVAL (lado demanda) ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 border-t border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(124,58,237,0.12),transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-purple-400 mb-3">Pra quem dança</p>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
                Procurando festival<br />pra <span className="text-[#ff0068]">se inscrever?</span>
              </h2>
              <p className="text-slate-300 text-lg leading-relaxed mb-6">
                Vitrine nacional de festivais com inscrições abertas — filtra por estado, mês e modalidade.
                Cadastra, paga e baixa o certificado num único link, do celular.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Inscrição direta em 4 cliques (sem planilha, sem boleto manual)',
                  'Solo, Duo, Trio ou Grupo — escolhe a modalidade no site',
                  'Recebe credencial com QR pra check-in na entrada',
                  'Certificado com validação pública, baixa quando quiser',
                ].map((b, i) => (
                  <li key={i} className="flex items-start gap-3 text-slate-300">
                    <Check size={16} className="text-purple-400 shrink-0 mt-1" />
                    <span className="text-sm leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate('/festivais')}
                className="inline-flex items-center gap-2 px-8 py-4 bg-purple-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(124,58,237,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <Search size={16} />
                Encontrar meu festival
              </button>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center gap-2 pb-4 border-b border-white/10 mb-4">
                <Search size={14} className="text-purple-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Buscar festivais</span>
              </div>
              <div className="space-y-3">
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <MapPin size={14} className="text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-300">São Paulo</span>
                  <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-purple-400">SP</span>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <CalendarClock size={14} className="text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-300">Junho · Julho · Agosto</span>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <Users size={14} className="text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-300">Solo · Duo · Grupo</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {[
                    { name: 'Festival Nordeste', city: 'Recife/PE', date: '12 jun' },
                    { name: 'Mostra Sul', city: 'Curitiba/PR', date: '24 jun' },
                    { name: 'CoreoHub Open', city: 'São Paulo/SP', date: '06 jun' },
                    { name: 'JOMI 2026', city: 'Goiânia/GO', date: '15 jul' },
                  ].map((f, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-2.5">
                      <p className="text-[10px] font-black uppercase tracking-tight text-white truncate">{f.name}</p>
                      <p className="text-[9px] text-slate-500 truncate mt-0.5">{f.city}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mt-1">{f.date}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 14. CTA FINAL ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.18),transparent_70%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
            Pare de apagar incêndio.<br />
            <span className="text-[#ff0068]">Comece a produzir.</span>
          </h2>
          <p className="text-slate-300 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed mb-10">
            Crie seu festival agora. Compartilhe o link hoje à noite. Receba a primeira inscrição amanhã.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => navigate('/criar-evento')}
              className="group px-10 py-6 bg-[#ff0068] text-white rounded-2xl font-black text-base uppercase tracking-widest shadow-[0_24px_60px_rgba(255,0,104,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              <span className="flex items-center gap-3">
                Criar meu festival grátis
                <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto mt-12 pt-12 border-t border-white/10">
            {[
              { icon: DollarSign, t: 'Sem cartão de crédito' },
              { icon: Clock,      t: 'Setup em 30 segundos' },
              { icon: Users,      t: 'Cancela quando quiser' },
            ].map((g, i) => {
              const Icon = g.icon;
              return (
                <div key={i} className="flex flex-col items-center text-center gap-2">
                  <Icon size={16} className="text-emerald-400" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">{g.t}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="px-6 py-16 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-10 h-10" />
                <div>
                  <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                  <p className="text-[10px] text-slate-500">Gestão Inteligente para Festivais de Dança</p>
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
                <li><Link to="/estudios" className="hover:text-[#ff0068]">Para estúdios</Link></li>
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
                <li>
                  <a href="https://instagram.com/coreohub" target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068]">
                    @coreohub
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="text-[10px] text-slate-500 leading-relaxed">
              <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub Tecnologia LTDA</p>
              <p>CNPJ: 00.000.000/0001-00 · São José do Rio Preto/SP</p>
              <p className="mt-1">Pagamentos processados pela Asaas IP S.A. (CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.</p>
            </div>
            <p className="text-[10px] text-slate-600 shrink-0">
              © {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
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
