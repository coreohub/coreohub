-- Nome exibido de cada faixa de premiação (Ouro/Prata/Bronze por padrão) vira
-- configurável por evento. Ex: 19° Festival Ecodança usa "1º/2º/3º Lugar" no
-- regulamento oficial (seção 15), não "medalhas" — mas o MECANISMO continua
-- sendo THRESHOLD (faixa de nota mínima, múltiplos ganhadores possíveis),
-- só o texto do rótulo muda. Nulo = comportamento de sempre (Ouro/Prata/
-- Bronze/Participação), nenhum evento existente muda de comportamento.
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS medal_labels jsonb;

NOTIFY pgrst, 'reload schema';
