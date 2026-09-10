-- Auditoria de código morto 2026-09-10, Fase 3 (colunas): 24 colunas sem
-- nenhuma referência em código (frontend, edge functions ou RPC/trigger SQL),
-- confirmadas caso a caso antes de apagar. Nenhuma delas apareceu em NENHUMA
-- migration versionada além da própria criação (ou nem isso) — resíduo do
-- schema inicial do scaffold "Dance Pro Festival", substituído por sistemas
-- mais flexíveis conforme o produto evoluiu.

-- Grupo 1 — 100% vazias, zero resíduo histórico
-- configuracoes: substituídas por formacoes_config, event_styles, categories,
-- regras_avaliacao, certificate_templates, live_registration_id/Telão
ALTER TABLE configuracoes DROP COLUMN IF EXISTS valor_inscricao_solo;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS valor_inscricao_conjunto;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS limite_inscricoes;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS estilos_permitidos;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS categorias_predefinidas;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS criterios_avaliacao;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS coreografia_atual_id;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS logica_destaque;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS certificado_template_url;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS certificado_tags_posicoes;
ALTER TABLE configuracoes DROP COLUMN IF EXISTS certificados_layouts;
-- coreografias.bailarinos_ids: substituída por elenco/bailarinos_detalhes
ALTER TABLE coreografias DROP COLUMN IF EXISTS bailarinos_ids;
-- judges.assigned_categories: sempre '[]' vazio, substituída por competencias_generos
ALTER TABLE judges DROP COLUMN IF EXISTS assigned_categories;
-- profiles.perfil_tipo: substituída por role
ALTER TABLE profiles DROP COLUMN IF EXISTS perfil_tipo;
-- registrations.nome_coreografo: 0 linhas com dado
ALTER TABLE registrations DROP COLUMN IF EXISTS nome_coreografo;
-- evaluations.audio_feedback_url: substituída por audio_url (usada em 5+ telas)
ALTER TABLE evaluations DROP COLUMN IF EXISTS audio_feedback_url;

-- Grupo 2 — com resíduo histórico pequeno, apagado junto (autorizado pelo produtor)
-- evaluations.final_score: migration 20260511 já documentava "substituído por
-- final_weighted_average"; 20 linhas antigas com valor (de 5075 avaliações)
ALTER TABLE evaluations DROP COLUMN IF EXISTS final_score;
-- evaluations.text_comments: migration 20260620 já documentava "nunca usado
-- por código", substituída por feedback_text; 20 linhas antigas
ALTER TABLE evaluations DROP COLUMN IF EXISTS text_comments;
-- payments/profiles sweep_*: mecanismo de auto-saque abandonado, substituído
-- por platform_commissions.release_at/released_at/release_transfer_id
-- (Settlement D+7, 2026-05-20); 1 linha residual em payments.swept_at
ALTER TABLE payments DROP COLUMN IF EXISTS swept_at;
ALTER TABLE payments DROP COLUMN IF EXISTS swept_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS swept_transfer_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS sweep_failure_count;
ALTER TABLE profiles DROP COLUMN IF EXISTS sweep_last_failure_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS sweep_notified_at;
