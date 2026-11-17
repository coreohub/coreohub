Continuação da auditoria de segurança da CoreoHub, Lote 3.

Leia nesta ordem antes de agir: `CLAUDE.md`, `memory/_operating_manual.md`, `memory/session_resume.md`, `memory/auditoria_lote2_estado_2026_11_16.md` e `docs/auditoria/LOTE3-pendencias.md` (a lista ordenada do que falta; os críticos e altos já estão em produção nos Lotes 1 e 2).

REGRAS FIXAS
- Só opere com a conta `teste.produtor@coreohub.com` (id `1f0af744-1289-4948-bf41-3e9b27c142a3`) e seus eventos de teste `752366ed-6e90-44e7-bec5-1cee38031503` e `f8d9451a-847e-490b-ad70-289f12c0f562`. Jurado de teste: "[TESTE] Jurado Auditoria", PIN 4827. Nunca toque evento real (Usualdance, Level Up da Monique). Nunca `is_demo=true`. Apague por SQL tudo que criar e confira no banco. Nunca mostre valor de segredo (nem digest).
- Deploy de edge function e migration valem para produção na hora e não há staging. Antes de QUALQUER deploy ou migration de dinheiro, login ou RLS, rode `node scripts/pre-deploy-check.mjs --strict`: só prossiga com saída 0 (plataforma parada e os 4 modos como esperado). Se houver venda, só leitura. Peça meu OK para cada deploy.
- Dinheiro, login e RLS: apresente o plano em 3 a 5 pontos e espere meu OK antes de codar. Código novo que mexe em dinheiro nasce atrás de um modo (off/observe/dry/on/enforce) quando fizer sentido. Cada correção tem saída de emergência e script de reversão.
- A `dev` é compartilhada com outras sessões. Nunca `git add -A`, nunca push da `dev` inteira. Para publicar na `main`, só com meu OK explícito a cada push, por cherry-pick dos MEUS commits em worktree limpo a partir da `origin/main` (ex.: `D:\tmp\CoreoHub-wh`), depois de rodar o pre-deploy-check. Se o `docs/HISTORICO.md` conflitar, mantenha só as minhas entradas.
- Não mexa nos arquivos da outra sessão: mapa de assentos e modo claro (`components/SeatGrid.tsx`, `SeatLegend.tsx`, `SeatZoneLegend.tsx`, `SeatZoneSelection.tsx`, `pages/CheckoutIngresso.tsx`, `utils/zoneColor.ts`, e o que estiver não commitado de assentos/tema).
- Pesquisa de mercado só com referências brasileiras. "A CoreoHub" no feminino. Responda sempre em português do Brasil, curto, e diga com clareza o que NÃO foi verificado.
- Migrations: use `supabase/migrations/_template.sql` (GRANT + RLS), aplique com `npx supabase db query --linked --yes --file <path>`, versionadas, com `passoN-teste.sql` que desfaz sozinho e `passoN-reverter.sql`. Teste sem tocar evento real.

COMO TRABALHAR
1. Primeiro passo, sem mudar nada: reverifique no banco e no código da `main` os itens marcados "verificar" em `LOTE3-pendencias.md` (A3, A4, B6, B8, D4) e me diga quais já estavam resolvidos. Atualize o arquivo com o resultado.
2. Depois siga a "Ordem sugerida" do arquivo, UM lote por vez. Antes de cada lote, me mostre o plano (3 a 5 pontos, o que muda, risco, como reverter, se precisa de janela calma) e espere meu OK.
3. Em cada item: implemente, rode `npm run lint`, `npm test` e `npm run build`, teste em sandbox/evento de teste, só então peça OK para o deploy.
4. Ao fechar um item: registre em `docs/HISTORICO.md` (entrada nova no fim, nunca no CLAUDE.md), atualize `memory/auditoria_lote2_estado_2026_11_16.md` e commite na `dev` só os seus arquivos.
5. Pendências de calendário que não dependem de você: (a) o primeiro repasse real de New Ritmo ou Compete'art, por volta de 22/11, para conferir `payout_attempts`, `subconta_fee_charges` e o extrato da Asaas (R$ 12,90 saindo da subconta; `SUBCONTA_FEE_MODE=on` foi ligado em 2026-11-17 sem ter visto um repasse em `dry`; saída de emergência: `supabase secrets set SUBCONTA_FEE_MODE=off --project-ref ghpltzzijlvykiytwslu --yes`); (b) `PAYMENT_CHECK_MODE=enforce` só depois de 2026-11-29 sem falso positivo e depois dos pré-requisitos do Fable.

Comece confirmando o estado dos modos (`node scripts/pre-deploy-check.mjs --strict`) e executando o passo 1. Me diga o resultado e qual lote você recomenda primeiro.
