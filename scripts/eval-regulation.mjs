// Compara a leitura de regulamento do Gemini (função gemini-analysis em produção) com a da Anthropic (Sonnet e Opus)
// nos MESMOS PDFs, com o mesmo prompt e schema da função parse-regulation. Não há gabarito: o relatório lista campo a
// campo o que difere, para conferência humana contra o PDF.
//
//   node --env-file=.env.local scripts/eval-regulation.mjs [--dir=D:/tmp/regulamentos] [--models=claude-sonnet-5-5,claude-opus-5-5]
//        [--only=reg1,reg2] [--gemini=0|1]
//
// Requer ANTHROPIC_API_KEY no ambiente (nunca impressa) e SDK em D:\tmp\eval-sdk. O baseline do Gemini usa o login de
// produtor salvo em scripts/.playwright-auth (consome 1 das 15 análises do dia). Cada leitura gasta crédito real.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { REGULATION_JSON_SCHEMA, REGULATION_PROMPT_PDF, REGULATION_TOOL_NAME, REGULATION_TOOL_DESCRIPTION, REGULATION_TOOL_INSTRUCTION, regulationFromContent } from '../supabase/functions/_shared/regulation-parse.ts';
import { estimateCostUsd, isSeatMapModel } from '../supabase/functions/_shared/seat-map-parse.ts';

const require = createRequire('D:/tmp/eval-sdk/');
const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');

const arg = (name, def) => (process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]) ?? def;
const DIR = arg('dir', 'D:/tmp/regulamentos');
const models = arg('models', 'claude-sonnet-5-5,claude-opus-5-5').split(',').filter(isSeatMapModel);
const only = arg('only', '');
const withGemini = arg('gemini', '1') === '1';
const OUT = `${DIR}/out`;
mkdirSync(OUT, { recursive: true });
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY ausente. Use --env-file=.env.local.'); process.exit(1); }

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const files = readdirSync(DIR).filter(f => /^reg\d+\.pdf$/.test(f)).filter(f => !only || only.split(',').includes(f.replace('.pdf', '')));

async function gemini(b64) {
  const st = JSON.parse(readFileSync('D:/Documentos/CoreoHub/scripts/.playwright-auth/storage-produtor.json', 'utf-8'));
  let token = null;
  for (const o of st.origins ?? []) for (const it of o.localStorage ?? []) if (/^sb-.*-auth-token$/.test(it.name)) { try { token = JSON.parse(it.value).access_token; } catch { /* sem token */ } }
  if (!token) throw new Error('sem token de produtor (rode node scripts/playwright.auth.mjs)');
  const t0 = Date.now();
  const r = await fetch('https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/gemini-analysis', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pdf_base64: b64 }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${body?.error}`);
  return { result: body, segundos: Math.round((Date.now() - t0) / 100) / 10 };
}

async function claude(model, b64) {
  const t0 = Date.now();
  const params = {
    model, max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools: [{ name: REGULATION_TOOL_NAME, description: REGULATION_TOOL_DESCRIPTION, input_schema: REGULATION_JSON_SCHEMA }],
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: REGULATION_PROMPT_PDF + REGULATION_TOOL_INSTRUCTION },
    ] }],
  };
  const msg = await client.beta.messages.stream(params).finalMessage();
  const result = regulationFromContent(msg.content);
  if (!result) throw new Error(`sem chamada da ferramenta (stop_reason=${msg.stop_reason})`);
  return {
    result, segundos: Math.round((Date.now() - t0) / 100) / 10,
    usage: { in: msg.usage.input_tokens, out: msg.usage.output_tokens }, custoUsd: estimateCostUsd(model, msg.usage),
  };
}

// ── comparação ──
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(empty));
const norm = v => JSON.stringify(v, (_, x) => (typeof x === 'string' ? x.trim().toLowerCase() : x));
const short = v => { const s = JSON.stringify(v); return s == null ? 'null' : s.length > 110 ? s.slice(0, 107) + '...' : s; };
const countFilled = o => { let n = 0; (function w(x) { if (Array.isArray(x)) { if (x.length) n++; x.forEach(w); } else if (x && typeof x === 'object') Object.values(x).forEach(w); else if (!empty(x)) n++; })(o); return n; };

const report = [];
for (const f of files) {
  const id = f.replace('.pdf', '');
  const b64 = readFileSync(`${DIR}/${f}`).toString('base64');
  const runs = {};
  if (withGemini) { try { runs.gemini = await gemini(b64); } catch (e) { runs.gemini = { erro: e.message }; } }
  for (const m of models) { try { runs[m] = await claude(m, b64); } catch (e) { runs[m] = { erro: `${e?.status ?? ''} ${e?.message ?? e}`.slice(0, 200) }; } }
  for (const [k, v] of Object.entries(runs)) if (v.result) writeFileSync(`${OUT}/${id}-${k}.json`, JSON.stringify(v.result, null, 2));

  const names = Object.keys(runs);
  const keys = new Set(names.flatMap(n => Object.keys(runs[n].result ?? {})));
  const lines = [`# ${id}`, '', '| leitor | segundos | tokens (in/out) | custo US$ | campos preenchidos |', '|---|---|---|---|---|'];
  for (const n of names) {
    const r = runs[n];
    lines.push(r.erro ? `| ${n} | ERRO: ${r.erro} | | | |` : `| ${n} | ${r.segundos} | ${r.usage ? `${r.usage.in}/${r.usage.out}` : '-'} | ${r.custoUsd ?? '-'} | ${countFilled(r.result)} |`);
  }
  lines.push('', '## Campos que diferem (conferir contra o PDF)', '');
  let iguais = 0, diferem = 0;
  for (const k of [...keys].sort()) {
    const vals = names.map(n => runs[n].result?.[k]);
    const allEmpty = vals.every(empty);
    const same = vals.every(v => norm(empty(v) ? null : v) === norm(empty(vals[0]) ? null : vals[0]));
    if (allEmpty || same) { iguais++; continue; }
    diferem++;
    lines.push(`- **${k}**`);
    names.forEach((n, i) => lines.push(`  - ${n}: ${empty(vals[i]) ? '(vazio)' : short(vals[i])}`));
  }
  lines.push('', `Campos iguais/vazios em todos: ${iguais}. Divergentes: ${diferem}.`);
  writeFileSync(`${OUT}/${id}-comparacao.md`, lines.join('\n'));
  report.push({ id, iguais, diferem, leitores: Object.fromEntries(names.map(n => [n, runs[n].erro ? { erro: runs[n].erro } : { segundos: runs[n].segundos, custoUsd: runs[n].custoUsd, preenchidos: countFilled(runs[n].result) }])) });
  console.log(JSON.stringify(report[report.length - 1]));
}
writeFileSync(`${OUT}/resumo.json`, JSON.stringify(report, null, 2));
console.log('Custo total estimado US$', report.flatMap(r => Object.values(r.leitores)).reduce((s, l) => s + (l.custoUsd ?? 0), 0).toFixed(4));
