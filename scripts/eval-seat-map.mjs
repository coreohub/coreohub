// Avaliação da leitura de planta por IA contra os locais gabarito (Merciol e Nelson Camargo).
// Usa o MESMO prompt, schema e parâmetros da edge function parse-seat-map (supabase/functions/_shared/seat-map-parse.ts).
//
//   node --env-file=.env.local scripts/eval-seat-map.mjs [--models=claude-opus-5-5,claude-sonnet-5-5] [--only=merciol|nelson] [--runs=1]
//
// Requer ANTHROPIC_API_KEY no ambiente (nunca impressa) e o SDK instalado em D:\tmp\eval-sdk (fora do projeto).
// Cada leitura gasta crédito real. Resultados (respostas cruas e relatório) vão para D:\tmp\seatmap-eval.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { PLAN_JSON_SCHEMA, PLAN_SYSTEM_PROMPT, PLAN_USER_PROMPT, estimateCostUsd, isSeatMapModel, checkFile } from '../supabase/functions/_shared/seat-map-parse.ts';
import { planToRows } from '../utils/seatMapFromPlan.ts';

const require = createRequire('D:/tmp/eval-sdk/');
const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');

const arg = (name, def) => (process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]) ?? def;
const models = arg('models', 'claude-opus-5-5,claude-sonnet-5-5').split(',').filter(isSeatMapModel);
const only = arg('only', 'all');
const runs = Math.max(1, Number(arg('runs', '1')) || 1);
const OUT = 'D:/tmp/seatmap-eval';
mkdirSync(OUT, { recursive: true });

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY ausente. Use --env-file=.env.local.'); process.exit(1); }

const DL = 'C:/Users/Ticko Bboy/Downloads/';
// Acha pelo trecho do nome: o acento do nome do arquivo pode vir em forma decomposta no Windows.
const find = re => DL + readdirSync(DL).find(f => re.test(f.normalize('NFC')));
const PLANTS = [
  { id: 'merciol', file: find(/Merciol.*\.pdf$/i), gabarito: 'supabase/data/venue-merciol-viscardi.rows.json', total: 317, hasPcd: false },
  { id: 'nelson', file: find(/Mapa audit.*Conven.*\.pdf$/i), gabarito: 'supabase/data/venue-nelson-camargo.rows.json', total: 373, hasPcd: true },
].filter(p => only === 'all' || p.id === only);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const corredores = r => [...new Set(r.corredores_apos ?? (r.corredor_apos != null ? [r.corredor_apos] : []))].sort((a, b) => a - b);

/** Compara a grade lida com o gabarito, fileira por fileira. */
function compare(lidas, gab) {
  const diffs = [];
  let rowsOk = 0;
  const n = Math.max(lidas.length, gab.length);
  for (let i = 0; i < n; i++) {
    const a = lidas[i], g = gab[i];
    if (!a || !g) { diffs.push(`posição ${i + 1}: ${a ? 'sobrou ' + a.codigo : 'faltou ' + g.codigo}`); continue; }
    const p = [];
    if (a.codigo !== g.codigo) p.push(`código ${a.codigo}≠${g.codigo}`);
    if (a.assentos !== g.assentos) p.push(`lugares ${a.assentos}≠${g.assentos}`);
    if (corredores(a).join() !== corredores(g).join()) p.push(`corredores [${corredores(a)}]≠[${corredores(g)}]`);
    if (!!a.espelhado !== !!g.espelhado) p.push(`espelhado ${!!a.espelhado}≠${!!g.espelhado}`);
    if ((a.alinhamento ?? '') !== (g.alinhamento ?? '')) p.push(`alinhamento ${a.alinhamento ?? 'centro'}≠${g.alinhamento ?? 'centro'}`);
    if (!!a.palco_apos !== !!g.palco_apos) p.push(`palco ${!!a.palco_apos}≠${!!g.palco_apos}`);
    if (p.length) diffs.push(`${g.codigo}: ${p.join('; ')}`); else rowsOk++;
  }
  return { rowsOk, rowsTotal: gab.length, diffs };
}

