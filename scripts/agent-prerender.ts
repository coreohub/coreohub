/**
 * Pré-render do texto das páginas de marketing no HTML bruto (agent readiness / SEO).
 *
 * O app é um SPA: o index.html sai com `<div id="root"></div>` vazio, então quem não executa
 * JavaScript (agentes de IA, scanners, crawlers) via ~60 caracteres. Este plugin, depois do build:
 *  - injeta o texto real (h1, parágrafos, FAQ, dados da empresa, links) dentro do #root do index.html;
 *  - gera dist/<rota>/index.html com o mesmo shell, título, descrição e canonical da própria rota.
 * O React substitui o conteúdo do #root na montagem (createRoot limpa o contêiner). O bloco fica
 * visualmente oculto (técnica sr-only) pra não piscar antes da hidratação; leitor de tela e robôs leem.
 * Fonte do texto: PAGES em api/og-marketing.ts (mesma dos bots de preview e do Markdown).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { PAGES } from '../api/og-marketing.js';
import { MARKDOWN_PATHS, escHtml, pageBodyHtml } from '../api/_agent-content.js';

const HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

export function injectRoot(shell: string, bodyHtml: string): string {
  return shell.replace('<div id="root"></div>', `<div id="root"><div data-prerender style="${HIDDEN}">${bodyHtml}</div></div>`);
}

export function retargetHead(shell: string, meta: { path: string; title: string; description: string; metaDescription?: string }): string {
  const url = `https://coreohub.com${meta.path}`;
  const desc = escHtml(meta.metaDescription ?? meta.description);
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(meta.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escHtml(meta.title)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escHtml(meta.title)}$2`);
}

export function agentPrerender(): Plugin {
  return {
    name: 'coreohub-agent-prerender',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      const shellPath = join(dist, 'index.html');
      // Build que falhou antes de gerar o HTML: não mascara o erro real do Rollup.
      if (!existsSync(shellPath)) return;
      const shell = readFileSync(shellPath, 'utf-8');
      if (!shell.includes('<div id="root"></div>')) throw new Error('agent-prerender: #root vazio não encontrado no index.html');

      for (const [path, key] of Object.entries(MARKDOWN_PATHS)) {
        const meta = PAGES[key];
        if (!meta) throw new Error(`agent-prerender: PAGES["${key}"] não existe (rota ${path})`);
        const body = pageBodyHtml(meta);
        if (path === '/') {
          writeFileSync(shellPath, injectRoot(shell, body));
          continue;
        }
        const dir = join(dist, path.replace(/^\//, ''));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), injectRoot(retargetHead(shell, meta), body));
      }
    },
  };
}
