import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, Sparkles, FileText, Wifi, Link as LinkIcon, DollarSign,
  Trophy, Shield, Award, GraduationCap, Mic2, Check, X, ChevronDown,
  Zap, Users, Clock, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { motion } from 'motion/react';

const PINK = '#ff0068';

const LandingPage = () => {
  const navigate = useNavigate();
  const [calcInscricoes, setCalcInscricoes] = useState(200);
  const [calcTicket, setCalcTicket] = useState(150);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const calcReceita = calcInscricoes * calcTicket;
  const calcComissao = calcReceita * 0.10;
  const calcLiquido = calcReceita - calcComissao;
  const fmtBRL = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">

      {/* ─── 1. HERO ──────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col px-6 pt-24 pb-12 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,0,104,0.18),transparent_60%)]" />
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

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter uppercase leading-[0.92]">
              O festival dos seus sonhos<br />
              cabe num <span className="text-[#ff0068]">único link.</span>
            </h1>

            <p className="text-slate-300 text-lg md:text-2xl font-medium max-w-3xl mx-auto leading-relaxed">
              Inscrições, jurados, palco, ingressos e certificados em uma plataforma só.
              <br className="hidden md:block" />
              <span className="text-slate-400">Você foca na arte. CoreoHub cuida da operação.</span>
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
              <button
                onClick={() => navigate('/festivais')}
                className="px-8 py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Ver festivais ativos →
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Sem cartão de crédito · Sem mensalidade · Você só paga quando vende
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
              Você reconhece esses pesadelos?
            </p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Festival não é improviso.<br />
              <span className="text-rose-400">Mas todo mundo improvisa.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Wi-Fi do ginásio cai no meio da apuração', body: 'Jurado perde nota, banca para, produtor vira saco de pancada na frente de 500 pais.' },
              { title: 'Inscrição cobrada no Pix manual', body: 'Bailarino paga, manda print, você confere planilha, esquece de aprovar. 3 horas por dia checando comprovantes.' },
              { title: 'Resultado sai 3 dias depois', body: 'Você ainda calculando médias na planilha enquanto bailarinos enchem seu DM. Reputação queimando junto.' },
              { title: 'Regulamento que ninguém lê', body: 'Você escreve, ninguém abre, todo mundo manda DM perguntando o mesmo. Suporte virou seu trabalho de tempo integral.' },
              { title: 'Certificado feito no Photoshop', body: 'Você fica até 2h da manhã substituindo nome em template. Pra um festival de 200 bailarinos. Todo ano.' },
              { title: 'Equipe com acesso total ao painel', body: 'Sua recepcionista vê dinheiro, sua marcadora bagunça cronograma, você nunca dorme sem medo.' },
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
            CoreoHub é o sistema operacional do seu festival. IA configura o evento em 30 segundos.
            Júri avalia mesmo offline. Bailarino se inscreve, paga e baixa certificado num único link.
            Você vê tudo em tempo real, no celular ou no computador.
          </p>

          {/* Fluxo visual */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-5 gap-3">
            {[
              { icon: FileText, label: 'PDF do regulamento' },
              { icon: Sparkles, label: 'IA configura' },
              { icon: LinkIcon, label: 'Link público' },
              { icon: Wifi, label: 'Festival roda' },
              { icon: Award, label: 'Resultado + certificado' },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <React.Fragment key={i}>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-2xl bg-[#ff0068]/10 border border-[#ff0068]/30 flex items-center justify-center">
                      <Icon size={22} className="text-[#ff0068]" />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 text-center">{step.label}</p>
                  </div>
                </React.Fragment>
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
          'Reconhece edital JOMI, Bolsa Cultura, mostras municipais',
          'Extrai ingressos, workshops, programação e patrocinadores',
          'Separa preâmbulo legal do que importa pra você',
          'Você revisa e publica — sem decifrar PDF de 40 páginas',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3 shadow-2xl">
            <div className="flex items-center gap-2 pb-3 border-b border-white/10">
              <FileText size={14} className="text-[#ff0068]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">regulamento-jomi-2026.pdf</span>
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

      {/* ─── 5. Banca offline ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Único do mercado"
        title={<>Wi-Fi caiu? <span className="text-[#ff0068]">Festival não para.</span></>}
        body="Jurado avalia no tablet. Sistema salva localmente. Quando rede voltar, sincroniza sozinho. Nunca perde uma nota — mesmo que o ginásio fique offline o evento inteiro. É o único sistema do mercado brasileiro com isso."
        bullets={[
          'Login do jurado por PIN de 4 dígitos (sem senha, sem login social)',
          'Tablet vira terminal kiosk — instala como app, abre no PIN automaticamente',
          'Áudio de até 30 minutos por avaliação (com waveform real)',
          'Indicador visual de fila pendente — jurado sabe se há nota não enviada',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">Ao Vivo</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  <span className="text-[9px] font-black text-amber-400">2 sincronizando</span>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Coreografia atual</p>
                <p className="text-lg font-black uppercase tracking-tight text-white mt-1">Lago dos Cisnes Moderno</p>
                <p className="text-[10px] text-slate-400">Ballet · Adulto · Solo</p>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {['Performance', 'Técnica', 'Música', 'Criatividade', 'Figurino'].map((c, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{c}</p>
                    <p className="text-lg font-black tabular-nums text-white mt-1">{[9.2, 8.8, 9.0, 9.1, 8.5][i]}</p>
                  </div>
                ))}
              </div>
              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Média ponderada</span>
                <span className="text-2xl font-black text-[#ff0068] tabular-nums">8.92</span>
              </div>
            </div>
          </div>
        }
      />

      {/* ─── 5.5 EM CAMPO (foto produto-em-uso) ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/5">
        {/* Wrapper full-bleed com imagem cinematográfica */}
        <div className="relative w-full h-[70vh] md:h-[85vh] min-h-[500px] max-h-[800px]">
          <img
            src="https://i.imgur.com/hGkjZ6J.jpg"
            alt="Jurado avaliando uma apresentação ao vivo num festival CoreoHub: tablet em mãos exibindo o terminal, microfone para feedback de áudio, palco iluminado ao fundo"
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />

          {/* Gradient overlay pra legibilidade do texto */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 via-transparent to-transparent" />

          {/* Badge AO VIVO no canto superior */}
          <div className="absolute top-6 right-6 md:top-10 md:right-10">
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
                Não é mockup.<br />
                <span className="text-[#ff0068]">É como funciona</span><br />
                no seu festival.
              </h2>
              <p className="text-slate-300 text-base md:text-xl max-w-2xl mt-6 leading-relaxed">
                Tablet em mãos, microfone no áudio, palco rolando.
                Banca avalia em tempo real — mesmo se a rede do ginásio cair.
              </p>
            </div>
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
          'Checkout com lotes progressivos, cupons e meia-entrada',
          'Workshops + ingresso de plateia no mesmo carrinho',
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
              { icon: Mic2,          title: 'Narração IA',           body: 'Voz profissional ElevenLabs anuncia cada coreografia. Geração em lote antes do evento, fallback se cair.' },
              { icon: GraduationCap, title: 'Workshops integrados',  body: 'Vende workshop como entidade própria, com lotes, professor e desconto pra inscritos da mostra.' },
              { icon: Award,         title: 'Certificados em massa', body: 'Emite tudo de uma vez ao final. Inscrito baixa quando quiser, com QR de validação pública.' },
              { icon: Shield,        title: 'Equipe sob controle',   body: 'Coordenador, Sonoplasta, Recepção, Marcador. Cada um vê só o que precisa. Você dorme em paz.' },
              { icon: Trophy,        title: 'Premiação configurável',body: 'Sistema por nota mínima (Ouro/Prata/Bronze) ou por colocação (1º/2º/3º). Mude num clique.' },
              { icon: Clock,         title: 'Marcação de palco',     body: 'Cronômetro respeita o tempo do regulamento. Marcador clica "Pronto" e cronograma anda sozinho.' },
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
            <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Sem cadastro pra ver</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase mb-4">
            Veja funcionando antes de criar conta.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            Acessa nosso evento de demonstração ao vivo: festival completo com 50 inscrições,
            150 bailarinos fictícios, 3 jurados com PIN, workshops, ingressos e resultados publicados.
            Navega como se fosse seu evento.
          </p>
          <button
            onClick={() => navigate('/festivais')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 active:scale-95 transition-all"
          >
            Abrir demo agora <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ─── 12. DEPOIMENTOS (placeholder pra trocar) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Quem usa, fala</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Produtores que dormem<br />a noite inteira.
            </h2>
            <p className="text-[10px] text-amber-400 font-black uppercase tracking-widest mt-4 italic">
              ⚠ Exemplos · troque por depoimentos reais antes de publicar
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                name: 'Mariana Lopes',
                role: 'Cia Étoile · Rio de Janeiro',
                quote: 'Antes eu passava 2 dias depois do festival fechando planilha de notas. Agora o resultado sai 10 minutos depois da última apresentação. Só consegui dormir cedo de novo por causa disso.',
              },
              {
                name: 'Renato Ferraz',
                role: 'Festival Nordeste em Movimento',
                quote: 'Wi-Fi do ginásio caiu duas vezes no segundo dia. Antes seria caos. CoreoHub manteve a banca avaliando e quando voltou, sincronizou tudo. Nem o público percebeu.',
              },
              {
                name: 'Camila Tavares',
                role: 'Mostra Municipal Sorocaba',
                quote: 'Colei o edital da prefeitura no parser. Em 30 segundos tinha categoria, formação, prêmio, tudo configurado. Economizei 4 horas só nesse setup.',
              },
            ].map((t, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <Sparkles size={16} className="text-[#ff0068] mb-3" />
                <p className="text-slate-200 text-sm leading-relaxed mb-6">"{t.quote}"</p>
                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm font-black uppercase tracking-tight text-white">{t.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{t.role}</p>
                </div>
              </div>
            ))}
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
      <footer className="px-6 py-12 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-10 h-10" />
              <div>
                <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                <p className="text-[10px] text-slate-500">Gestão Inteligente para Festivais de Dança</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <a href="https://app.coreohub.com/festivais" className="hover:text-[#ff0068]">Festivais ativos</a>
              <a href="https://app.coreohub.com/login"     className="hover:text-[#ff0068]">Entrar</a>
              <a href="mailto:contato@coreohub.com"        className="hover:text-[#ff0068]">Contato</a>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 text-center mt-8">
            © {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.
          </p>
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
