/**
 * Documento Técnico para Editais Públicos — versão imprimível.
 *
 * Renderiza um PDF visual via página HTML + window.print() com print stylesheet.
 * Por que não jsPDF/PDFKit: HTML+CSS print preserva tipografia, é editável
 * pelo time comercial sem dev, e o usuário pode "Salvar como PDF" em qualquer
 * navegador moderno (Ctrl+P → Salvar como PDF).
 *
 * Para imprimir/baixar: usuário abre /governo/proposta e clica botão
 * "Baixar PDF", que dispara window.print(). O navegador abre diálogo
 * de impressão com opção "Salvar como PDF".
 *
 * Tom: jurídico-técnico, formal, sem efeitos visuais. Layout limpo
 * com cores neutras pra impressão econômica em P&B.
 */

import React from 'react';
import { Printer, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const PropostaGoverno: React.FC = () => {
  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-100">
      {/* Toolbar — escondido na impressão */}
      <div className="print:hidden bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/governo" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-xs font-bold">
            <ArrowLeft size={14} /> Voltar
          </Link>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff0068] text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-[#e0005c]"
          >
            <Printer size={14} /> Baixar PDF / Imprimir
          </button>
        </div>
        <p className="max-w-3xl mx-auto px-4 pb-3 text-[10px] text-slate-500">
          Pra salvar como PDF: clique em <strong>Baixar PDF</strong> e selecione "Salvar como PDF" como destino na janela de impressão.
        </p>
      </div>

      {/* Documento — ESTE é o conteúdo que vai pro PDF */}
      <article className="proposta-doc max-w-3xl mx-auto bg-white text-slate-900 my-8 print:my-0 px-12 py-16 print:px-16 print:py-20 shadow-lg print:shadow-none">

        {/* ─── CAPA ─── */}
        <header className="border-b-4 border-[#ff0068] pb-8 mb-12">
          <div className="flex items-center gap-4 mb-8">
            <img src="/coreohub-avatar.png" alt="CoreoHub" className="w-14 h-14" />
            <div>
              <p className="text-2xl font-black tracking-tighter uppercase text-slate-900">CoreoHub</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Plataforma de Gestão para Festivais</p>
            </div>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Documento Técnico</p>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-slate-900 leading-[0.95]">
            Especificação Técnica<br />
            para Editais Públicos
          </h1>
          <p className="mt-6 text-sm text-slate-600 leading-relaxed">
            Plataforma integrada para gestão de festivais, mostras culturais e jogos
            educativos do setor público, com conformidade à Lei 13.709/2018 (LGPD) e
            Lei 14.133/2021 (Licitações).
          </p>
          <p className="mt-8 text-[10px] text-slate-500 italic">
            Versão {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
        </header>

        {/* ─── 1. IDENTIFICAÇÃO ─── */}
        <Section number="1" title="Identificação do Fornecedor">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700 w-1/3">Razão social</td>
                <td className="py-2 text-slate-600">CoreoHub (Hemer Roger Dos Santos · MEI/ME — em adequação)</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700">CNPJ</td>
                <td className="py-2 text-slate-600">[a confirmar conforme situação cadastral atual]</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700">E-mail comercial</td>
                <td className="py-2 text-slate-600">contato@coreohub.com</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700">WhatsApp / telefone</td>
                <td className="py-2 text-slate-600">+55 17 99793-6169</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700">Site institucional</td>
                <td className="py-2 text-slate-600">coreohub.com</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="py-2 pr-4 font-bold text-slate-700">Encarregado de Dados (DPO)</td>
                <td className="py-2 text-slate-600">Hemer Roger Dos Santos · contato@coreohub.com</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-bold text-slate-700">Sede</td>
                <td className="py-2 text-slate-600">Brasil</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* ─── 2. RESUMO EXECUTIVO ─── */}
        <Section number="2" title="Resumo Executivo">
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            O CoreoHub é uma plataforma SaaS (Software as a Service) brasileira dedicada à
            administração de festivais de dança, mostras culturais e jogos educativos. Atende
            integralmente o ciclo do evento: configuração do edital, vitrine pública,
            inscrição de competidores, banca técnica, premiação, certificação oficial e
            relatório de prestação de contas.
          </p>
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            A solução foi projetada para ser operada por servidores não-técnicos, dispensando
            a equipe de TI da prefeitura ou secretaria contratante. A configuração inicial é
            assistida por inteligência artificial: a partir do upload do regulamento ou edital
            em PDF, o sistema parametriza categorias, formações, lotes de inscrição, prêmios
            especiais e critérios de avaliação automaticamente.
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            Diferencial técnico exclusivo no mercado brasileiro: capacidade de operação
            offline durante o evento ao vivo. Em caso de queda da rede no local, a banca de
            jurados continua avaliando normalmente — as notas são salvas localmente nos
            tablets e sincronizadas automaticamente quando a conexão é restabelecida.
          </p>
        </Section>

        {/* ─── 3. ESPECIFICAÇÃO TÉCNICA ─── */}
        <Section number="3" title="Especificação Técnica">
          <SubSection title="3.1 Arquitetura">
            <p className="text-sm text-slate-700 leading-relaxed">
              Aplicação web responsiva (PWA — Progressive Web App) construída em React +
              TypeScript, hospedada em infraestrutura Vercel (CDN global). Banco de dados
              PostgreSQL gerenciado pela Supabase com replicação automática e backup diário.
              Comunicação cliente-servidor exclusivamente via HTTPS com TLS 1.3.
            </p>
          </SubSection>

          <SubSection title="3.2 Funcionalidades principais">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>Configuração assistida por IA (Google Gemini) a partir do regulamento em PDF</li>
              <li>Vitrine pública oficial com regulamento, jurados, programação e ingressos</li>
              <li>Sistema de inscrição com lotes progressivos, cupons e meia-entrada</li>
              <li>Pagamento integrado via Asaas (regulamentado pelo Banco Central) com split transparente</li>
              <li>Banca técnica com avaliação por critérios ponderados, áudio de feedback e marcação de destaques</li>
              <li>Operação offline-first em tablets durante o evento ao vivo</li>
              <li>Sistema de premiação configurável (por nota mínima ou por colocação)</li>
              <li>Deliberação coletiva de prêmios especiais com gate do Coordenador</li>
              <li>Marcação de palco com cronômetro respeitando tempos do regulamento</li>
              <li>Narração IA com voz profissional (ElevenLabs) pré-renderizada antes do evento</li>
              <li>Workshops integrados com gestão própria (lotes, capacidade, certificação)</li>
              <li>Emissão automática de certificados oficiais com QR de validação pública</li>
              <li>Equipe operacional com permissões granulares (Coordenador, Sonoplasta, Recepção, Marcador)</li>
              <li>Relatórios em PDF e exportação CSV para prestação de contas</li>
            </ul>
          </SubSection>

          <SubSection title="3.3 Requisitos do cliente">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>Conexão à internet (qualquer banda larga residencial é suficiente)</li>
              <li>Navegador moderno: Chrome, Edge, Safari ou Firefox (versão dos últimos 12 meses)</li>
              <li>Para a banca: tablet Android (recomendado) ou iPad com tela de 9" ou maior</li>
              <li>Para operadores: computador com Windows, macOS ou Linux</li>
              <li>Smartphone do operador para acesso mobile no dia do evento (opcional)</li>
            </ul>
          </SubSection>

          <SubSection title="3.4 Segurança e backup">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>Criptografia TLS 1.3 em todas as comunicações</li>
              <li>Senhas armazenadas com hashing bcrypt (não há texto plano)</li>
              <li>Row-Level Security (RLS) no banco isola dados por evento e por papel</li>
              <li>Auditoria imutável de alterações em registros sensíveis</li>
              <li>Backup automático diário com retenção de 30 dias</li>
              <li>Disponibilidade contratual: 99,5% (SLA padrão)</li>
            </ul>
          </SubSection>
        </Section>

        {/* ─── 4. CONFORMIDADE LEGAL ─── */}
        <Section number="4" title="Conformidade Legal">
          <SubSection title="4.1 Lei Geral de Proteção de Dados — Lei 13.709/2018">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>
                <strong>Encarregado de Dados (DPO)</strong> nomeado em cumprimento ao
                Art. 41: <strong>Hemer Roger Dos Santos</strong> (contato@coreohub.com)
              </li>
              <li>
                <strong>Política de Privacidade pública e atualizada</strong>, disponível em
                coreohub.com/politica-de-privacidade
              </li>
              <li>
                <strong>Atendimento aos direitos do titular</strong> previstos no Art. 18 em
                até 15 dias úteis: confirmação, acesso, correção, anonimização, portabilidade,
                eliminação e revogação de consentimento
              </li>
              <li>
                <strong>Definição clara de papéis</strong> entre Operador (CoreoHub) e
                Controlador (instituição contratante) via contrato
              </li>
              <li>
                <strong>Base legal de tratamento</strong> definida para cada finalidade
                (consentimento, execução de contrato, obrigação legal)
              </li>
              <li>
                <strong>Comunicação de incidentes</strong> à ANPD e aos titulares afetados em
                prazo razoável conforme Art. 48
              </li>
            </ul>
          </SubSection>

          <SubSection title="4.2 Lei de Licitações — Lei 14.133/2021">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>
                Compatível com modalidades de <strong>inexigibilidade</strong> (Art. 74) e
                <strong> dispensa de licitação</strong> (Art. 75) aplicáveis a serviços de
                tecnologia
              </li>
              <li>
                Termo de Referência modelo disponível para anexação ao processo (item 6 deste
                documento)
              </li>
              <li>
                Cumprimento das cláusulas anticorrupção (Art. 14, §3º) — declaração específica
                disponível na proposta comercial
              </li>
              <li>
                Garantia de <strong>portabilidade dos dados</strong> em formato CSV/JSON ao
                final do contrato, sem custo adicional
              </li>
            </ul>
          </SubSection>

          <SubSection title="4.3 Demais conformidades">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
              <li>Acessibilidade: WCAG 2.1 nível AA em todas as telas públicas</li>
              <li>Marco Civil da Internet (Lei 12.965/2014): retenção mínima de logs de acesso</li>
              <li>Lei 12.527/2011 (LAI): suporte a publicação de dados abertos quando solicitado</li>
            </ul>
          </SubSection>
        </Section>

        {/* ─── 5. COMPONENTES DO ORÇAMENTO ─── */}
        <Section number="5" title="Componentes do Orçamento">
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            Cada projeto recebe orçamento personalizado conforme volume estimado de inscritos,
            complexidade da banca técnica e necessidade de suporte presencial. O valor é
            <strong> fixado antes do empenho</strong>, em conformidade com a Lei 14.133/2021,
            sem cobrança variável posterior.
          </p>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            Os componentes a seguir compõem o orçamento e são detalhados na proposta comercial
            específica enviada após a apresentação técnica:
          </p>

          <div className="space-y-4 mt-4">
            <Component
              title="Implementação"
              items={[
                'Configuração do edital com importação assistida por IA',
                'Parametrização de categorias, formações, lotes e prêmios',
                'Treinamento da equipe gestora (até 16h, presencial ou remoto)',
                'Termo de Referência modelo entregue em PDF editável',
              ]}
            />
            <Component
              title="Operação"
              items={[
                'Hospedagem dedicada durante o período do edital',
                'Domínio personalizado opcional (subdomínio gratuito ou domínio próprio)',
                'Vitrine pública oficial com identidade da instituição',
                'Painel de auditoria com histórico imutável de decisões',
                'Backup diário com retenção de 30 dias',
              ]}
            />
            <Component
              title="Suporte"
              items={[
                'Atendimento em horário comercial via e-mail e WhatsApp',
                'Plantão remoto durante o dia do evento ao vivo',
                'Suporte presencial em campo (opcional, conforme escopo contratado)',
                'Resposta em até 4h em dias úteis; até 1h em horário de plantão',
                'Acompanhamento dedicado em eventos com mais de 800 inscritos',
              ]}
            />
          </div>

          <p className="text-xs text-slate-500 italic mt-6">
            Solicite proposta detalhada com prazos e valores específicos para o seu projeto
            via formulário em coreohub.com/governo ou diretamente por contato@coreohub.com.
          </p>
        </Section>

        {/* ─── 6. TERMO DE REFERÊNCIA MODELO ─── */}
        <Section number="6" title="Termo de Referência Modelo (resumo)">
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            Modelo simplificado que pode ser adaptado e anexado ao processo administrativo:
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded p-5 text-sm text-slate-700 leading-relaxed space-y-3">
            <div>
              <p className="font-bold uppercase tracking-wider text-xs text-slate-500 mb-1">Objeto</p>
              <p>
                Contratação de plataforma SaaS para gestão integrada de festival/mostra
                cultural/jogos educativos, contemplando configuração, vitrine pública,
                inscrição, avaliação técnica, premiação, certificação e relatórios.
              </p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-xs text-slate-500 mb-1">Justificativa técnica</p>
              <p>
                A solução CoreoHub apresenta diferencial competitivo exclusivo no mercado
                brasileiro (operação offline-first durante eventos ao vivo, configuração por
                IA, integração nativa com instituição financeira regulamentada pelo Banco
                Central) que justifica contratação por inexigibilidade nos termos do Art. 74
                da Lei 14.133/2021.
              </p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-xs text-slate-500 mb-1">Prazo de execução</p>
              <p>
                Conforme cronograma do edital, com setup mínimo de 30 dias antes da abertura
                das inscrições e operação até 30 dias após a publicação dos resultados.
              </p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-xs text-slate-500 mb-1">Forma de pagamento</p>
              <p>
                Em parcela única após a assinatura do contrato, ou em até 3 parcelas conforme
                cronograma orçamentário da contratante. Valor fixado antes do empenho.
              </p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-xs text-slate-500 mb-1">Obrigações da CONTRATADA</p>
              <p>
                Manter a plataforma operacional durante o período contratado, prestar suporte
                conforme SLA, garantir conformidade LGPD, fornecer relatórios oficiais e
                garantir portabilidade dos dados ao término.
              </p>
            </div>
          </div>
        </Section>

        {/* ─── 7. ATENDIMENTO E SUPORTE ─── */}
        <Section number="7" title="Atendimento e Suporte">
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            Canais oficiais de atendimento:
          </p>
          <ul className="text-sm text-slate-700 space-y-1.5 mb-4">
            <li><strong>E-mail comercial:</strong> contato@coreohub.com</li>
            <li><strong>WhatsApp Business:</strong> +55 17 99793-6169</li>
            <li><strong>Site:</strong> coreohub.com</li>
          </ul>

          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            <strong>SLA padrão:</strong>
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700">
            <li>Resposta a chamados em horário comercial: até 4h</li>
            <li>Plantão durante eventos contratados: resposta em até 1h</li>
            <li>Disponibilidade da plataforma: 99,5% mensais</li>
            <li>Janelas de manutenção programadas: comunicadas com 72h de antecedência</li>
          </ul>
        </Section>

        {/* ─── 8. CONSIDERAÇÕES FINAIS ─── */}
        <Section number="8" title="Considerações Finais">
          <p className="text-sm text-slate-700 leading-relaxed mb-3">
            Este documento técnico é parte integrante do material de apoio à contratação e
            pode ser anexado ao processo administrativo. Para esclarecimentos adicionais,
            análise técnica detalhada ou apresentação ao vivo do sistema, solicite contato
            comercial pelos canais informados.
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            Disponibilizamos demonstração gratuita em ambiente controlado para que sua equipe
            possa avaliar o sistema antes da contratação, sem necessidade de cadastro prévio
            ou compromisso financeiro.
          </p>

          <div className="mt-8 pt-6 border-t-2 border-slate-200 text-center">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              CoreoHub · Plataforma de Gestão para Festivais e Mostras Culturais
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              contato@coreohub.com · +55 17 99793-6169 · coreohub.com
            </p>
          </div>
        </Section>
      </article>

      {/* Print stylesheet — esconde tudo exceto o documento */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          body { background: white !important; }
          .proposta-doc { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; padding: 0 !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};

const Section: React.FC<{ number: string; title: string; children: React.ReactNode }> = ({ number, title, children }) => (
  <section className="mb-10">
    <h2 className="text-lg font-black uppercase tracking-tighter text-slate-900 border-b-2 border-slate-300 pb-2 mb-5">
      <span className="text-[#ff0068]">{number}.</span> {title}
    </h2>
    {children}
  </section>
);

const SubSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-5">
    <h3 className="text-sm font-black uppercase tracking-wider text-slate-700 mb-2">{title}</h3>
    {children}
  </div>
);

const Component: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div className="border-l-4 border-[#ff0068] pl-4">
    <p className="text-sm font-black uppercase tracking-wider text-slate-900 mb-2">{title}</p>
    <ul className="text-sm text-slate-700 space-y-1">
      {items.map((it, i) => <li key={i}>· {it}</li>)}
    </ul>
  </div>
);

export default PropostaGoverno;
