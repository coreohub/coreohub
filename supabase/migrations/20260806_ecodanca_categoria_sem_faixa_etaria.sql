-- 19° Festival Ecodança (Bheto): registrations.categoria foi importado com o
-- texto descritivo inteiro do regulamento ("Infantil - de 7 a 12 anos"), não
-- o nome curto já configurado em configuracoes.categorias ("Infantil"). Isso
-- fazia Cronograma/Apuração mostrarem a faixa etária em toda linha — pesquisa
-- de mercado (DanceComp Genie/CompetitionSuite) confirma que telas
-- operacionais usam nome curto, a faixa numérica é só dado de elegibilidade.
-- Normaliza pro nome curto oficial. ELSE mantém intocado qualquer valor que
-- não bata com nenhum padrão conhecido (nunca apaga dado por engano).

UPDATE registrations
SET categoria = CASE
  WHEN categoria ILIKE 'infantil%'      THEN 'Infantil'
  WHEN categoria ILIKE 'juvenil%'       THEN 'Juvenil'
  WHEN categoria ILIKE 'mista%'         THEN 'Mista'
  WHEN categoria ILIKE 'amador%'        THEN 'Amador'
  WHEN categoria ILIKE 'baby%'          THEN 'Baby Class'
  WHEN categoria ILIKE 'melhor idade%'  THEN 'Melhor Idade'
  WHEN categoria ILIKE 'ecotema%'       THEN 'Ecotema'
  ELSE categoria
END
WHERE event_id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05';

NOTIFY pgrst, 'reload schema';
