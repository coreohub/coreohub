# Rascunho: Termo do Produtor sem antecipação do saldo retido

Data: 2026-10-19. Status: TEXTO FECHADO (decisões do produtor na seção 6), sem revisão de advogado por decisão dele. Nada foi alterado em `pages/TermoProdutor.tsx`, nenhuma versão foi publicada, o gate está desligado.

Origem: decisão do produtor (2026-10-19) de tirar a antecipação grátis e imediata do saldo retido, porque, se houver estorno depois do saque, o estorno pode falhar (a Asaas respondeu que a conta principal não cobre sozinha a falta de saldo da subconta) ou a master absorve o prejuízo (o que a 12.3 de hoje promete). Contexto e pesquisa em `memory/repasse_baixo_valor_painel_antecipacao_2026_10_19.md`.

## 1. Onde isso entra

A versão 1.9 (cartão parcelado, cláusulas 11.10 a 11.13) já está escrita nos commits da `dev` e ainda não foi publicada (a `main` está na 1.8). A remoção da antecipação deve entrar **nessa mesma 1.9**, pra o produtor aceitar uma vez só. Se a 1.9 sair antes deste texto, ele vira a 1.10 e o gate usa `'1.10'`.

Tamoios (Danielle) fica de fora: o aceite é por produtor (`profiles.producer_terms_version`), então ela segue na versão que aceitou, com a 12.3 antiga, até criar evento novo e aceitar a versão nova.

## 2. Texto proposto

### 12.3 (substitui a atual)

> 12.3. **Transferência do saldo liberado.** A Plataforma não oferece antecipação de valores que ainda estejam dentro da janela de 7 (sete) dias. O saldo que já passou da janela é transferido automaticamente para a chave PIX cadastrada pelo Produtor, e o Produtor pode também pedir a transferência imediata desse saldo liberado pelo painel ("Transferir agora"), sem custo adicional. O saldo ainda retido só é liberado ao fim da janela.

### 12.4 (ajuste mínimo: tira "e o mecanismo de antecipação")

> 12.4. A janela de 7 dias pode ser ajustada pela Plataforma mediante prévio aviso ao Produtor, em especial para acomodar exigências regulatórias, mudanças no contrato com o Asaas ou ajustes operacionais relacionados à mitigação de risco de fraude.

### Parágrafo 12.5 (antecipação sob análise): NÃO incluído

Era opcional (modelo Sympla: antecipação paga, parcial, com análise de risco). Recomendação e decisão: **não incluir**. Motivos: o produtor não quer risco pra master; um parágrafo assim cria expectativa de direito e ainda precisaria de preço, teto e regra de reversão; hoje não há produtor ativo que precise de caixa antes. Se algum dia aparecer, trata-se por acordo escrito pontual, fora do Termo, e só então se decide se vira cláusula.

### Resumo do aceite (linha ~580 de `TermoProdutor.tsx`)

De: "a cláusula 12 (janela de 7 dias para liberação dos repasses e antecipação manual sob risco)"
Para: "a cláusula 12 (janela de 7 dias para liberação dos repasses e transferência do saldo liberado)".

## 3. A contradição que o texto novo resolve

Na v1.9 as cláusulas se contradizem: a **11.12** diz que o Produtor autoriza a CoreoHub a debitar ou cobrar os valores já repassados e antecipados em caso de estorno (aplicando a cláusula 8), e a **12.3 de hoje** diz que a CoreoHub "absorve temporariamente o gap" e que o Produtor "não precisa enviar PIX manual". Sem a promessa de absorção, a 12.3 nova deixa de contradizer a 11.12 e a 13 (débito automático e reposição em 7 dias).

Ponto residual na 11.12: a palavra "antecipados" ali se refere à antecipação dos recebíveis do cartão parcelado pela instituição financeira (cláusula 11.11), não ao saldo retido. Sugestão: escrever "antecipados (cláusula 11.11)" pra não ser lida como antecipação do saldo.

