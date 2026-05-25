import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { ArrowLeft, ShieldCheck, FileText, AlertTriangle, CheckCircle2, Loader2, ArrowRight, CreditCard, Home } from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';

// Versão do Termo. Bump ao alterar conteúdo — produtores existentes precisarão
// re-aceitar antes da próxima ação que dependa de aceite (ex: criar evento novo,
// receber pagamento). Aceites antigos ficam registrados no banco mas marcados
// como "versão anterior".
// 1.0 → 1.1 (2026-05-18): adiciona cláusula 5 sobre taxas bancárias do
// parceiro financeiro Asaas (taxa de criação de conta R$ 12,90 e demais
// taxas do Asaas). Cláusulas 5-10 da versão 1.0 foram renumeradas pra 6-11.
// 1.1 → 1.2 (2026-05-21): adiciona cláusula 6 sobre prazo de liberação
// de repasses (janela D+7 + antecipação manual sob risco). Cláusulas
// 6-11 da v1.1 foram renumeradas pra 7-12.
// 1.2 → 1.3 (2026-05-25): reescreve 6.3 (antecipação não é "sob risco":
// CoreoHub absorve gap via mecanismo BaaS, padrão Stripe/MP); adiciona
// cláusula 7-bis (refunds devem passar pela Plataforma — refund out-of-band
// não dispensa comissão CoreoHub e pode causar inconsistência).
export const TERMO_PRODUTOR_VERSION = '1.3';

