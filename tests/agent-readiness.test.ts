import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAGES } from '../api/og-marketing';
import {
  KNOWN_TOP_SEGMENTS, MARKDOWN_PATHS, MIN_TRUST_CHARS, TRUST_REDIRECTS, isKnownRoute, notFoundHtml,
  notFoundMarkdown, pageBodyHtml, pageMarkdown, wantsMarkdown,
} from '../api/_agent-content';
import { injectRoot, retargetHead } from '../scripts/agent-prerender';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('negociação de Markdown (Accept)', () => {
  it('reconhece text/markdown e ignora navegadores', () => {
    expect(wantsMarkdown('text/markdown')).toBe(true);
    expect(wantsMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
    expect(wantsMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
    expect(wantsMarkdown('*/*')).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
  });

  it('toda rota de MARKDOWN_PATHS tem página em PAGES e Markdown com links úteis', () => {
    for (const [path, key] of Object.entries(MARKDOWN_PATHS)) {
      const meta = PAGES[key];
      expect(meta, `PAGES.${key} (${path})`).toBeTruthy();
      expect(meta.path).toBe(path);
      const md = pageMarkdown(meta);
      expect(md.length).toBeGreaterThan(20);
      expect(md).toContain('# ');
      expect(md).toContain('/llms.txt');
      expect(md).toContain('/sitemap.xml');
      expect(md).toContain('contato@coreohub.com');
    }
  });
});

describe('404 de verdade', () => {
  it('rotas do App.tsx são conhecidas; lixo não', () => {
    expect(isKnownRoute('/')).toBe(true);
    expect(isKnownRoute('/planos')).toBe(true);
    expect(isKnownRoute('/evento/festival-level-up-2026')).toBe(true);
    expect(isKnownRoute('/Planos')).toBe(true);
    expect(isKnownRoute('/some-path-that-does-not-exist')).toBe(false);
    expect(isKnownRoute('/wp-login.php')).toBe(false);
    expect(isKnownRoute('/about')).toBe(false); // vira redirect 308 no vercel.json, antes do middleware
  });

  it('KNOWN_TOP_SEGMENTS espelha todas as rotas do App.tsx', () => {
    const app = readFileSync('App.tsx', 'utf-8');
    const tops = new Set<string>();
    for (const m of app.matchAll(/<Route\s+path="\/([^"/:*]+)/g)) tops.add(m[1]);
    const missing = [...tops].filter((t) => !KNOWN_TOP_SEGMENTS.includes(t));
    expect(missing, `rotas no App.tsx fora de KNOWN_TOP_SEGMENTS: ${missing.join(', ')}`).toEqual([]);
  });

  it('corpo do 404 em Markdown e em HTML', () => {
    const md = notFoundMarkdown('/nao-existe');
    expect(md.length).toBeGreaterThan(20);
    expect(md).toContain('/llms.txt');
    expect(md).toContain('/sitemap.xml');
    expect(md).toContain('contato@coreohub.com');
    expect(notFoundMarkdown('/a`b\nc')).not.toContain('\nc');
    const html = notFoundHtml();
    expect(html).toContain('<h1>');
    expect(html).toContain('noindex');
  });
});

describe('HTML bruto com conteúdo (sem JavaScript)', () => {
  it('home: ≥500 caracteres, 1 H1, H2 em sequência', () => {
    const body = pageBodyHtml(PAGES.home);
    expect(text(body).length).toBeGreaterThanOrEqual(MIN_TRUST_CHARS);
    expect((body.match(/<h1>/g) ?? []).length).toBe(1);
    expect(body).toContain('<h2>');
  });

  it('páginas de confiança (/sobre, /contato, /privacidade) têm ≥500 caracteres de texto', () => {
    for (const key of ['sobre', 'contato', 'privacidade']) {
      expect(text(pageBodyHtml(PAGES[key])).length, key).toBeGreaterThanOrEqual(MIN_TRUST_CHARS);
    }
  });

  it('injectRoot preenche o #root e retargetHead troca title/descrição/canonical', () => {
    const shell = readFileSync('index.html', 'utf-8');
    const out = injectRoot(retargetHead(shell, PAGES.sobre), pageBodyHtml(PAGES.sobre));
    expect(out).toContain('<div id="root"><div data-prerender');
    expect(out).toContain('<link rel="canonical" href="https://coreohub.com/sobre">');
    expect(out).toContain('<title>Sobre a CoreoHub');
    expect(out).toContain('type="module" src="./index.tsx"');
  });
});

describe('páginas de confiança e llms.txt', () => {
  it('/about, /contact e /privacy redirecionam (308) para a página canônica em PT', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    for (const [from, to] of Object.entries(TRUST_REDIRECTS)) {
      const r = cfg.redirects.find((x: any) => x.source === from);
      expect(r, from).toBeTruthy();
      expect(r.destination).toBe(to);
      expect(r.permanent).toBe(true);
      expect(MARKDOWN_PATHS[to]).toBeTruthy();
    }
  });

  it('llms.txt tem "Quando usar", "Não use" e "Como acionar"', () => {
    const s = readFileSync('public/llms.txt', 'utf-8');
    expect(s).toMatch(/## Quando usar a CoreoHub/);
    expect(s).toMatch(/## Não use a CoreoHub para/);
    expect(s).toMatch(/## Como acionar/);
    expect(s).toContain('Accept: text/markdown');
    expect(s).toContain('/contato');
  });

  it('o JSON-LD da Organization tem contactPoint, address e e-mail', () => {
    const html = readFileSync('index.html', 'utf-8');
    const m = html.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/);
    const org = JSON.parse(m![1])['@graph'].find((n: any) => n['@type'] === 'Organization');
    expect(org.contactPoint.contactType).toBe('customer support');
    expect(org.contactPoint.email).toBe('contato@coreohub.com');
    expect(org.address.addressLocality).toBe('Votuporanga');
    expect(org.sameAs.length).toBeGreaterThan(0);
  });
});
