-- 19° Festival Ecodança (Bheto): "Solo Masculino" já existe numa inscrição
-- real ("A última dança", regulamento seção correspondente confirma que é
-- classe própria, não erro de digitação) mas nunca foi cadastrado em
-- events.formacoes_config — então não tem preço/lote configurado e não
-- aparece em Configurações → Formações. Adiciona espelhando o preço do
-- "Solo" comum (R$130, mesma janela de tempo/min-max de integrantes).

UPDATE events
SET formacoes_config = formacoes_config || jsonb_build_array(jsonb_build_object(
  'id', (extract(epoch from now()) * 1000)::bigint::text,
  'name', 'Solo Masculino',
  'pricing_type', 'FIXED',
  'base_fee', 130,
  'fee', 130,
  'min_members', 1,
  'max_members', 1,
  'max_time', '03:00',
  'is_active', true,
  'lotes', jsonb_build_array(jsonb_build_object('preco', 130, 'data_virada', null))
))
WHERE id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(formacoes_config) f
    WHERE f->>'name' = 'Solo Masculino'
  );

NOTIFY pgrst, 'reload schema';
