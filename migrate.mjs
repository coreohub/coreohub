/**
 * migrate.mjs — Migração dos 3 Eixos (Gênero/Subgênero/Formação)
 *
 * Estratégia:
 *   1. Lê event_styles existentes e converte sub_types de string[] → objeto rico[]
 *   2. Tenta adicionar coluna is_categoria_livre na tabela subcategories via Management API
 *   3. Se falhar (sem token), imprime o SQL para rodar manualmente
 *
 * Uso:   node migrate.mjs [SUPABASE_ACCESS_TOKEN]
 *        (token opcional — obtido em https://supabase.com/dashboard/account/tokens)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://ghpltzzijlvykiytwslu.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdocGx0enppamx2eWtpeXR3c2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDAyNjEsImV4cCI6MjA4NTg3NjI2MX0.AshAXh_5Dn2S3E74XbnDtxnb92kER8tAxEdZmKnywG8';
const PROJECT_REF      = 'ghpltzzijlvykiytwslu';
const ACCESS_TOKEN     = process.argv[2] || null;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ─── SQL da migração ────────────────────────────────────────────────────── */
const MIGRATION_SQL = `
-- ============================================================
-- MIGRAÇÃO: 3 EIXOS — Gênero / Subgênero / Formação
-- Execute no Supabase SQL Editor se o script automático falhar
-- ============================================================

-- 1. Adiciona coluna is_categoria_livre em subcategories (se não existir)
ALTER TABLE public.subcategories
  ADD COLUMN IF NOT EXISTS is_categoria_livre BOOLEAN DEFAULT FALSE;

-- 2. Limpa sub_types misturados em event_styles (opcional – dados legados)
--    O frontend vai gravar o novo formato automaticamente ao salvar em Configurações.

-- 3. Índice para performance de busca por gênero
CREATE INDEX IF NOT EXISTS idx_subcategories_style_id
  ON public.subcategories (event_id);
`;

/* ─── converte sub_types legados para o novo formato ─────────────────────── */
function normalizeSubTypes(rawSubTypes) {
  if (!rawSubTypes || !Array.isArray(rawSubTypes)) return [];
  return rawSubTypes.map(item => {
    if (typeof item === 'string') {
      // Heurística: se for palavra de formação conhecida, ignora (era dado misturado)
      const formacoes = ['solo', 'duo', 'trio', 'conjunto', 'grupo', 'quarteto'];
      if (formacoes.includes(item.toLowerCase())) return null;
      return { name: item, is_categoria_livre: false };
    }
    // já está no formato novo
    if (item && typeof item === 'object' && item.name) return item;
    return null;
  }).filter(Boolean);
}

async function runMigration() {
  console.log('\n🚀 CoreoHub — Migração dos 3 Eixos\n');

  /* ── 1. Tenta rodar DDL via Management API ───────────────────────────── */
  if (ACCESS_TOKEN) {
    console.log('🔑 Token encontrado. Tentando rodar SQL via Management API...');
    try {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: MIGRATION_SQL }),
        }
      );
      if (res.ok) {
        console.log('✅ DDL executado com sucesso via Management API!\n');
      } else {
        const err = await res.text();
        console.warn(`⚠️  Management API retornou erro: ${err}`);
        printManualSQL();
      }
    } catch (e) {
      console.warn('⚠️  Falha na Management API:', e.message);
      printManualSQL();
    }
  } else {
    console.log('ℹ️  Sem token. Pulando DDL automático.');
    printManualSQL();
  }

  /* ── 2. Lê event_styles existentes ───────────────────────────────────── */
  console.log('\n📖 Lendo event_styles existentes...');
  const { data: styles, error: stylesErr } = await supabase
    .from('event_styles')
    .select('*');

  if (stylesErr) {
    console.error('❌ Erro ao ler event_styles:', stylesErr.message);
    console.log('   (Verifique se a tabela existe e se o RLS está configurado corretamente)');
    return;
  }

  if (!styles || styles.length === 0) {
    console.log('ℹ️  Nenhum event_style encontrado. Nada a migrar.\n');
    return;
  }

  console.log(`   Encontrados ${styles.length} gênero(s).`);

  /* ── 3. Converte sub_types legados e atualiza ─────────────────────────── */
  let migrated = 0;
  let skipped  = 0;

  for (const style of styles) {
    const raw = style.sub_types;

    // Verifica se já está no novo formato
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0].name) {
      console.log(`   ⏭  "${style.name}" — já no novo formato, pulando.`);
      skipped++;
      continue;
    }

    const converted = normalizeSubTypes(raw);

    const { error: upErr } = await supabase
      .from('event_styles')
      .update({
        sub_types: converted,
        requires_subcategory: converted.length > 0,
      })
      .eq('id', style.id);

    if (upErr) {
      console.warn(`   ⚠️  Erro ao migrar "${style.name}":`, upErr.message);
    } else {
      console.log(`   ✅ "${style.name}" migrado → ${JSON.stringify(converted)}`);
      migrated++;
    }
  }

  console.log(`\n📊 Resultado: ${migrated} migrado(s), ${skipped} já atualizados.\n`);
  console.log('✨ Migração de dados concluída! O sistema já pode usar o novo formato.\n');
}

function printManualSQL() {
  console.log('\n──────────────────────────────────────────────────────');
  console.log('📋 SQL PARA RODAR MANUALMENTE NO SUPABASE SQL EDITOR:');
  console.log('   https://supabase.com/dashboard/project/ghpltzzijlvykiytwslu/sql');
  console.log('──────────────────────────────────────────────────────');
  console.log(MIGRATION_SQL);
  console.log('──────────────────────────────────────────────────────\n');
}

runMigration().catch(e => {
  console.error('❌ Erro inesperado:', e);
  process.exit(1);
});
