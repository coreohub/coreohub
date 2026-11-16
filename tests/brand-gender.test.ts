import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// A marca é feminina: "a CoreoHub", "da CoreoHub", "na CoreoHub".
// Falha se aparecer artigo masculino antes do nome da marca.
// "CoreoHub Open" é nome próprio do festival demo e fica de fora.

const ROOT = process.cwd();
const DIRS = ['pages', 'components', 'services', 'hooks', 'utils', 'i18n', 'api', 'supabase/functions'];
const FILES = ['index.html', 'App.tsx', 'middleware.ts'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.html', '.json']);

// (?<![\p{L}]) evita casar o "o" final de "comissão", "solução", "participação".
const MASCULINO =
  /(?<![\p{L}])(o|do|no|ao|pelo|esse|este|neste|nesse|deste|desse|num|dum|pro)\s+CoreoHub\b(?!\s+Open)/giu;

function listar(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...listar(caminho));
    else if (EXTS.has(extname(nome))) out.push(caminho);
  }
  return out;
}

describe('gênero da marca', () => {
  it('nunca usa artigo masculino antes de CoreoHub', () => {
    const arquivos = [
      ...DIRS.flatMap((d) => {
        try {
          return listar(join(ROOT, d));
        } catch {
          return [];
        }
      }),
      ...FILES.map((f) => join(ROOT, f)),
    ];
    const achados: string[] = [];
    for (const arq of arquivos) {
      let texto: string;
      try {
        texto = readFileSync(arq, 'utf8');
      } catch {
        continue;
      }
      texto.split('\n').forEach((linha, i) => {
        MASCULINO.lastIndex = 0;
        if (MASCULINO.test(linha)) {
          achados.push(`${arq.replace(ROOT, '').replace(/\\/g, '/')}:${i + 1}  ${linha.trim().slice(0, 100)}`);
        }
      });
    }
    expect(achados, `Use "a CoreoHub" (feminino):\n${achados.join('\n')}`).toEqual([]);
  });

  it('o regex pega os casos errados e ignora os certos', () => {
    const casa = (s: string) => {
      MASCULINO.lastIndex = 0;
      return MASCULINO.test(s);
    };
    expect(casa('Confirme seu e-mail no CoreoHub')).toBe(true);
    expect(casa('Convite pro CoreoHub')).toBe(true);
    expect(casa('Notificação do CoreoHub')).toBe(true);
    expect(casa('Confirme seu e-mail na CoreoHub')).toBe(false);
    expect(casa('Comissão CoreoHub')).toBe(false);
    expect(casa('Bem-vindos ao CoreoHub Open!')).toBe(false);
  });
});