## 4. O que mais precisa mudar pra tudo sair coerente (fora do Termo)

| Onde | O que fazer |
|---|---|
| `pages/LandingPage.tsx:796` (FAQ) | A frase "Quer o dinheiro antes do prazo? O botão 'Transferir agora' antecipa o saldo..., sem taxa" passa a dizer que o botão envia na hora o saldo que já passou dos 7 dias. |
| `pages/LandingEspetaculo.tsx:61` e `api/og-marketing.ts:70` | Mesma frase ("Quer o dinheiro antes? ... antecipa o saldo"). Os dois precisam mudar juntos: o teste `tests/marketing-faq-parity.test.ts` exige paridade entre a página e o que os bots recebem. |
| `components/ProducerBalanceCard.tsx` | O link "Antecipar também o que está a liberar" e o modal de risco (escopo `'all'`) devem sumir pra quem aceitou a versão nova. Hoje o servidor já recusa, mas o botão ainda apareceria. O card precisa conhecer a versão do Termo do produtor. |
| `supabase/functions/_shared/transfer-scope.ts` | `EARLY_PAYOUT_OFF_MIN_TERMS_VERSION` passa de `null` para `'1.9'` (ou `'1.10'`). Só depois de o Termo estar publicado. |
| `utils/termoVersion.ts` | Bump da versão (ver seção 1). |
| Memória e `docs/HISTORICO.md` | Registrar a versão publicada e quem já aceitou. |

## 5. Ordem de publicação sugerida

1. Texto aprovado (e revisado por advogado, se o produtor quiser).
2. Incorporar as cláusulas na versão que for sair (1.9 junto com o parcelado).
3. Atualizar FAQ, página do Espetáculo e `og-marketing` na mesma publicação, com o teste de paridade verde.
4. Publicar o Termo. Produtores só passam a ver o aceite (gate de criar evento e aviso do painel).
5. Ligar o gate (`transfer-scope.ts`) e esconder o link de antecipar no card, **depois** de a versão estar publicada. Quem ainda não aceitou continua com o direito da 12.3 antiga.
6. Conferir com uma conta de teste que já aceitou: `scope: 'all'` volta `early_payout_disabled` e o painel não mostra o link.

## 6. Decisões (produtor, 2026-10-19)

1. **Parágrafo 12.5:** fora do Termo (seção 2). Recomendado e aprovado.
2. **Advogado:** não passa por advogado.
3. **Aviso aos produtores com evento ativo:** não há produtor ativo, só a Lorrayne (Vicenza/Lyris), que deve a taxa de plano de 2 eventos e está com a trava de criar evento. Recomendação: sem aviso em massa. O aceite da versão nova já aparece sozinho (gate de criar evento e aviso do painel), e ela precisa aceitar de qualquer jeito. Vale uma mensagem curta e avulsa a ela quando a versão sair, dizendo que o botão "Transferir agora" passa a enviar só o saldo que já passou dos 7 dias.
4. **Versão:** entra **na 1.9 junto com o parcelado**. A 1.9 ainda não foi publicada e ninguém a aceitou, então o produtor aceita uma vez só. Só vira 1.10 se a 1.9 sair antes deste texto ficar pronto.

## 7. Dependência com o parcelado (outra sessão: liberar até 3x pros produtores)

- A publicação do Termo e a liberação do 3x devem sair juntas, porque são a mesma versão.
- **Antes de publicar, a outra sessão precisa confirmar como o parcelado grava a venda em `platform_commissions`** (`release_at`, `card_credit_at`, uma linha por venda ou por parcela). O card "Seus repasses" e o `manual-transfer-now` dependem desses campos: se o parcelado antecipado entrar com datas diferentes das esperadas, "A liberar" e "Disponível" mostrariam valores errados. Eu não verifiquei isso.
- O parcelado aumenta a exposição a estorno (a 11.11 diz que a CoreoHub antecipa o líquido ao produtor), o que reforça a retirada da antecipação do saldo retido.
