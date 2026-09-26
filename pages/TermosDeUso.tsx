import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TermosDeUso: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Termos de Uso — CoreoHub';

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      const prev = el?.getAttribute('content') ?? null;
      if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
      el.setAttribute('content', content);
      return prev;
    };
    const prevDesc = setMeta('description', 'Termos de Uso da CoreoHub: regras de uso da plataforma de gestão de festivais e mostras de dança, responsabilidades e condições de pagamento.');

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = 'https://www.coreohub.com/termos';
    return () => {
      document.title = prevTitle;
      if (prevDesc !== null) setMeta('description', prevDesc);
      canonical!.href = 'https://www.coreohub.com/';
    };
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
          <p className="text-sm text-white/40">Última atualização: 26 de setembro de 2026</p>
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
            <p>Em caso de cancelamento, adiamento ou alteração relevante do evento, o comprador tem direito à restituição integral do valor pago, incluindo as taxas, nos termos da cláusula 7. A CoreoHub processa a devolução pela plataforma e o produtor reembolsa a CoreoHub conforme o Termo do Produtor.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              7. Compra de ingressos
            </h2>
            <p className="mb-3">Esta cláusula vale para quem compra ingressos de plateia pela plataforma, além dos direitos previstos no Código de Defesa do Consumidor e no Decreto nº 13.108/2026.</p>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li><strong className="text-white font-semibold">Preço e taxa de serviço:</strong> o preço do ingresso e a taxa de serviço aparecem separados desde a oferta, com o total antes do pagamento. Ao escolher os ingressos, o preço e a taxa ficam travados pelo tempo exibido na tela do checkout.</li>
              <li><strong className="text-white font-semibold">Meia-entrada:</strong> vale nos termos da Lei nº 12.933/2013 e do Decreto nº 8.537/2015, cujo texto e os órgãos de fiscalização aparecem no ponto de venda. O benefício é pessoal e o documento que comprova o direito deve ser apresentado na compra e na portaria; sem a comprovação, paga-se a diferença para o valor inteiro. Cada CPF de comprador pode comprar 1 meia-entrada por evento, salvo os ingressos de pessoa com deficiência e de acompanhante. Cada evento mostra o total de ingressos e quantos são de meia-entrada e, depois do evento, publica o relatório de vendas.</li>
              <li><strong className="text-white font-semibold">Transferência:</strong> o ingresso pode ser transferido, de graça, para outra pessoa pela própria página do ingresso, informando nome, CPF, e-mail e telefone do novo titular. O QR e o link antigos deixam de valer e o novo titular recebe o ingresso por e-mail. Não é possível transferir depois do check-in nem em sessão cancelada. Na transferência de meia-entrada, o novo titular precisa comprovar o direito na portaria.</li>
              <li><strong className="text-white font-semibold">Arrependimento:</strong> você pode desistir da compra em até 7 dias corridos do pagamento e até o início do evento, pelo botão "Desistir da compra" na página do ingresso, com devolução integral do valor pago, incluindo a taxa de serviço. A desistência vale para todos os ingressos da mesma compra.</li>
              <li><strong className="text-white font-semibold">Cancelamento, adiamento ou alteração relevante:</strong> se a sessão for cancelada, adiada ou sofrer alteração relevante (data, horário, local, atração principal ou formato), você escolhe entre manter o ingresso na nova data, receber crédito ou pedir a restituição integral, incluindo as taxas, sem multa nem retenção. O crédito tem saldo, vale por 12 meses e pode ser usado em outras sessões do mesmo espetáculo. Você faz a escolha pela página do ingresso.</li>
              <li><strong className="text-white font-semibold">Quem responde:</strong> perante o comprador, a CoreoHub e o produtor respondem em conjunto pela devolução dos valores. Entre eles, o produtor reembolsa a CoreoHub, como previsto no Termo do Produtor.</li>
            </ul>
            <p>Reclamações também podem ser feitas ao Procon do seu estado e em consumidor.gov.br.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              8. Propriedade intelectual
            </h2>
            <p className="mb-3">A marca, o logotipo, o código-fonte e todos os elementos da plataforma CoreoHub são de propriedade exclusiva da CoreoHub. É vedada a reprodução, distribuição ou uso não autorizado desses elementos.</p>
            <p>O produtor mantém os direitos sobre o conteúdo que publica (nome do evento, imagens, regulamentos), concedendo à CoreoHub uma licença limitada para exibi-los na plataforma durante a vigência do contrato.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              9. Limitação de responsabilidade
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
              10. Privacidade
            </h2>
            <p>O tratamento de dados pessoais é regido pela nossa{' '}
              <Link to="/privacidade" className="text-[#FF0068] hover:underline">Política de Privacidade</Link>
              , em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
            </p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              11. Modificações
            </h2>
            <p>A CoreoHub pode atualizar estes termos a qualquer momento. Alterações relevantes serão comunicadas por e-mail ou notificação na plataforma com antecedência mínima de 15 dias. O uso continuado da plataforma após a vigência das alterações constitui aceitação dos novos termos.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              12. Cancelamento
            </h2>
            <p>O produtor pode encerrar sua conta a qualquer momento, sem multa. Eventos em andamento com inscrições abertas devem ser encerrados antes do cancelamento da conta, garantindo os direitos dos inscritos.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              13. Lei aplicável e foro
            </h2>
            <p>Estes termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de São José do Rio Preto — SP para dirimir quaisquer controvérsias decorrentes deste instrumento.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              14. Contato
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
