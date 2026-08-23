-- A coluna configuracoes.intervalo_seguranca era usada por 2 campos diferentes
-- na UI do Cronograma: "Intervalo de Segurança entre Apresentações (s)"
-- (segundos, usado no cálculo de buffer de tempo/narração) e "Intervalo
-- Mínimo de Segurança de Bailarinos" (contagem de apresentações, usado pelo
-- algoritmo de "Gerar Ordem Inteligente" e pelo contador de conflitos).
-- Mexer num campo mexia visualmente no outro. Separando em coluna própria
-- pra não misturar mais os dois sentidos. intervalo_seguranca continua com
-- seu valor histórico (segundos) intacto — zero mudança de comportamento
-- pro buffer de tempo já calculado com esse valor.
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS intervalo_seguranca_bailarinos INTEGER;

NOTIFY pgrst, 'reload schema';
