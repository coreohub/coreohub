import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const PoliticaDePrivacidade: React.FC = () => {
  useEffect(() => {
    document.title = 'Política de Privacidade — CoreoHub';
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = 'https://www.coreohub.com/privacidade';
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
            Política de Privacidade
          </h1>
          <p className="text-sm text-white/40">
            Última atualização: julho de 2026 · Em conformidade com a LGPD (Lei nº 13.709/2018)
          </p>
        </div>

        {/* Body */}
        <div className="py-12 space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              1. Quem somos
            </h2>
            <p className="mb-3">A CoreoHub é uma plataforma de gestão para festivais e mostras de dança. Somos responsáveis pelo tratamento dos dados pessoais coletados em nosso site (<strong className="text-white font-semibold">www.coreohub.com</strong>) e na plataforma (<strong className="text-white font-semibold">app.coreohub.com</strong>).</p>
            <p>Contato do encarregado de dados (DPO):{' '}
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

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              2. Dados que coletamos
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/12">
                    <th className="text-left py-2.5 px-3 text-white font-semibold text-xs uppercase tracking-wide bg-white/5">Dado</th>
                    <th className="text-left py-2.5 px-3 text-white font-semibold text-xs uppercase tracking-wide bg-white/5">Finalidade</th>
                    <th className="text-left py-2.5 px-3 text-white font-semibold text-xs uppercase tracking-wide bg-white/5">Base legal (LGPD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {[
                    ['Nome e e-mail', 'Criação de conta, comunicações do evento', 'Execução de contrato'],
                    ['CPF', 'Emissão de certificados e notas fiscais', 'Obrigação legal'],
                    ['Dados de pagamento', 'Processamento de transações (via Asaas — não armazenamos cartão)', 'Execução de contrato'],
                    ['Dados de acesso (IP, navegador)', 'Segurança, diagnóstico e analytics (GA4)', 'Legítimo interesse'],
                    ['Vídeos enviados pelo inscrito', 'Pré-seleção remota pelo júri', 'Consentimento'],
                  ].map(([dado, fin, base]) => (
                    <tr key={dado}>
                      <td className="py-2.5 px-3 align-top text-white/70">{dado}</td>
                      <td className="py-2.5 px-3 align-top text-white/70">{fin}</td>
                      <td className="py-2.5 px-3 align-top text-white/70">{base}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              3. Como usamos seus dados
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 mb-4">
              <li>Gerenciar inscrições, pagamentos e presença no evento</li>
              <li>Emitir certificados e comunicar resultados</li>
              <li>Enviar e-mails transacionais relacionados ao evento (confirmação, lembrete, certificado)</li>
              <li>Gerar relatórios e métricas para o produtor do evento</li>
              <li>Melhorar a plataforma com base em dados de uso agregados e anonimizados</li>
            </ul>
            <p>Não utilizamos seus dados para publicidade de terceiros nem os vendemos a nenhuma empresa.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              4. Compartilhamento de dados
            </h2>
            <p className="mb-3">Compartilhamos dados apenas com:</p>
            <ul className="list-disc pl-5 space-y-1.5 mb-4">
              <li><strong className="text-white font-semibold">Asaas</strong> — gateway de pagamento, para processar transações financeiras</li>
              <li><strong className="text-white font-semibold">Google</strong> — Analytics (GA4) para métricas de uso, com dados anonimizados</li>
              <li><strong className="text-white font-semibold">Produtor do evento</strong> — acessa os dados dos inscritos para gestão do festival ou mostra em que você se inscreveu</li>
            </ul>
            <p>Todos os parceiros são obrigados contratualmente a proteger seus dados e não utilizá-los para outras finalidades.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              5. Cookies
            </h2>
            <p>Utilizamos cookies essenciais (necessários para o funcionamento da plataforma) e cookies de analytics (Google Analytics 4, para entender como o site é usado). Você pode desativar os cookies de analytics nas configurações do seu navegador sem prejuízo ao uso da plataforma.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              6. Seus direitos (LGPD)
            </h2>
            <p className="mb-3">Como titular de dados, você tem direito a:</p>
            <ul className="list-disc pl-5 space-y-1.5 mb-4">
              <li><strong className="text-white font-semibold">Acesso:</strong> solicitar cópia dos seus dados pessoais</li>
              <li><strong className="text-white font-semibold">Correção:</strong> corrigir dados incompletos ou desatualizados</li>
              <li><strong className="text-white font-semibold">Exclusão:</strong> solicitar a eliminação dos seus dados quando não forem mais necessários</li>
              <li><strong className="text-white font-semibold">Portabilidade:</strong> receber seus dados em formato estruturado</li>
              <li><strong className="text-white font-semibold">Revogação de consentimento:</strong> retirar consentimentos dados anteriormente</li>
              <li><strong className="text-white font-semibold">Oposição:</strong> contestar tratamentos baseados em legítimo interesse</li>
            </ul>
            <p>Para exercer qualquer um desses direitos, entre em contato via WhatsApp:{' '}
              <a
                href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20Coreohub"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF0068] hover:underline"
              >
                (17) 99793-6169
              </a>. Respondemos em até 15 dias úteis.
            </p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              7. Retenção de dados
            </h2>
            <p>Mantemos seus dados enquanto sua conta estiver ativa ou enquanto necessário para cumprir obrigações legais. Dados de transações financeiras são retidos por 5 anos conforme exigência fiscal. Certificados emitidos ficam disponíveis por tempo indeterminado para fins de validação. Comentários em áudio e/ou texto de avaliação dos jurados ficam disponíveis por até 90 dias após o evento, tanto para o inscrito quanto para o produtor do evento, sendo removidos automaticamente após esse prazo.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              8. Segurança
            </h2>
            <p>Adotamos medidas técnicas e organizacionais para proteger seus dados, incluindo criptografia em trânsito (HTTPS/TLS), controle de acesso por perfil e autenticação por PIN para jurados. Não armazenamos dados de cartão de crédito — o processamento é integralmente realizado pelo gateway Asaas.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              9. Transferência internacional
            </h2>
            <p>O Google Analytics pode processar dados em servidores fora do Brasil. O Google adere a mecanismos de adequação reconhecidos internacionalmente, garantindo proteção equivalente à LGPD.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              10. Alterações nesta política
            </h2>
            <p>Podemos atualizar esta política periodicamente. A data de "última atualização" no topo do documento indica quando houve a revisão mais recente. Alterações relevantes serão comunicadas por e-mail.</p>
          </section>

          <section>
            <h2 className="font-black text-xl uppercase tracking-wide text-white border-b border-white/8 pb-2 mb-4">
              11. Contato
            </h2>
            <p className="mb-3">Dúvidas, solicitações ou reclamações relacionadas à privacidade:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>WhatsApp:{' '}
                <a
                  href="https://wa.me/5517997936169?text=Ol%C3%A1%2C%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20Coreohub"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF0068] hover:underline"
                >
                  (17) 99793-6169
                </a>
              </li>
              <li>Você também pode registrar reclamação junto à ANPD (Autoridade Nacional de Proteção de Dados) em{' '}
                <a
                  href="https://www.gov.br/anpd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF0068] hover:underline"
                >
                  gov.br/anpd
                </a>
              </li>
            </ul>
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

export default PoliticaDePrivacidade;
