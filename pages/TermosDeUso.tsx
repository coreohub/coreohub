import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TermosDeUso: React.FC = () => {
  useEffect(() => {
    document.title = 'Termos de Uso — CoreoHub';
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = 'https://www.coreohub.com/termos';
    return () => { canonical!.href = 'https://www.coreohub.com/'; };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur border-b border-white/8 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-black text-xl uppercase tracking-wide">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF0068] shrink-0" />
            CoreoHub
          </Link>
          <Link to="/" className="text-sm font-semibold text-white/70 hover:text-white transition-colors">
            ← Voltar ao site
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-24">
        {/* Hero */}
        <div className="py-16 border-b border-white/8">
          <span className="inline-block text-[10px] font-bold tracking-[0.18em] uppercase text-[#FF0068] px-3 py-1.5 bg-[#FF0068]/10 border border-[#FF0068]/30 rounded mb-4">
            Legal
          </span>
          <h1 className="font-black text-4xl md:text-5xl uppercase tracking-tight mb-3">
            Termos de Uso
          </h1>
          <p className="text-sm text-white/40">Última atualização: julho de 2026</p>
        </div>

        {/* Body */}
        <div className="py-12 space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              1. Aceitação dos termos
            </h2>
            <p>Ao acessar ou utilizar a plataforma CoreoHub, você concorda com estes Termos de Uso. Se você não concordar com qualquer parte destes termos, não utilize a plataforma.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              2. Descrição do serviço
            </h2>
            <p className="mb-3">A CoreoHub é uma plataforma de gestão para festivais e mostras de dança que oferece:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Gerenciamento de inscrições online</li>
              <li>Processamento de pagamentos via Pix, cartão e boleto</li>
              <li>Júri digital com acesso por tablet e PIN</li>
              <li>Cronograma inteligente com IA</li>
              <li>Bilheteria, check-in por QR Code e emissão automática de certificados</li>
              <li>Painel de gestão com relatórios em tempo real</li>
            </ul>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              3. Cadastro e conta
            </h2>
            <p className="mb-3">Para utilizar a plataforma, o produtor deve criar uma conta fornecendo informações verdadeiras, completas e atualizadas. Você é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta.</p>
            <p>A CoreoHub se reserva o direito de suspender ou encerrar contas que violem estes termos ou que apresentem informações falsas.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              4. Modelo de cobrança
            </h2>
            <p className="mb-3">A CoreoHub opera no modelo de comissão por transação. <strong className="text-white font-semibold">Não há mensalidade.</strong> A cobrança ocorre apenas sobre transações financeiras realizadas através da plataforma, conforme a comissão configurada para cada evento.</p>
            <p>Eventos sem transações financeiras não geram cobrança. A comissão é definida no momento da criação de cada evento e pode ser configurada pelo produtor dentro dos limites estabelecidos pela plataforma.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              5. Responsabilidades do produtor
            </h2>
            <p className="mb-3">O produtor é responsável por:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Fornecer informações corretas sobre o evento (datas, local, regulamento, valores)</li>
              <li>Cumprir todas as obrigações legais relacionadas ao evento, incluindo alvarás, seguros e tributos</li>
              <li>Comunicar alterações ou cancelamentos aos inscritos com antecedência adequada</li>
              <li>Processar reembolsos em conformidade com o regulamento do evento e a legislação aplicável</li>
              <li>Garantir que o conteúdo publicado na plataforma não viole direitos de terceiros</li>
            </ul>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              6. Pagamentos e reembolsos
            </h2>
            <p className="mb-3">Os pagamentos são processados por meio do gateway Asaas. A CoreoHub não armazena dados de cartão de crédito. Reembolsos podem ser processados diretamente pelo painel do produtor, sujeitos às políticas do meio de pagamento utilizado.</p>
            <p>Em casos de cancelamento de evento, o produtor assume a responsabilidade pelo reembolso integral dos inscritos.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              7. Propriedade intelectual
            </h2>
            <p className="mb-3">A marca, o logotipo, o código-fonte e todos os elementos da plataforma CoreoHub são de propriedade exclusiva da CoreoHub. É vedada a reprodução, distribuição ou uso não autorizado desses elementos.</p>
            <p>O produtor mantém os direitos sobre o conteúdo que publica (nome do evento, imagens, regulamentos), concedendo à CoreoHub uma licença limitada para exibi-los na plataforma durante a vigência do contrato.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              8. Limitação de responsabilidade
            </h2>
            <p className="mb-3">A CoreoHub não se responsabiliza por:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Falhas de infraestrutura de terceiros (internet, gateway de pagamento, serviços de e-mail)</li>
              <li>Danos causados por uso inadequado da plataforma pelo produtor ou pelos inscritos</li>
              <li>Cancelamentos ou alterações de eventos de responsabilidade do produtor</li>
              <li>Perdas indiretas, lucros cessantes ou danos consequentes</li>
            </ul>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              9. Privacidade
            </h2>
            <p>O tratamento de dados pessoais é regido pela nossa{' '}
              <Link to="/privacidade" className="text-[#FF0068] hover:underline">Política de Privacidade</Link>
              , em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
            </p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              10. Modificações
            </h2>
            <p>A CoreoHub pode atualizar estes termos a qualquer momento. Alterações relevantes serão comunicadas por e-mail ou notificação na plataforma com antecedência mínima de 15 dias. O uso continuado da plataforma após a vigência das alterações constitui aceitação dos novos termos.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              11. Cancelamento
            </h2>
            <p>O produtor pode encerrar sua conta a qualquer momento, sem multa. Eventos em andamento com inscrições abertas devem ser encerrados antes do cancelamento da conta, garantindo os direitos dos inscritos.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              12. Lei aplicável e foro
            </h2>
            <p>Estes termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de São José do Rio Preto — SP para dirimir quaisquer controvérsias decorrentes deste instrumento.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              13. Contato
            </h2>
            <p>Dúvidas sobre estes termos podem ser enviadas via WhatsApp:{' '}
              <a
                href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20Coreohub"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF0068] hover:underline"
              >
                (17) 99793-6169
              </a>.
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 py-8 text-center text-xs text-white/40">
        <div className="flex justify-center gap-6 mb-3 flex-wrap">
          <Link to="/" className="hover:text-white transition-colors">Página inicial</Link>
          <Link to="/termos" className="hover:text-white transition-colors">Termos de Uso</Link>
          <Link to="/privacidade" className="hover:text-white transition-colors">Política de Privacidade</Link>
        </div>
        <p>© 2026 CoreoHub. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
};

export default TermosDeUso;
