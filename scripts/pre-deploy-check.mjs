#!/usr/bin/env node
// Checagem de pre-deploy (somente leitura). Uso: node scripts/pre-deploy-check.mjs [--window=15] [--strict]
//
// Responde "posso deployar agora?" antes de subir edge function, migration ou qualquer coisa de dinheiro:
//   1. Atividade real na plataforma (vendas, reservas, inscricoes, comissoes, logins) - o banco e o sinal oficial.
//   2. Modos de seguranca ligados (confere o digest dos segredos com os valores esperados).
//   3. Estado do git (branch, arvore suja, atras/adiante da origin).
// Codigo de saida: 0 = pode, 2 = ha atividade (esperar), 3 = modo inesperado (so com --strict), 1 = erro na checagem.
// Nunca escreve no banco, nunca imprime valor de segredo.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROJECT_REF = 'ghpltzzijlvykiytwslu'
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const win = Number((args.find(a => a.startsWith('--window=')) ?? '--window=15').split('=')[1]) || 15
const win2 = Math.max(win * 2, 30)

// Modos esperados em producao (atualizar aqui e em memory/auditoria_lote2_estado quando mudarem).
const EXPECTED_MODES = {
  PAYMENT_CHECK_MODE: 'observe',   // enforce so depois de 2026-11-29 e sem falso positivo
  JUDGE_SESSION_MODE: 'enforce',
  PAYOUT_ATTEMPTS_MODE: 'on',
  SUBCONTA_FEE_MODE: 'on',     // ligado em 2026-11-17 (saida de emergencia: off)
}
const KNOWN_VALUES = ['off', 'observe', 'dry', 'on', 'enforce']

const sha256 = s => createHash('sha256').update(s).digest('hex')
const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })

function dbQuery(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'predeploy-'))
  const file = join(dir, 'q.sql')
  try {
    writeFileSync(file, sql)
    const out = run('npx', ['supabase', 'db', 'query', '--linked', '--read-only', '--file', `"${file}"`])
    const json = out.slice(out.indexOf('{'))
    return JSON.parse(json).rows
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let exit = 0
const bad = (code) => { if (exit === 0 || code < exit) exit = code }

console.log(`\n== Pre-deploy (janela ${win} min / ${win2} min) ==\n`)

// 1) Atividade
try {
  const rows = dbQuery(`
    select 'ingressos criados (${win}m)' k, count(*)::int v from audience_tickets where created_at > now() - interval '${win} minutes'
    union all select 'ingressos pagos (${win2}m)', count(*)::int from audience_tickets where status_pagamento='APROVADO' and updated_at > now() - interval '${win2} minutes'
    union all select 'ingressos pendentes/reservas (${win2}m)', count(*)::int from audience_tickets where status_pagamento='PENDENTE' and created_at > now() - interval '${win2} minutes'
    union all select 'inscricoes (${win2}m)', count(*)::int from registrations where created_at > now() - interval '${win2} minutes'
    union all select 'inscricoes de workshop (${win2}m)', count(*)::int from workshop_registrations where created_at > now() - interval '${win2} minutes'
    union all select 'comissoes (${win2}m)', count(*)::int from platform_commissions where created_at > now() - interval '${win2} minutes'
    union all select 'logins (${win}m)', count(*)::int from auth.users where last_sign_in_at > now() - interval '${win} minutes'
    union all select 'minutos desde a ultima venda', coalesce(round(extract(epoch from (now() - max(created_at))) / 60)::int, 99999) from audience_tickets
  `)
  let busy = false
  for (const r of rows) {
    const isLast = r.k.startsWith('minutos')
    const flag = !isLast && r.v > 0
    if (flag) busy = true
    console.log(`  ${flag ? 'ATIVO ' : 'ok    '} ${r.k}: ${r.v}`)
  }
  const last = rows.find(r => r.k.startsWith('minutos'))?.v ?? 99999
  if (last < win) busy = true
  console.log(busy ? '\n  => HA ATIVIDADE: nao deploye edge function/migration de dinheiro agora.' : '\n  => Plataforma parada.')
  if (busy) bad(2)
} catch (e) {
  console.log(`  ERRO ao consultar o banco: ${String(e.message).split('\n')[0]}`)
  bad(1)
}

// 2) Modos
console.log('\n== Modos de seguranca ==\n')
try {
  const out = run('npx', ['supabase', 'secrets', 'list', '--project-ref', PROJECT_REF])
  const digests = {}
  // Saida atual do CLI: JSON {"secrets":[{"name","value":<sha256>}]}. Mantem fallback para a tabela antiga "NOME | DIGEST".
  const start = out.indexOf('{')
  if (start >= 0) {
    for (const s of JSON.parse(out.slice(start)).secrets ?? []) digests[s.name] = String(s.value).toLowerCase()
  } else {
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*\|\s*([0-9a-f]{64})/i)
      if (m) digests[m[1]] = m[2].toLowerCase()
    }
  }
  for (const [name, want] of Object.entries(EXPECTED_MODES)) {
    const d = digests[name]
    if (!d) { console.log(`  ?     ${name}: segredo nao encontrado (esperado ${want})`); if (strict) bad(3); continue }
    const actual = KNOWN_VALUES.find(v => sha256(v) === d) ?? '(valor desconhecido)'
    const ok = actual === want
    console.log(`  ${ok ? 'ok   ' : 'DIFF '} ${name}: ${actual}${ok ? '' : ` (esperado ${want})`}`)
    if (!ok && strict) bad(3)
  }
} catch (e) {
  console.log(`  ERRO ao listar segredos: ${String(e.message).split('\n')[0]}`)
  bad(1)
}

// 3) Git
console.log('\n== Git ==\n')
try {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const dirty = run('git', ['status', '--porcelain']).split('\n').filter(Boolean).length
  run('git', ['fetch', '-q', 'origin'])
  const [behind, ahead] = run('git', ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]).trim().split(/\s+/).map(Number)
  console.log(`  branch: ${branch} | arquivos alterados: ${dirty} | atras da origin: ${behind} | a frente: ${ahead}`)
  if (branch !== 'main') console.log('  aviso: edge function e deployada da pasta local, nao da branch. Deploye so a partir de uma copia da main limpa (worktree).')
  if (dirty > 0) console.log('  aviso: arvore suja (pode ter trabalho de outra sessao). Nao use git add -A; publique so os seus commits por cherry-pick.')
} catch (e) {
  console.log(`  aviso: nao consegui ler o git: ${String(e.message).split('\n')[0]}`)
}

console.log(exit === 0 ? '\nRESULTADO: pode deployar.\n' : `\nRESULTADO: NAO deployar agora (codigo ${exit}).\n`)
process.exit(exit)
