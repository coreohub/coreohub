/**
 * Landing dedicada ao setor público (secretarias, institutos, prefeituras).
 *
 * Tom corporativo formal, foco em conformidade legal (LGPD, Lei 14.133/2021)
 * e capacidade técnica. Sem CTA emocional. Form direciona pra contato
 * comercial via mailto + WhatsApp Business.
 *
 * Diferenças vs /lp (festival privado):
 *  - Não mostra preço (só componentes do orçamento)
 *  - Tom formal "sua secretaria" em vez de "você"
 *  - Conformidade no centro
 *  - PDF técnico baixável pra anexar a edital
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Download, FileText, Shield, Scale, Users,
  Building2, Award, ClipboardCheck, MessageCircle, Mail,
  Check, ChevronRight,
} from 'lucide-react';
import { motion } from 'motion/react';

const WHATSAPP_NUMBER = '5517997936169';
const WHATSAPP_DISPLAY = '+55 17 99793-6169';
const EMAIL = 'contato@coreohub.com';

const buildEmailMailto = (form: Record<string, string>) => {
  const subject = encodeURIComponent(`[Apresentação Técnica] ${form.instituicao || 'Solicitação'}`);
  const body = encodeURIComponent(
    `Solicitação de apresentação técnica do CoreoHub:\n\n` +
    `Nome: ${form.nome}\n` +
    `Cargo: ${form.cargo}\n` +
    `Instituição: ${form.instituicao}\n` +
    `E-mail institucional: ${form.email}\n` +
    `Telefone: ${form.telefone}\n` +
    `Tipo de evento: ${form.tipoEvento}\n` +
    `Data prevista: ${form.dataEvento}\n` +
    `Volume estimado de inscritos: ${form.volume}\n` +
    `Modalidade do empenho: ${form.empenho}\n\n` +
    `Comentário:\n${form.comentario}\n`,
  );
  return `mailto:${EMAIL}?subject=${subject}&body=${body}`;
};

const LandingGoverno: React.FC = () => {
  const [form, setForm] = useState({
    nome: '', cargo: '', instituicao: '', email: '', telefone: '',
    tipoEvento: 'JOMI · Jogos da Melhor Idade',
    dataEvento: '', volume: 'até 200 inscritos', empenho: 'Não sei',
    comentario: '',
  });
  const upd = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = buildEmailMailto(form);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">

      {/* ─── 1. HERO ──────────────────────────────────────────────── */}
      <section className="relative px-6 pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,0,104,0.12),transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto text-center space-y-8">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">
              Para Secretarias de Cultura, Esportes, Institutos e Organizadores de Editais Públicos
            </p>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tighter uppercase leading-[0.95]">
              Plataforma de gestão para<br />
              <span className="text-[#ff0068]">festivais e mostras culturais</span><br />
              do setor público.
            </h1>
            <p className="mt-8 text-slate-300 text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
              Sistema integrado para administração de festivais, mostras competitivas e eventos culturais
              com conformidade à Lei Geral de Proteção de Dados (LGPD), compatibilidade com a
              Lei 14.133/2021 e operação adequada para equipes de servidores.
            </p>
          </motion.div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <a
              href="#solicitar"
              className="group px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              <span className="inline-flex items-center gap-2">
                Solicitar apresentação técnica <ChevronRight size={18} />
              </span>
            </a>
            <Link
              to="/governo/proposta"
              className="px-8 py-5 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/10 transition-all inline-flex items-center gap-2"
            >
              <FileText size={16} /> Documento técnico (PDF)
            </Link>
          </div>
        </div>

        <div className="relative max-w-5xl mx-auto w-full grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/5 pt-10 mt-12">
          {[
            { val: 'LGPD', label: 'Conformidade integral' },
            { val: '14.133', label: 'Compatível' },
            { val: '100%', label: 'Operação remota' },
            { val: '24/7', label: 'Funciona offline' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{s.val}</p>
              <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 1.5 FOTO INSTITUCIONAL ──────────────────────────────────────────────── */}
      <section className="relative w-full h-[55vh] md:h-[65vh] min-h-[400px] max-h-[600px] overflow-hidden border-t border-white/5">
        <img
          src="https://i.imgur.com/kpBd1Iw.jpg"
          alt="Equipe de gestão pública analisando dados de mostra cultural"
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-12 md:pb-16">
          <div className="max-w-5xl mx-auto">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Decisão técnica respaldada</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase leading-[0.95] max-w-3xl">
              Sua equipe analisa.<br />
              <span className="text-[#ff0068]">Procuradoria aprova.</span>
            </h2>
            <p className="text-slate-300 text-base md:text-lg max-w-2xl mt-4 leading-relaxed">
              Documentação técnica completa, conformidade auditável e termo de referência modelo —
              tudo o que sua área jurídica precisa pra anexar ao processo administrativo.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 2. CASOS DE USO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Aplicações no setor público</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Pensado para os festivais que<br />
              <span className="text-[#ff0068]">a sua secretaria já produz.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: Users,
                title: 'JOMI · Jogos da Melhor Idade',
                body: 'Mostras culturais e modalidades de dança nas fases municipais, regionais e estaduais. Categorias por idade, classificação por município, relatório consolidado para a coordenadoria.',
                image: 'https://i.imgur.com/KGtRNzX.jpg',
                imageAlt: 'Idosos participando de mostra cultural pública',
              },
              {
                icon: Building2,
                title: 'Mostras Municipais de Dança',
                body: 'Festivais abertos da prefeitura com inscrição gratuita ou simbólica. Vitrine pública, programação, certificado oficial automatizado e relatório de prestação de contas.',
                image: null,
                imageAlt: '',
              },
              {
                icon: Award,
                title: 'Mostras Estaduais',
                body: 'Eventos de grande porte com banca técnica, deliberação coletiva e publicação oficial dos resultados em portal próprio. Suporta múltiplas modalidades simultâneas.',
                image: null,
                imageAlt: '',
              },
            ].map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden flex flex-col">
                  {c.image && (
                    <div className="aspect-[16/10] bg-slate-900 overflow-hidden">
                      <img src={c.image} alt={c.imageAlt} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="p-6 flex-1">
                    <div className="w-12 h-12 rounded-xl bg-[#ff0068]/10 border border-[#ff0068]/20 flex items-center justify-center mb-4">
                      <Icon size={20} className="text-[#ff0068]" />
                    </div>
                    <h3 className="text-base font-black uppercase tracking-tight text-white mb-2">{c.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{c.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 3. DIFERENCIAL PARA O SETOR PÚBLICO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Por que o poder público escolhe</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Operação simples para servidor.<br />
              <span className="text-[#ff0068]">Auditoria completa para quem fiscaliza.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
            {[
              {
                title: 'Servidor não-técnico opera o sistema',
                body: 'Configuração do edital em até 30 minutos. Nossa IA analisa o regulamento e parametriza categorias, formações, lotes e prêmios. Equipe da TI da prefeitura não é necessária para uso diário.',
              },
              {
                title: 'Histórico imutável de cada decisão',
                body: 'Quem aprovou, quando e por quê. Aderente a auditoria interna, controles do TCM e prestação de contas. Exportação de relatórios em PDF e CSV oficiais.',
              },
              {
                title: 'Equipe com permissões granulares',
                body: 'Coordenador, Recepção, Marcador de Palco e Banca de Júri. Cada papel acessa apenas o que precisa. Servidor não autorizado não vê dados financeiros nem altera classificação.',
              },
              {
                title: 'Funciona offline durante o evento ao vivo',
                body: 'Wi-Fi do ginásio cair não interrompe a banca. Notas dos jurados são salvas localmente e sincronizam quando a rede volta. Único do mercado brasileiro com essa capacidade.',
              },
              {
                title: 'Vitrine pública oficial',
                body: 'Link único `/festival/<edital>` substitui necessidade de criar microsite separado. Página oficial com regulamento, programação, jurados e resultados. Pode ser usada como portal do evento.',
              },
              {
                title: 'Documentação para edital',
                body: 'Documento técnico de 6 páginas pronto para anexar à licitação. Termo de referência modelo, especificações técnicas e identificação completa do fornecedor.',
              },
            ].map((d, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <Check size={18} className="text-[#ff0068] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-tight text-white">{d.title}</h3>
                    <p className="text-xs text-slate-400 mt-2 leading-relaxed">{d.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 4. CONFORMIDADE LEGAL ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5 bg-gradient-to-b from-transparent via-[#ff0068]/[0.02] to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Requisitos do setor público</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Pronto para<br />
              <span className="text-[#ff0068]">edital e licitação.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield size={22} className="text-[#ff0068]" />
                <h3 className="text-base font-black uppercase tracking-tight text-white">LGPD · Lei 13.709/2018</h3>
              </div>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Encarregado de Dados (DPO) designado: Hemer Roger Dos Santos
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Inscritos têm acesso aos próprios dados conforme Art. 18
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Política de privacidade pública e atualizada
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Operador (CoreoHub) e Controlador (Secretaria) bem definidos via contrato
                </li>
              </ul>
              <a
                href="https://www.coreohub.com/politica-de-privacidade"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
              >
                Política de privacidade <ArrowRight size={12} />
              </a>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Scale size={22} className="text-[#ff0068]" />
                <h3 className="text-base font-black uppercase tracking-tight text-white">Lei 14.133/2021 · Licitações</h3>
              </div>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Compatível com modalidades de inexigibilidade e dispensa
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Documento técnico para anexar ao edital
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Termo de referência modelo disponível
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} className="text-[#ff0068] shrink-0 mt-1" />
                  Cumprimento das cláusulas anticorrupção (Art. 14)
                </li>
              </ul>
              <Link
                to="/governo/proposta"
                className="inline-flex items-center gap-1.5 mt-4 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
              >
                Documento técnico (PDF) <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 5. MODELO DE CONTRATAÇÃO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Transparência no orçamento</p>
          <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase mb-6">
            Cotação <span className="text-[#ff0068]">fechada por evento.</span>
          </h2>
          <p className="text-slate-300 text-lg max-w-3xl mx-auto leading-relaxed mb-12">
            Cada projeto recebe orçamento personalizado conforme volume estimado, complexidade da banca e
            necessidade de suporte presencial. Valor fixo emitido antes do empenho — em conformidade com a
            Lei 14.133/2021.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'Implementação',
                body: 'Configuração do edital, parametrização de categorias, importação do regulamento via IA e treinamento da equipe gestora (até 16h de consultoria).',
              },
              {
                title: 'Operação',
                body: 'Hospedagem dedicada durante o período do edital, domínio personalizado, vitrine pública oficial e painel de auditoria.',
              },
              {
                title: 'Suporte',
                body: 'Atendimento em horário comercial, plantão remoto no dia do evento ao vivo, suporte presencial em campo (opcional, conforme escopo).',
              },
            ].map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] mb-3">{`0${i + 1}`}</p>
                <h3 className="text-base font-black uppercase tracking-tight text-white mb-2">{c.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-xs text-slate-500 italic">
            Solicite proposta detalhada com prazos e valores específicos para o seu projeto.
          </p>
        </div>
      </section>

      {/* ─── 6. CASOS DE SUCESSO (placeholder) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Referências</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Confiado por instituições<br />
              <span className="text-[#ff0068]">com controle interno.</span>
            </h2>
            <p className="text-[10px] text-amber-400 font-black uppercase tracking-widest mt-4 italic">
              ⚠ Placeholders · trocar por cases reais antes de publicar
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                quote: 'O sistema reduziu em 80% o trabalho manual da equipe na fase municipal. Conseguimos consolidar resultados de 12 escolas em uma tarde.',
                name: 'Coordenadoria de Cultura — Município X',
                role: 'JOMI 2026 (placeholder)',
              },
              {
                quote: 'A documentação técnica foi anexada diretamente à inexigibilidade. Procuradoria aprovou sem ressalvas.',
                name: 'Secretaria Municipal de Cultura — Cidade Y',
                role: 'Mostra Municipal (placeholder)',
              },
              {
                quote: 'Funcionou perfeitamente mesmo com queda de internet no segundo dia do evento. Ninguém na plateia percebeu.',
                name: 'Departamento de Esportes — Estado Z',
                role: 'Festival Estadual (placeholder)',
              },
            ].map((t, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <ClipboardCheck size={18} className="text-[#ff0068] mb-3" />
                <p className="text-sm text-slate-200 leading-relaxed mb-6 italic">"{t.quote}"</p>
                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm font-black text-white">{t.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 7. DOCUMENTO TÉCNICO ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-br from-[#ff0068]/15 via-white/5 to-purple-700/10 border border-[#ff0068]/20 rounded-3xl p-10 lg:p-14">
          <FileText size={32} className="text-[#ff0068] mx-auto mb-6" />
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Documentação para edital</p>
          <h2 className="text-3xl md:text-4xl font-black tracking-tighter uppercase mb-4">
            Tudo o que a sua área jurídica<br />precisa, num PDF.
          </h2>
          <p className="text-slate-300 text-base md:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            Documento técnico de 6 páginas com identificação completa do CoreoHub (CNPJ, endereço, contatos),
            especificação técnica, certificações de conformidade, modelo de termo de referência e estrutura
            de orçamento.
          </p>
          <Link
            to="/governo/proposta"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-slate-950 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-100 active:scale-95 transition-all"
          >
            <Download size={18} /> Baixar documento técnico
          </Link>
        </div>
      </section>

      {/* ─── 8. SOLICITAR APRESENTAÇÃO ──────────────────────────────────────────────── */}
      <section id="solicitar" className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Próximos passos</p>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">
              Vamos conversar sobre<br />
              <span className="text-[#ff0068]">o seu próximo edital.</span>
            </h2>
            <p className="text-slate-300 text-lg max-w-2xl mx-auto mt-6 leading-relaxed">
              Apresentamos o sistema em uma reunião de 45 minutos, presencial ou remota.
              Você pode trazer sua equipe, área jurídica e financeira. Não cobramos pela demonstração.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Nome completo *" required>
                <input type="text" required value={form.nome} onChange={e => upd('nome', e.target.value)} className={inputCls} />
              </FormField>
              <FormField label="Cargo / função *" required>
                <input type="text" required value={form.cargo} onChange={e => upd('cargo', e.target.value)} className={inputCls} placeholder="Ex: Coordenadora de Cultura" />
              </FormField>
            </div>
            <FormField label="Instituição *" required>
              <input type="text" required value={form.instituicao} onChange={e => upd('instituicao', e.target.value)} className={inputCls} placeholder="Secretaria, Instituto, Prefeitura" />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="E-mail institucional *" required>
                <input type="email" required value={form.email} onChange={e => upd('email', e.target.value)} className={inputCls} />
              </FormField>
              <FormField label="Telefone com DDD *" required>
                <input type="tel" required value={form.telefone} onChange={e => upd('telefone', e.target.value)} className={inputCls} />
              </FormField>
            </div>
            <FormField label="Tipo de evento de interesse">
              <select value={form.tipoEvento} onChange={e => upd('tipoEvento', e.target.value)} className={inputCls}>
                <option>JOMI · Jogos da Melhor Idade</option>
                <option>Mostra Municipal de Dança</option>
                <option>Mostra Estadual</option>
                <option>Festival cultural</option>
                <option>Outro</option>
              </select>
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Volume estimado de inscritos">
                <select value={form.volume} onChange={e => upd('volume', e.target.value)} className={inputCls}>
                  <option>até 200 inscritos</option>
                  <option>200 a 600 inscritos</option>
                  <option>600 a 1.500 inscritos</option>
                  <option>acima de 1.500</option>
                </select>
              </FormField>
              <FormField label="Modalidade do empenho">
                <select value={form.empenho} onChange={e => upd('empenho', e.target.value)} className={inputCls}>
                  <option>Não sei</option>
                  <option>Inexigibilidade</option>
                  <option>Dispensa de licitação</option>
                  <option>Pregão eletrônico</option>
                  <option>Concorrência</option>
                </select>
              </FormField>
            </div>
            <FormField label="Data prevista do evento">
              <input type="date" value={form.dataEvento} onChange={e => upd('dataEvento', e.target.value)} className={inputCls} />
            </FormField>
            <FormField label="Comentário (opcional)">
              <textarea rows={3} value={form.comentario} onChange={e => upd('comentario', e.target.value)} className={inputCls} placeholder="Características específicas do edital, prazos, requisitos especiais" />
            </FormField>

            <div className="pt-4 border-t border-white/10">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-[#e0005c] transition-colors"
              >
                Encaminhar solicitação <ChevronRight size={18} />
              </button>
              <p className="text-[10px] text-slate-500 text-center mt-3">
                Resposta em até 1 dia útil. Você também pode falar diretamente:
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-3">
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Olá, tenho interesse em saber mais sobre o CoreoHub para meu edital público.')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/20"
                >
                  <MessageCircle size={14} /> WhatsApp {WHATSAPP_DISPLAY}
                </a>
                <a
                  href={`mailto:${EMAIL}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10"
                >
                  <Mail size={14} /> {EMAIL}
                </a>
              </div>
            </div>
          </form>

          {/* Disclaimer LGPD */}
          <div className="mt-8 p-5 bg-white/5 border border-white/10 rounded-2xl">
            <p className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-slate-300">Sobre proteção de dados:</strong> o CoreoHub opera em
              conformidade com a LGPD. Encarregado de Dados (DPO): <strong>Hemer Roger Dos Santos</strong> · {EMAIL} ·
              WhatsApp {WHATSAPP_DISPLAY}. Política de privacidade e termos de uso em{' '}
              <a href="https://www.coreohub.com/politica-de-privacidade" target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline">
                coreohub.com/politica-de-privacidade
              </a>{' '}
              e{' '}
              <a href="https://www.coreohub.com/termos-de-uso" target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline">
                coreohub.com/termos-de-uso
              </a>.
            </p>
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
                <p className="text-[10px] text-slate-500">Plataforma de Gestão para Festivais e Mostras Culturais</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <Link to="/lp" className="hover:text-[#ff0068]">Festivais competitivos</Link>
              <Link to="/estudios" className="hover:text-[#ff0068]">Para estúdios</Link>
              <a href={`mailto:${EMAIL}`} className="hover:text-[#ff0068]">{EMAIL}</a>
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068]">{WHATSAPP_DISPLAY}</a>
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

const inputCls = 'w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff0068]/50 transition-colors';

const FormField: React.FC<{ label: string; children: React.ReactNode; required?: boolean }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{label}</label>
    {children}
  </div>
);

export default LandingGoverno;