/** Sugestões de PCD da IA contra os tipos do gabarito (só o Nelson tem). */
function compareHints(sugestoes, gab) {
  const esperados = new Map();
  for (const r of gab) for (const [n, t] of Object.entries(r.tipos ?? {})) esperados.set(`${r.codigo}-${n}`, t);
  const achados = new Map(sugestoes.filter(s => s.tipo !== 'acompanhante').map(s => [`${s.codigo}-${s.numero}`, s.tipo]));
  let certos = 0, tipoErrado = 0;
  for (const [k, t] of esperados) if (achados.has(k)) { achados.get(k) === t ? certos++ : tipoErrado++; }
  const faltaram = [...esperados.keys()].filter(k => !achados.has(k));
  const sobraram = [...achados.keys()].filter(k => !esperados.has(k));
  return { esperados: esperados.size, certos, tipoErrado, faltaram, sobraram };
}

const report = [];
for (const plant of PLANTS) {
  const bytes = readFileSync(plant.file);
  const check = checkFile('application/pdf', bytes.length, new Uint8Array(bytes.subarray(0, 16)));
  if (!check.ok) { console.error(plant.id, check.error); continue; }
  const gab = JSON.parse(readFileSync(plant.gabarito, 'utf-8'));
  const fileBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } };
  const content = [fileBlock, { type: 'text', text: PLAN_USER_PROMPT }];

  for (const model of models) {
    let tokensEntrada = null;
    try {
      tokensEntrada = (await client.messages.countTokens({ model, system: PLAN_SYSTEM_PROMPT, messages: [{ role: 'user', content }] })).input_tokens;
    } catch (e) { console.warn('count_tokens falhou:', e?.status ?? e?.name); }

    for (let run = 1; run <= runs; run++) {
      const started = Date.now();
      const row = { plant: plant.id, model, run, tokensEntrada };
      try {
        const params = {
          model, max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high', format: { type: 'json_schema', schema: PLAN_JSON_SCHEMA } },
          system: PLAN_SYSTEM_PROMPT,
          messages: [{ role: 'user', content }],
        };
        const msg = await client.beta.messages.stream(params).finalMessage();
        row.segundos = Math.round((Date.now() - started) / 100) / 10;
        row.stop = msg.stop_reason;
        row.modeloQueRespondeu = msg.model;
        row.usage = { in: msg.usage.input_tokens, out: msg.usage.output_tokens };
        row.custoUsd = estimateCostUsd(model, msg.usage);
        const text = (msg.content ?? []).find(b => b.type === 'text')?.text ?? '';
        writeFileSync(`${OUT}/${plant.id}-${model}-run${run}.json`, text);
        if (msg.stop_reason === 'refusal' || !text) { row.erro = `stop_reason=${msg.stop_reason}`; }
        else {
          const conv = planToRows(JSON.parse(text), plant.total);
          const cmp = compare(conv.rows, gab);
          row.total = conv.total; row.totalEsperado = plant.total;
          row.fileirasCertas = `${cmp.rowsOk}/${cmp.rowsTotal}`;
          row.diffs = cmp.diffs;
          row.avisos = conv.warnings;
          if (plant.hasPcd) row.pcd = compareHints(conv.sugestoes, gab);
          else row.sugestoes = conv.sugestoes.length;
        }
      } catch (e) {
        row.segundos = Math.round((Date.now() - started) / 100) / 10;
        row.erro = `${e?.status ?? ''} ${e?.name ?? 'erro'}`.trim();
      }
      report.push(row);
      console.log(JSON.stringify(row, null, 1));
    }
  }
}
writeFileSync(`${OUT}/relatorio.json`, JSON.stringify(report, null, 2));
console.log(`\nCusto total estimado: US$ ${report.reduce((s, r) => s + (r.custoUsd ?? 0), 0).toFixed(4)}  (${basename(OUT)}/relatorio.json)`);
