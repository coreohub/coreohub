// Resumo do que mudou no Termo do Produtor, por versão aceita. Fica fora do componente pra ser testado.
import { termsVersionAtLeast } from '../supabase/functions/_shared/terms-version';

export type Bullet = { title: string; text: string; clauses: string };

// Novidade da 1.10: vale para todos, inclusive quem já aceitou a 1.9.
const BULLET_V110: Bullet = {
  title: 'Transferência do saldo liberado',
  text: 'O botão "Transferir agora" passa a enviar só o saldo que já passou dos 7 dias de retenção. Não há mais antecipação do saldo ainda retido. O saldo liberado continua indo automaticamente para o seu PIX, sem custo.',
  clauses: 'cláusulas 12.3 e 12.4',
};

// Novidades da 1.9: só quem aceitou uma versão anterior à 1.9 (ou nunca aceitou) precisa vê-las.
const BULLETS_V19: Bullet[] = [
  {
    title: 'Taxa de pagamento',
    text: 'Quando ativada no seu evento, o comprador paga uma taxa discriminada no Pix e no cartão. Você recebe o mesmo valor líquido de hoje.',
    clauses: 'cláusulas 11.3 a 11.9',
  },
  {
    title: 'Cartão parcelado',
    text: 'O comprador pode parcelar até o limite do seu evento, com a taxa de parcelamento paga por ele. Você recebe o valor líquido da venda integralmente quando a antecipação é aprovada.',
    clauses: 'cláusulas 11.10 e 11.11',
  },
  {
    title: 'Estornos e retenção',
    text: 'Estorno ou contestação de venda parcelada alcança o pedido inteiro e pode ser descontado do seu saldo. A CoreoHub pode reter o repasse de vendas parceladas até a realização do evento.',
    clauses: 'cláusulas 11.12 e 11.13',
  },
];

/** Resumo certo para cada produtor: quem está na 1.9 vê só o que a 1.10 mudou; os demais veem tudo. */
export function termoBullets(acceptedVersion: string | null | undefined): Bullet[] {
  return termsVersionAtLeast(acceptedVersion, '1.9') ? [BULLET_V110] : [...BULLETS_V19, BULLET_V110];
}

