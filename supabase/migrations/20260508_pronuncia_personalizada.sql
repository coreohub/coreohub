-- =====================================================================
-- IA de Narração — Pronúncia Personalizada
-- =====================================================================
-- Gemini 2.5 TTS detecta lingua pelo conteudo do texto. Termos
-- estrangeiros (ex: "Usualdance Festival") sao lidos com sotaque
-- ingles, quebrando a locucao PT-BR.
--
-- Solucao: produtor cadastra mapa de termo -> pronuncia fonetica
-- (ex: "Usualdance" -> "Iuzual Dânce"). Antes de mandar pro TTS,
-- frontend aplica replaceAll() do mapa no texto.
--
-- Schema: jsonb array de pares { termo: string, pronuncia: string }
-- (array em vez de object pra preservar ordem e permitir UI drag-drop).
-- =====================================================================

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS pronuncia_personalizada JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN configuracoes.pronuncia_personalizada IS 'Mapa de substituicoes fonéticas pra IA de narracao. Ex: [{"termo":"Usualdance","pronuncia":"Iuzual Dânce"}]. Aplicado antes de chamar o TTS.';

NOTIFY pgrst, 'reload schema';
