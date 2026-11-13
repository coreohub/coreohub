import { describe, it, expect } from 'vitest';
import middleware from '../middleware';
import mdHandler from '../api/md';
import notFoundHandler from '../api/not-found';

// Roda o middleware de verdade (Request → Response do @vercel/functions) e os handlers das
// funções com um res falso: o mesmo caminho que o scanner percorre em produção.
const mw = (path: string, headers: Record<string, string> = {}, host = 'coreohub.com') =>
  middleware(new Request(`https://${host}${path}`, { headers }));
const rewriteOf = (r: Response | undefined) => r?.headers.get('x-middleware-rewrite') ?? null;

const run = (handler: any, query: Record<string, string>, headers: Record<string, string> = {}) => {
  const out: { status?: number; body?: string; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader: (k: string, v: string) => { out.headers[k.toLowerCase()] = v; },
    status(c: number) { out.status = c; return res; },
    send(b: string) { out.body = b; return res; },
  };
  handler({ query, headers, url: '/nada-aqui' }, res);
  return out;
};

describe('middleware: Markdown por Accept', () => {
  it('Accept: text/markdown em / e nas páginas de marketing reescreve para /api/md', () => {
    expect(rewriteOf(mw('/', { accept: 'text/markdown' }))).toContain('/api/md?page=home');
    expect(rewriteOf(mw('/planos', { accept: 'text/markdown' }))).toContain('/api/md?page=planos');
    expect(rewriteOf(mw('/sobre/', { accept: 'text/markdown' }))).toContain('/api/md?page=sobre');
  });

  it('navegador (text/html) não é reescrito para Markdown', () => {
    const r = mw('/planos', { accept: 'text/html,application/xhtml+xml' });
    expect(rewriteOf(r) ?? '').not.toContain('/api/md');
  });

  it('rota inexistente + Accept markdown → /api/md?page=404; sem Accept → /api/not-found', () => {
    expect(rewriteOf(mw('/some-path-that-does-not-exist', { accept: 'text/markdown' }))).toContain('/api/md?page=404');
    expect(rewriteOf(mw('/some-path-that-does-not-exist'))).toContain('/api/not-found');
  });

  it('rota real do app (ex.: /dashboard) e app.coreohub.com não viram 404', () => {
    expect(rewriteOf(mw('/dashboard'))).toBeNull();
    expect(rewriteOf(mw('/evento/algum-slug'))).toBeNull();
    expect(rewriteOf(mw('/qualquer-coisa', {}, 'app.coreohub.com'))).toBeNull();
  });
});

describe('api/md e api/not-found', () => {
  it('página existente: 200, text/markdown, Vary: Accept, corpo com links', () => {
    const r = run(mdHandler, { page: 'home' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/markdown/);
    expect(r.headers['vary']).toBe('Accept');
    expect(r.body!.length).toBeGreaterThan(20);
    expect(r.body).toContain('/llms.txt');
  });

  it('404 em Markdown: status 404, text/markdown, ≥20 caracteres, aponta llms.txt/sitemap/contato', () => {
    const r = run(mdHandler, { page: '404', path: '/some-path-that-does-not-exist' });
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^text\/markdown/);
    expect(r.body!.length).toBeGreaterThan(20);
    expect(r.body).toContain('/llms.txt');
    expect(r.body).toContain('/sitemap.xml');
    expect(r.body).toContain('contato@coreohub.com');
  });

  it('404 em HTML: status 404 e text/html', () => {
    const r = run(notFoundHandler, {});
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
  });

  it('404 em JSON quando o cliente pede application/json', () => {
    const r = run(notFoundHandler, {}, { accept: 'application/json' });
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    const j = JSON.parse(r.body!);
    expect(j.error).toBe('not_found');
    expect(j.status).toBe(404);
    expect(j.links.openapi).toContain('/openapi.json');
  });
});