const TermoProdutor: React.FC = () => {
  const navigate = useNavigate();
  const [userId, setUserId]               = useState<string | null>(null);
  const [acceptedAt, setAcceptedAt]       = useState<string | null>(null);
  const [acceptedVersion, setAcceptedVersion] = useState<string | null>(null);
  const [accepting, setAccepting]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [checkbox, setCheckbox]           = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from('profiles')
        .select('producer_terms_accepted_at, producer_terms_version')
        .eq('id', user.id)
        .maybeSingle();
      setAcceptedAt(profile?.producer_terms_accepted_at ?? null);
      setAcceptedVersion(profile?.producer_terms_version ?? null);
    };
    load();
  }, [navigate]);

  const isCurrentVersionAccepted =
    acceptedVersion === TERMO_PRODUTOR_VERSION && !!acceptedAt;

  const handleAccept = async () => {
    if (!userId) return;
    if (!checkbox) {
      setError('Marque a caixa de aceite para prosseguir.');
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      // RPC SECURITY DEFINER captura IP servidor + auth.uid() + grava em
      // audit log imutável + atualiza profile na mesma transação.
      // Cliente envia só version + user_agent (UA pode ser spoofado mas o
      // IP capturado pelo servidor é prova real).
      const { data: acceptedTimestamp, error: rpcErr } = await supabase.rpc(
        'accept_producer_terms',
        {
          p_version:    TERMO_PRODUTOR_VERSION,
          p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }
      );
      if (rpcErr) throw rpcErr;
      const ts = (acceptedTimestamp as string | null) ?? new Date().toISOString();
      setAcceptedAt(ts);
      setAcceptedVersion(TERMO_PRODUTOR_VERSION);
    } catch (e: any) {
      setError(e.message ?? 'Falha ao registrar aceite. Tente novamente.');
    } finally {
      setAccepting(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Topbar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:text-[#ff0068] transition-all"
          >
            <ArrowLeft size={12} /> Voltar
          </button>
          {isCurrentVersionAccepted && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest">
              <CheckCircle2 size={11} /> Aceito em {formatDate(acceptedAt!)}
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center">
            <FileText size={20} className="text-[#ff0068]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white italic">
              Termo de Adesão <span className="text-[#ff0068]">— Produtor</span>
            </h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
              Versão {TERMO_PRODUTOR_VERSION}
            </p>
          </div>
        </div>

        {/* Conteúdo do termo */}
        <article className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">1. Partes</h2>
            <p>
              Este Termo de Adesão (<strong>"Termo"</strong>) é celebrado entre <strong>CoreoHub</strong> (CNPJ 13.484.650/0001-00),
              doravante denominada <strong>"Plataforma"</strong>, e o usuário cadastrado como produtor (<strong>"Produtor"</strong>),
              regulando a utilização dos serviços da Plataforma para gestão de festivais, mostras e eventos de dança.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">2. Objeto</h2>
            <p>
              A Plataforma disponibiliza ao Produtor ferramentas tecnológicas para: (i) cadastro e divulgação de eventos;
              (ii) recebimento de inscrições e venda de ingressos; (iii) gestão de jurados, cronograma, marcação de palco
              e apuração de resultados; (iv) emissão de certificados; (v) integração com infraestrutura financeira de
              terceiros (Asaas) para processamento de pagamentos.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">3. Processamento financeiro — Asaas</h2>
            <p>
              Os serviços financeiros e de pagamentos (abertura de conta de pagamento, processamento de transações,
              emissão de boletos, PIX, transferências e demais movimentações) são prestados pelo
              <strong> ASAAS GESTÃO FINANCEIRA S.A.</strong>, instituição de pagamento autorizada pelo Banco Central do Brasil.
              A CoreoHub atua exclusivamente como integradora tecnológica, não realizando intermediação financeira em nome próprio.
              O Produtor declara ciência de que o relacionamento financeiro é estabelecido diretamente com o Asaas, mediante
              abertura de subconta vinculada à conta principal da CoreoHub.
            </p>
            <div className="mt-3 flex justify-center">
              <AsaasBadge variant="compact" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">4. Comissão da plataforma</h2>
            <p>
              A CoreoHub cobra comissão sobre cada inscrição paga, conforme configuração ativa do evento ao tempo da venda.
              A comissão é aplicada via mecanismo de split de pagamento no Asaas: a parte do Produtor é creditada diretamente
              em sua subconta; a parte da CoreoHub é creditada em conta da Plataforma. O Produtor é o único responsável por
              definir os preços de inscrição e tributação aplicável às suas receitas.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">5. Taxas bancárias do parceiro financeiro Asaas</h2>
            <p className="mb-2">
              5.1. Para o processamento de pagamentos, será aberta conta digital exclusiva em nome do Produtor no <strong>ASAAS GESTÃO FINANCEIRA S.A.</strong> (CNPJ 19.540.550/0001-21), instituição financeira autorizada pelo Banco Central, parceira financeira da CoreoHub, mediante completude do procedimento de identificação (KYC).
            </p>
            <p className="mb-2">
              5.2. O Produtor declara estar ciente e de acordo que, sobre a abertura e utilização de sua conta digital, incidirão taxas <strong>cobradas exclusivamente pelo Asaas</strong> e <strong>não pela CoreoHub</strong>, conforme abaixo:
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mb-2">
              <li>
                <strong>Taxa de criação de conta bancária: R$ 12,90 (única).</strong> Cobrada uma única vez pelo Asaas no momento da criação da conta digital. Será descontada automaticamente do primeiro recebimento aprovado do Produtor.
              </li>
              <li>
                <strong>Demais taxas eventualmente aplicáveis</strong> (saque para conta bancária externa, estorno, chargeback, MED, e outros serviços) seguem o regulamento oficial do Asaas vigente, disponível em <a href="https://www.asaas.com/precos-e-taxas" target="_blank" rel="noopener noreferrer" className="text-[#ff0068] underline">asaas.com/precos-e-taxas</a>.
              </li>
            </ul>
            <p className="mb-2">
              5.3. A CoreoHub <strong>não cobra</strong> do Produtor taxas adicionais de processamento de pagamento (PIX, boleto, cartão) — tais custos são absorvidos pela CoreoHub como parte do serviço da Plataforma. A comissão devida à CoreoHub, regida pela cláusula 4, é cobrada exclusivamente como serviço da Plataforma e independe das taxas bancárias do Asaas.
            </p>
            <p>
              5.4. As taxas do Asaas podem ser reajustadas pela instituição financeira mediante prévio aviso aos seus correntistas. A CoreoHub se compromete a comunicar reajustes assim que tomar ciência, mas não tem ingerência sobre tais valores nem responsabilidade por seu reajuste.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">6. Prazo de liberação dos repasses (janela D+7)</h2>
            <p className="mb-2">
              6.1. Os valores líquidos devidos ao Produtor (resultado do pagamento aprovado, líquido da comissão da Plataforma e taxas Asaas)
              permanecem retidos na subconta Asaas do Produtor por um período de <strong>7 (sete) dias corridos</strong> contados da
              confirmação do pagamento. Decorrido esse prazo, a Plataforma dispara automaticamente a transferência do saldo
              liberado para a chave PIX cadastrada pelo Produtor.
            </p>
            <p className="mb-2">
              6.2. A janela de 7 dias tem por finalidade <strong>preservar saldo suficiente</strong> para o processamento integral de
              eventuais reembolsos (art. 49 do CDC), estornos solicitados ao Asaas, devoluções via MED do PIX e contestações
              de cartão (chargebacks) — evitando que o Produtor precise repor valores do próprio bolso para honrar reembolsos
              legítimos.
            </p>
            <p className="mb-2">
              6.3. <strong>Antecipação manual ("Transferir agora"):</strong> a Plataforma disponibiliza no painel do Produtor a opção
              de antecipar a transferência do saldo retido a qualquer momento, antes do encerramento da janela de 7 dias, sem custo adicional.
              Caso ocorra reembolso, estorno, MED ou chargeback nas vendas correspondentes após a antecipação e o saldo da subconta Asaas
              for insuficiente para cobrir o valor devolvido, a <strong>CoreoHub absorve temporariamente</strong> o gap como garantidora
              da subconta BaaS e recupera o valor automaticamente nos próximos pagamentos recebidos do Produtor, conforme mecanismo padrão
              de subcontas BaaS Asaas. O Produtor <strong>não precisa enviar PIX manual</strong> para a Plataforma neste cenário.
              Aplica-se subsidiariamente a autorização expressa de débito automático prevista na cláusula 7 para casos excepcionais
              em que o Produtor deixe de operar antes da recuperação completa do gap.
            </p>
            <p>
              6.4. A janela de 7 dias e o mecanismo de antecipação podem ser ajustados pela Plataforma mediante prévio aviso ao
              Produtor, em especial para acomodar exigências regulatórias, mudanças no contrato com o Asaas ou ajustes
              operacionais relacionados à mitigação de risco de fraude.
            </p>
          </section>

          <section className="border-l-4 border-amber-500 pl-4 bg-amber-50/50 dark:bg-amber-500/5 py-3 rounded-r-xl">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-2">
              <AlertTriangle size={14} /> 7. Chargebacks, estornos e reembolsos
            </h2>
            <p className="mb-2">
              <strong>O Produtor é integralmente responsável</strong> pelos valores devidos em razão de chargebacks (contestação
              direto na bandeira do cartão), estornos (reembolsos solicitados ao Asaas) e devoluções via MED (Mecanismo Especial
              de Devolução do PIX) das vendas vinculadas aos seus eventos.
            </p>
            <p className="mb-2">
              Caso o saldo da subconta do Produtor seja insuficiente para cobrir tais valores no momento da contestação, o Asaas
              aplicará débito automático nos próximos créditos do Produtor, conforme contrato BaaS Asaas. Se o
              saldo permanecer negativo, o Produtor obriga-se a regularizar a pendência via PIX <strong>em até 7 (sete) dias corridos</strong>,
              contados da notificação enviada pela CoreoHub.
            </p>
            <p className="mb-2">
              <strong>Autorização expressa de débito:</strong> o Produtor autoriza desde já que a CoreoHub utilize o mecanismo de
              débito automático do Asaas para compensar valores em aberto, incluindo, mas não se limitando a, ressarcimento de
              chargebacks, estornos, multas regulatórias e ajustes operacionais relacionados às suas vendas.
            </p>
            <p className="mb-2">
              Caso o Produtor permaneça inadimplente, a CoreoHub poderá: (i) suspender a criação de novos eventos ou novas
              vendas até regularização; (ii) reter valores futuros creditados em qualquer subconta de titularidade do Produtor
              vinculada à CoreoHub; (iii) acionar as medidas legais cabíveis para cobrança.
            </p>
            <p>
              <strong>Reembolsos devem ser processados exclusivamente pelo painel da Plataforma.</strong> O Produtor compromete-se a
              não realizar reembolsos diretos ao bailarino (via PIX pessoal, transferência bancária ou qualquer canal externo)
              sem registro correspondente na CoreoHub. Reembolsos out-of-band <strong>não dispensam a comissão</strong> devida à
              Plataforma, podem gerar inconsistência entre saldo Asaas e carteira CoreoHub, e dificultam a defesa em eventual
              chargeback. Casos excepcionais (ex: bailarino sem acesso ao método original) devem ser comunicados previamente à
              CoreoHub via canal de suporte.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">8. Política de reembolso ao comprador</h2>
            <p>
              Em conformidade com o art. 49 do Código de Defesa do Consumidor (Lei 8.078/90), o comprador (inscrito ou
              espectador) tem direito a reembolso integral em até <strong>7 (sete) dias corridos</strong> contados da data da compra,
              independentemente de justificativa. Após esse prazo, a política de reembolso fica a critério do Produtor, devendo
              ser comunicada de forma clara nas comunicações com o público.
            </p>
            <p className="mt-2">
              O Produtor obriga-se a honrar reembolsos legítimos dentro do prazo legal de 7 dias. Em caso de descumprimento,
              a CoreoHub poderá processar o reembolso diretamente debitando da subconta do Produtor.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">9. Obrigações do Produtor</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Fornecer informações verdadeiras, completas e atualizadas sobre si e sobre seus eventos.</li>
              <li>Cumprir as exigências de KYC (Know Your Customer) do Asaas, fornecendo documentação solicitada.</li>
              <li>Realizar eventos efetivamente nas datas e locais divulgados ou, em caso de cancelamento, processar reembolsos.</li>
              <li>Não utilizar a Plataforma para atividades ilícitas, fraudulentas, ou que violem normas do Banco Central do Brasil.</li>
              <li>Manter atualizada a chave PIX da subconta Asaas para recebimento de repasses.</li>
              <li>Comunicar imediatamente à CoreoHub e ao Asaas qualquer suspeita de fraude ou incidente operacional.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">10. Dados pessoais (LGPD)</h2>
            <p>
              O tratamento de dados pessoais coletados pela Plataforma observa a Lei Geral de Proteção de Dados
              (Lei 13.709/2018). O Produtor atua como controlador dos dados de seus inscritos, espectadores e bailarinos,
              enquanto a CoreoHub atua como operadora. Compartilhamento com o Asaas é realizado conforme necessário para
              prestação dos serviços financeiros, em conformidade com a Política de Privacidade do Asaas.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">11. Suspensão e encerramento</h2>
            <p>
              A CoreoHub poderá suspender ou encerrar o acesso do Produtor a qualquer tempo, sem aviso prévio, em caso de
              descumprimento deste Termo, inadimplência, suspeita de fraude, determinação de autoridade competente ou
              encerramento da parceria com o Asaas. O encerramento não exime o Produtor das obrigações financeiras pendentes.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white mb-2">12. Foro</h2>
            <p>
              Fica eleito o foro da comarca de <strong>Votuporanga / SP</strong> para dirimir quaisquer controvérsias decorrentes
              deste Termo, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
            </p>
          </section>

          <section className="text-[11px] text-slate-500 dark:text-slate-400 italic border-t border-slate-200 dark:border-white/10 pt-4">
            <p>
              Este Termo entra em vigor a partir do aceite eletrônico registrado, e permanece válido enquanto o
              Produtor mantiver cadastro ativo na Plataforma. Versão atual: <strong>{TERMO_PRODUTOR_VERSION}</strong>.
              Em caso de atualização do Termo, o Produtor será solicitado a aceitar a nova versão antes de prosseguir
              com ações relevantes.
            </p>
          </section>
        </article>

        {/* Bloco de aceite — só aparece se ainda não aceitou ou se versão mudou */}
        {!isCurrentVersionAccepted && (
          <div className="bg-white dark:bg-slate-900/60 border-2 border-[#ff0068]/30 rounded-3xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="text-[#ff0068] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-1">
                  Aceite necessário
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  O aceite deste Termo é obrigatório para conectar sua conta Asaas e começar a receber pagamentos.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 cursor-pointer hover:border-[#ff0068]/40 transition-all">
              <input
                type="checkbox"
                checked={checkbox}
                onChange={e => setCheckbox(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#ff0068] cursor-pointer"
              />
              <span className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
                Li e aceito integralmente o Termo de Adesão do Produtor versão <strong>{TERMO_PRODUTOR_VERSION}</strong>,
                incluindo a cláusula 5 (taxas bancárias do Asaas, taxa única de criação de conta R$ 12,90),
                a cláusula 6 (janela de 7 dias para liberação dos repasses e antecipação manual sob risco) e
                a cláusula 7 (ressarcimento de chargebacks/estornos e autorização de débito automático no Asaas).
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-[11px] text-rose-700 dark:text-rose-400">
                <AlertTriangle size={12} className="shrink-0" /> {error}
              </div>
            )}

            <button
              onClick={handleAccept}
              disabled={!checkbox || accepting}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
            >
              {accepting ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle2 size={16} /> Aceitar e continuar</>}
            </button>
          </div>
        )}

        {isCurrentVersionAccepted && (
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-3xl p-5 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-black uppercase tracking-tight text-emerald-700 dark:text-emerald-400">
                  Termo aceito
                </p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-300 mt-0.5">
                  Você aceitou a versão {TERMO_PRODUTOR_VERSION} em {formatDate(acceptedAt!)}.
                </p>
              </div>
            </div>

            {/* CTAs pós-aceite — direciona produtor pra próxima ação relevante.
                Primário: conectar conta Asaas (motivo provável de ter chegado aqui).
                Secundário: voltar pro painel. */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-5 space-y-3">
              <div>
                <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  Próximo passo
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Configure sua conta de recebimento pra começar a receber pagamentos das inscrições.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => navigate('/account-settings')}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
                >
                  <CreditCard size={13} /> Configurar conta Asaas <ArrowRight size={13} />
                </button>
                <button
                  onClick={() => navigate('/qg-organizador')}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all"
                >
                  <Home size={13} /> Ir pro Painel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TermoProdutor;
