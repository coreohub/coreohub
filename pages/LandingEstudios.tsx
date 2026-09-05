/**
 * Landing dedicada a estúdios de dança que fazem espetáculo / mostra / recital
 * de fim de ano.
 *
 * Diferenças vs /lp (festival competitivo):
 *  - SEM jurados, premiação, ranking, deliberação
 *  - FOCO em vender ingresso pra plateia (família, amigos)
 *  - Certificado de participação automático
 *  - Workshops/master classes antes do espetáculo
 *  - Tom emocional ("noite virada na planilha", "show inesquecível")
 *
 * Diferenças vs /governo:
 *  - Pessoa física / MEI, decisão rápida
 *  - Self-service total, sem call comercial
 *  - Mostra preço (taxa proporcional ao plano escolhido — Começo/Essencial/Escala)
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight, Sparkles, Ticket, Calendar, Award, Clock, Users,
  CheckCircle2, AlertTriangle, ChevronDown, MessageCircle, Mail,
  Star, ArrowRight, Heart,
} from 'lucide-react';
import { motion } from 'motion/react';

const WHATSAPP_NUMBER = '5517997936169';
const WHATSAPP_DISPLAY = '+55 17 99793-6169';

const LandingEstudios: React.FC = () => {
  const navigate = useNavigate();
  const [calcAlunos, setCalcAlunos] = useState(80);
  const [calcConvidados, setCalcConvidados] = useState(3);
  const [calcTicket, setCalcTicket] = useState(40);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const ingressosVendidos = calcAlunos * calcConvidados;
  const calcReceita = ingressosVendidos * calcTicket;
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
                Para estúdios de dança
              </span>
            </div>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter uppercase leading-[0.92]">
              Seu espetáculo<br />
              de fim de ano.<br />
              <span className="text-[#ff0068]">Sem virar a noite</span><br />
              na planilha.
            </h1>

            <p className="text-slate-300 text-lg md:text-2xl font-medium max-w-3xl mx-auto leading-relaxed">
              Vende ingresso pra família, organiza programação, gera certificado de cada aluno
              e libera você pra ensaiar.
              <br className="hidden md:block" />
              <span className="text-slate-400">A coreografia é sua. A operação é nossa.</span>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
              <button
                onClick={() => navigate('/criar-evento')}
                className="group relative px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Criar meu espetáculo grátis <ChevronRight size={18} />
                </span>
              </button>
              <button
                onClick={() => navigate('/festivais')}
                className="px-8 py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Ver demonstração →
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Mostra · Recital · Espetáculo · Show — funciona pra todos · Sem mensalidade · Você só paga quando vende
            </p>
          </motion.div>
        </div>

        <div className="relative z-10 max-w-5xl mx-auto w-full grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/5 pt-8 mt-12">
          {[
            { val: 'A partir de 10%', label: 'Por ingresso vendido' },
            { val: '0', label: 'Mensalidade' },
            { val: '15min', label: 'Pra publicar' },
            { val: '∞', label: 'Alunos no espetáculo' },
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
              Espetáculo é arte.<br />
              <span className="text-rose-400">Logística não devia ser pesadelo.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Vendendo ingresso pelo Pix manual', body: 'Mãe paga, manda print no WhatsApp, você confere planilha, esquece de avisar a portaria. Família chega e ninguém acha o nome.' },
              { title: 'Planilha de quem dança o quê', body: 'Você cruza turma × bailarina × figurino × música × ordem. Muda uma vez, perde 4 horas refazendo. Toda semana muda.' },
              { title: 'Certificado feito no Photoshop', body: 'Você até 2h da manhã substituindo nome em template, exportando 1 por 1, mandando email manual. Toda virada de ano.' },
              { title: 'Família perdida no dia do show', body: 'Avó pergunta "quando minha neta dança?" 17 vezes. Sem programação clara, ninguém sabe o horário das turmas.' },
              { title: 'Master class antes? Cobra como?', body: 'Aluno quer fazer workshop com professor convidado. Você anota num caderno, cobra Pix, perde de vista quem pagou.' },
              { title: 'No dia da estreia, tudo falha', body: 'Wi-Fi do teatro caiu, lista de presença sumiu, câmera não gravou, foto da turma 3 ficou no celular do auxiliar.' },
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
            Cada ano você jura que <span className="text-white font-bold">"ano que vem é diferente"</span>.
            Ano que vem chega. E é igual.
          </p>
        </div>
      </section>

      {/* ─── 2.5 FOTO DA DIRETORA ──────────────────────────────────────────────── */}
      <section className="relative w-full h-[60vh] md:h-[75vh] min-h-[450px] max-h-[700px] overflow-hidden border-t border-white/5">
        <img
          src="https://i.imgur.com/ETyu0L8.jpg"
          alt="Diretora de estúdio supervisionando ensaio com tablet em mãos"
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-12 md:pb-20">
          <div className="max-w-5xl mx-auto">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Sua noite de volta</p>
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tighter uppercase leading-[0.95] max-w-3xl">
              O palco é seu.<br />
              <span className="text-[#ff0068]">A operação é nossa.</span>
            </h2>
            <p className="text-slate-300 text-base md:text-xl max-w-2xl mt-6 leading-relaxed">
              Você dirige o ensaio. CoreoHub vende ingresso, monta programação,
              gera certificado e libera você pra fazer o que ninguém mais sabe:
              transformar criança em bailarina.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 3. SOLUÇÃO ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 border-t border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.08),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">A solução</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Um link no Instagram.<br />
            <span className="text-[#ff0068]">Tudo o resto rola sozinho.</span>
          </h2>
          <p className="text-slate-300 text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
            Configura o espetáculo em 15 minutos. Compartilha o link no Stories. Família compra ingresso.
            Aluno baixa certificado. Programação fica visível. Você foca no palco — não na planilha.
          </p>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-5 gap-3">
            {[
              { icon: Sparkles, label: 'Configura espetáculo' },
              { icon: Ticket,   label: 'Compartilha link' },
              { icon: Users,    label: 'Família compra ingresso' },
              { icon: Calendar, label: 'Show roda' },
              { icon: Award,    label: 'Certificado pronto' },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-2xl bg-[#ff0068]/10 border border-[#ff0068]/30 flex items-center justify-center">
                    <Icon size={22} className="text-[#ff0068]" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 text-center">{step.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 4. INGRESSO ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Bilheteria sem dor de cabeça"
        title={<>Avó, vovô, padrinho, vizinho.<br /><span className="text-[#ff0068]">Todo mundo</span> compra do celular.</>}
        body="Família paga no cartão, Pix ou boleto. Recebe ingresso com QR direto no email/WhatsApp. Você acompanha vendas em tempo real, faz check-in com câmera no dia. Sem planilha, sem print, sem confusão."
        bullets={[
          'Inteira, meia (estudante/idoso) e solidária com 1kg de alimento',
          'Lotes progressivos pra incentivar compra antecipada',
          'Cupom de desconto pra família grande ou ex-aluno',
          'Dinheiro cai direto na sua conta via Asaas (Banco Central)',
          'Reembolso 1 clique se cliente desistir',
        ]}
        mockup={
          <figure className="relative rounded-2xl overflow-hidden aspect-[4/5] bg-slate-900 shadow-2xl">
            <img
              src="https://i.imgur.com/10ufINO.jpg"
              alt="Família comprando ingresso pelo celular"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
            <figcaption className="absolute bottom-0 left-0 right-0 p-5">
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-1">Reunidos no sofá</p>
              <p className="text-white text-base font-bold leading-snug">
                Avó, mãe e filha escolhendo poltrona junto.<br />
                Família compra em segundos, sem grupo de WhatsApp confuso.
              </p>
            </figcaption>
          </figure>
        }
      />

      {/* ─── 5. PROGRAMAÇÃO ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Família sabe o horário sem perguntar"
        title={<>Programação <span className="text-[#ff0068]">visual</span><br />pra não perder<br />a turma da sobrinha.</>}
        body="Cronograma público com cada turma, horário, estilo e duração. Família consulta antes pra chegar na hora certa. No dia, a marcação de palco respeita o tempo configurado e o cronômetro avança automático."
        bullets={[
          'Programação pública compartilhável no WhatsApp',
          'Marcação de palco com cronômetro respeitando tempo do regulamento',
          'Trilhas sonoras vinculadas a cada turma (sem MP3 perdido no pendrive)',
          'Operador do som tem painel próprio simplificado',
          'Reordenar turmas em runtime sem refazer cronograma',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-5">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Programação · 13 dezembro</p>
            <div className="space-y-2">
              {[
                { hora: '19h00', titulo: 'Abertura · Ballet Infantil', dur: '8min' },
                { hora: '19h12', titulo: 'Jazz Júnior · "Cantiga"', dur: '5min' },
                { hora: '19h20', titulo: 'Hip Hop Adolescentes · "Vibes"', dur: '6min' },
                { hora: '19h30', titulo: 'INTERVALO', dur: '15min', accent: true },
                { hora: '19h48', titulo: 'Contemporâneo Adulto · "Voo"', dur: '7min' },
                { hora: '19h58', titulo: 'Dança de Salão · Encerramento', dur: '12min' },
              ].map((p, i) => (
                <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${p.accent ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-white/5'}`}>
                  <span className="text-[10px] font-black tabular-nums text-slate-400 w-12">{p.hora}</span>
                  <span className={`text-xs font-bold flex-1 ${p.accent ? 'text-amber-400' : 'text-white'}`}>{p.titulo}</span>
                  <span className="text-[9px] text-slate-500 tabular-nums">{p.dur}</span>
                </div>
              ))}
            </div>
          </div>
        }
      />

      {/* ─── 6. CERTIFICADO ──────────────────────────────────────────────── */}
      <FeatureSection
        kicker="Sem photoshop. Sem virar a noite."
        title={<>Certificado de cada aluno<br /><span className="text-[#ff0068]">já pronto</span> ao fim do show.</>}
        body="Aluno baixa pelo celular com 1 toque. Sai com nome correto, modalidade, professor, data e QR de validação pública. Pais postam no Instagram. Você dorme."
        bullets={[
          'Geração em massa ao final do espetáculo (1 clique)',
          'QR de validação pública — diretor da escola pode conferir',
          'Aluno acessa via link único, baixa quantas vezes quiser',
          'Modelo customizável (logo do estúdio, fundo, assinatura)',
          'Histórico do aluno: certificados de anos anteriores ficam disponíveis',
        ]}
        mockup={
          <div className="bg-gradient-to-br from-[#ff0068]/20 via-purple-700/10 to-transparent border border-white/10 rounded-2xl p-8 text-center shadow-2xl">
            <Award size={32} className="text-[#ff0068] mx-auto mb-4" />
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">Certificado de Participação</p>
            <p className="text-3xl font-black tracking-tighter uppercase text-white leading-tight mb-3">
              Maria Silva
            </p>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              participou da<br />
              <strong className="text-white">CIA ÉTOILE 2026</strong><br />
              na modalidade Ballet Infantil
            </p>
            <p className="text-[10px] text-slate-500">Sáb · 13 dez · Teatro Municipal</p>
            <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-center gap-2">
              <div className="w-12 h-12 bg-white rounded grid grid-cols-4 grid-rows-4 gap-px p-1">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className={Math.random() > 0.5 ? 'bg-slate-900' : ''} />
                ))}
              </div>
              <p className="text-[8px] text-slate-500 font-mono text-left">Validação<br />pública via QR</p>
            </div>
          </div>
        }
      />

      {/* ─── 7. WORKSHOPS ──────────────────────────────────────────────── */}
      <FeatureSection
        reverse
        kicker="Master class antes do show"
        title={<>Workshop <span className="text-[#ff0068]">com professor convidado</span><br />no mesmo carrinho.</>}
        body='Vende workshop separado, junto com ingresso ou cortesia pra alunos da casa. Lotes, capacidade máxima, certificado. Sem caderno, sem Pix manual, sem confusão de "quem pagou".'
        bullets={[
          'Combo grátis ou desconto pra inscritos do espetáculo',
          'Lotes progressivos com data de virada automática',
          'Capacidade máxima respeitada (não vende além da sala)',
          'Professor recebe lista com bio + foto pra divulgação',
          'Certificado de workshop separado do certificado do espetáculo',
        ]}
        mockup={
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="aspect-[16/9] bg-gradient-to-br from-[#ff0068]/30 via-purple-700/30 to-slate-950 relative">
              <span className="absolute top-3 right-3 inline-flex items-center text-[9px] font-black uppercase tracking-widest bg-violet-500/90 text-white px-2 py-0.5 rounded-full">
                Grátis p/ inscritos
              </span>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">Jazz Funk · Intermediário</p>
              <h3 className="text-base font-black uppercase tracking-tight text-white">Master Class com Juliana Silveira</h3>
              <p className="text-xs text-slate-400">Sáb 13 dez · 14h às 16h · Sala 2</p>
              <div className="flex items-center justify-between pt-3 border-t border-white/10">
                <span className="text-sm font-black text-white">R$ 80</span>
                <span className="text-[10px] text-emerald-400">22 vagas restantes</span>
              </div>
            </div>
          </div>
        }
      />

      {/* ─── 8. PRICING / CALCULADORA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Modelo simples</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Você só paga <span className="text-[#ff0068]">quando vende.</span><br />
            Sem mensalidade. Sem fidelidade.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed mb-12">
            A partir de 10% de comissão por ingresso ou workshop vendido, sem mensalidade fora do plano
            escolhido. Dinheiro cai direto na sua conta via Asaas (regulamentado pelo Banco Central).
            Espetáculo cancelado por chuva? Sem venda, sem comissão.
          </p>

          <div className="max-w-3xl mx-auto bg-gradient-to-br from-[#ff0068]/10 via-white/5 to-purple-700/10 border border-white/10 rounded-3xl p-6 md:p-10 backdrop-blur-xl">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6">
              Simule o seu espetáculo
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
              <div className="text-left">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Alunos no palco: <span className="text-[#ff0068] font-mono">{calcAlunos}</span>
                </label>
                <input
                  type="range" min={20} max={300} step={5}
                  value={calcAlunos}
                  onChange={(e) => setCalcAlunos(Number(e.target.value))}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>20</span><span>300</span>
                </div>
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Convidados por aluno: <span className="text-[#ff0068] font-mono">{calcConvidados}</span>
                </label>
                <input
                  type="range" min={1} max={8} step={1}
                  value={calcConvidados}
                  onChange={(e) => setCalcConvidados(Number(e.target.value))}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>1</span><span>8</span>
                </div>
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Ticket médio: <span className="text-[#ff0068] font-mono">{fmtBRL(calcTicket)}</span>
                </label>
                <input
                  type="range" min={20} max={150} step={5}
                  value={calcTicket}
                  onChange={(e) => setCalcTicket(Number(e.target.value))}
                  className="w-full mt-2 accent-[#ff0068]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>R$ 20</span><span>R$ 150</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-left">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Ingressos vendidos</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-white mt-1">{ingressosVendidos}</p>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-rose-400">Comissão (plano Começo)</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-rose-400 mt-1">{fmtBRL(calcComissao)}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Você fica com</p>
                <p className="text-xl md:text-2xl font-black tabular-nums text-emerald-400 mt-1">{fmtBRL(calcLiquido)}</p>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-6">
              Simulação no plano Começo (10%, sem taxa fixa) — o mais indicado pra 1ª mostra ou espetáculo pequeno.
              Espetáculos maiores podem compensar mais nos planos Essencial ou Escala.{' '}
              <Link to="/planos" className="text-[#ff0068] font-bold hover:underline">Veja todos os planos</Link>.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 9. PLANILHA × CoreoHub ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Compare</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Planilha vs.<br />
              <span className="text-[#ff0068]">CoreoHub.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-3">Como você faz hoje</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {[
                  'Planilha Excel/Sheets que ninguém entende',
                  'Pix manual no WhatsApp + print de comprovante',
                  'Caderno de presença na entrada do teatro',
                  'Lista de turmas no Word, impressa, perdida',
                  'Photoshop até 2h da manhã pra certificado',
                  'Trilha no pendrive, na nuvem, no Drive — onde foi mesmo?',
                  '4-6 horas por semana só na operação',
                ].map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">Com a CoreoHub</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {[
                  '1 link no Instagram, tudo se resolve sozinho',
                  'Cartão, Pix automático, dinheiro na sua conta',
                  'Check-in com QR pela câmera do celular',
                  'Programação visual pública no link do evento',
                  'Certificado oficial em massa com 1 clique',
                  'Trilha vinculada à turma, organizada, sem "onde foi"',
                  '30 minutos pra configurar o ano todo',
                ].map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 10. DEMO CTA ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-br from-[#ff0068]/15 via-white/5 to-purple-700/10 border border-[#ff0068]/20 rounded-3xl p-10 lg:p-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-full mb-6">
            <Sparkles size={12} className="text-[#ff0068]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Teste sem cadastro</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase mb-4">
            Veja funcionando<br />antes de criar conta.
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            Acessa nosso espetáculo de demonstração com 50 alunos, 12 turmas, programação completa,
            ingressos à venda e certificados emitidos. Navega como se fosse seu próprio show.
          </p>
          <button
            onClick={() => navigate('/festivais')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 active:scale-95 transition-all"
          >
            Abrir demo agora <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ─── 11. FAQ ──────────────────────────────────────────────── */}
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
                q: 'Funciona pra mostra, recital, espetáculo, show?',
                a: 'Sim, todos os termos. Cada estúdio chama do seu jeito — jazz/contemporâneo costuma usar "espetáculo", ballet clássico usa "recital", projetos infantis usam "mostra". O sistema é o mesmo.',
              },
              {
                q: 'Como recebo o dinheiro dos ingressos?',
                a: 'Direto na sua conta bancária via Asaas (regulamentado pelo Banco Central). Cada ingresso pago gera split na hora — o restante pra você, a comissão do seu plano pra CoreoHub. Sem boleto perdido, sem espera de 30 dias.',
              },
              {
                q: 'Espetáculo cancelado por chuva ou pandemia: pago alguma coisa?',
                a: 'Não. Se você não vender, você não paga. A comissão é por venda concretizada. Reembolso aos compradores também é facilitado pelo sistema.',
              },
              {
                q: 'Posso cobrar dos próprios alunos uma "taxa de participação"?',
                a: 'Pode. A CoreoHub trata aluno-participante e plateia-pagante como categorias diferentes. Aluno pode pagar uma taxa simbólica (R$ 30 figurino, por exemplo) e a família compra ingresso normal.',
              },
              {
                q: 'E se eu quiser sair? Tem fidelidade?',
                a: 'Nenhuma. Cria espetáculo quando quiser, paga só quando vende, leva todos os dados em CSV/PDF na saída. Sem multa, sem letra miúda.',
              },
              {
                q: 'Tem suporte? Eu não entendo de tecnologia.',
                a: 'Sim. WhatsApp e e-mail em horário comercial com resposta em até 4h. Dia do espetáculo: plantão ampliado. Seu drama é nossa prioridade — você precisa estar livre pra dirigir o palco.',
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

      {/* ─── 12. CTA FINAL ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 overflow-hidden border-t border-white/5">
        {/* Background fullbleed: foto do palco com bailarinos, overlay escuro pra texto legível */}
        <img
          src="https://i.imgur.com/iYXGr0x.jpg"
          alt="Palco do espetáculo de dança com bailarinos em pose final"
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-slate-950/80" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.25),transparent_70%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <Heart size={28} className="text-[#ff0068] mx-auto mb-6" />
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
            Esse ano você dorme<br />
            <span className="text-[#ff0068]">a noite inteira.</span>
          </h2>
          <p className="text-slate-300 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed mb-10">
            Cria seu espetáculo agora. Compartilha o link no Stories hoje à noite.
            Recebe a primeira venda amanhã.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => navigate('/criar-evento')}
              className="group px-10 py-6 bg-[#ff0068] text-white rounded-2xl font-black text-base uppercase tracking-widest shadow-[0_24px_60px_rgba(255,0,104,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              <span className="flex items-center gap-3">
                Criar meu espetáculo grátis
                <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto mt-12 pt-12 border-t border-white/10">
            {[
              { icon: Star,   t: 'Sem cartão de crédito' },
              { icon: Clock,  t: 'Setup em 15 minutos' },
              { icon: Users,  t: 'Cancela quando quiser' },
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
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-10 h-10" />
              <div>
                <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                <p className="text-[10px] text-slate-500">Para estúdios que merecem dormir cedo</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-x-6 gap-y-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <Link to="/lp" className="hover:text-[#ff0068]">Festivais competitivos</Link>
              <Link to="/governo" className="hover:text-[#ff0068]">Para o setor público</Link>
              <a href="mailto:contato@coreohub.com" className="hover:text-[#ff0068]">contato@coreohub.com</a>
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068] inline-flex items-center gap-1">
                <MessageCircle size={10} /> {WHATSAPP_DISPLAY}
              </a>
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
              <CheckCircle2 size={16} className="text-[#ff0068] shrink-0 mt-1" />
              <span className="text-sm leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>{mockup}</div>
    </div>
  </section>
);

export default LandingEstudios;
