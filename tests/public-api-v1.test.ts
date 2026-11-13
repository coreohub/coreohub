import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { listPublicEvents, findPublicEvent, parseListParams, isValidSlug, apiError, type EventRow } from '../api/_public-events';
import { MARKDOWN_PATHS, KNOWN_TOP_SEGMENTS, pageMarkdown } from '../api/_agent-content';
import { PAGES } from '../api/og-marketing';

const row = (o: Partial<EventRow>): EventRow => ({
  id: 'id', slug: 'ev', name: 'Evento', description: 'Descrição', cover_url: 'https://x/c.jpg',
  start_date: '2026-12-01', end_date: null, event_time: null, city: 'Votuporanga', state: 'SP', location: 'Teatro',
  session_group_id: null, sessao_status: null, ...o,
});

describe('listPublicEvents / findPublicEvent', () => {
  it('só entra evento com slug, capa e descrição (mesma regra da vitrine)', () => {
    const rows = [row({ id: '1', slug: 'ok' }), row({ id: '2', slug: 'sem-capa', cover_url: null }),
      row({ id: '3', slug: 'sem-desc', description: '  ' }), row({ id: '4', slug: null })];
    expect(listPublicEvents(rows).map((e) => e.slug)).toEqual(['ok']);
  });

  it('expõe só campos públicos e a URL do evento', () => {
    const [e] = listPublicEvents([row({ slug: 'meu-festival' })]);
    expect(e.url).toBe('https://app.coreohub.com/evento/meu-festival');
    expect(Object.keys(e).sort()).toEqual(['cover_url', 'description', 'end_date', 'event_time', 'location', 'name', 'city', 'slug', 'start_date', 'state', 'url'].sort());
  });

  it('espetáculo com várias sessões vira um item (o principal) com as sessões não canceladas', () => {
    const rows = [
      row({ id: 'main', slug: 'show', session_group_id: 'main', start_date: '2026-12-10' }),
      row({ id: 's2', slug: 'show-sessao-2', session_group_id: 'main', start_date: '2026-12-11' }),
      row({ id: 's3', slug: 'show-sessao-3', session_group_id: 'main', start_date: '2026-12-12', sessao_status: 'cancelada' }),
    ];
    const list = listPublicEvents(rows);
    expect(list.map((e) => e.slug)).toEqual(['show']);
    expect(list[0].sessions).toEqual([
      { start_date: '2026-12-10', event_time: null }, { start_date: '2026-12-11', event_time: null },
    ]);
  });

  it('detalhe acha por slug (inclusive de sessão) e devolve null se não existe ou incompleto', () => {
    const rows = [row({ slug: 'a' }), row({ id: '2', slug: 'b', cover_url: null })];
    expect(findPublicEvent(rows, 'a')?.slug).toBe('a');
    expect(findPublicEvent(rows, 'b')).toBeNull();
    expect(findPublicEvent(rows, 'nao-existe')).toBeNull();
  });
});

describe('parseListParams / isValidSlug', () => {
  it('padrões e limites', () => {
    expect(parseListParams({})).toEqual({ ok: true, value: { limit: 50, offset: 0 } });
    expect(parseListParams({ limit: '100', offset: '20' })).toEqual({ ok: true, value: { limit: 100, offset: 20 } });
  });
  it('rejeita valores inválidos com erro 400 em JSON', () => {
    for (const q of [{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { limit: '-1' }, { limit: '1.5' }, { offset: '-2' }, { offset: 'x' }]) {
      const r = parseListParams(q);
      expect(r.ok, JSON.stringify(q)).toBe(false);
      const err = (r as any).error;
      expect(err.status).toBe(400);
      expect(err.error).toBe('invalid_parameter');
      expect(err.message.length).toBeGreaterThan(10);
      expect(err.hint.length).toBeGreaterThan(10);
    }
  });
  it('slug válido', () => {
    expect(isValidSlug('festival-level-up-2026')).toBe(true);
    for (const s of ['', '-x', 'a/b', 'a b', '../x', 'a'.repeat(200)]) expect(isValidSlug(s), s).toBe(false);
  });
  it('apiError tem os 4 campos', () => {
    expect(apiError(404, 'not_found', 'm', 'h')).toEqual({ error: 'not_found', message: 'm', hint: 'h', status: 404 });
  });
});

describe('handler /api/v1', () => {
  const ORIGINAL = globalThis.fetch;
  beforeEach(() => { vi.resetModules(); process.env.SUPABASE_ANON_KEY = 'anon-test'; });
  afterEach(() => { globalThis.fetch = ORIGINAL; });

  const call = async (query: Record<string, any>, method = 'GET') => {
    vi.resetModules();
    const handler = (await import('../api/v1')).default;
    const out: { status?: number; body?: string; headers: Record<string, string> } = { headers: {} };
    const res: any = {
      setHeader: (k: string, v: string) => { out.headers[k.toLowerCase()] = v; },
      status(c: number) { out.status = c; return res; },
      send(b: string) { out.body = b; return res; },
      end() { return res; },
    };
    await handler({ query, method, headers: {} } as any, res);
    return out;
  };
  const mockRows = (rows: EventRow[], ok = true, status = 200) => {
    globalThis.fetch = vi.fn(async () => ({ ok, status, json: async () => rows })) as any;
  };

  it('lista: 200, JSON, versão e paginação', async () => {
    mockRows([row({ id: '1', slug: 'a' }), row({ id: '2', slug: 'b' }), row({ id: '3', slug: 'c' })]);
    const r = await call({ path: 'eventos', limit: '2', offset: '1' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    expect(r.headers['x-api-version']).toBe('1');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    const j = JSON.parse(r.body!);
    expect(j.meta).toEqual({ total: 3, limit: 2, offset: 1, api_version: '1' });
    expect(j.data.map((e: any) => e.slug)).toEqual(['b', 'c']);
  });

  it('consulta ao Supabase filtra público e fora do sandbox', async () => {
    mockRows([]);
    await call({ path: 'eventos' });
    const url = String((globalThis.fetch as any).mock.calls[0][0]);
    expect(url).toContain('is_public=eq.true');
    expect(url).toContain('payment_sandbox=eq.false');
  });

  it('detalhe: 200 e 404 em JSON', async () => {
    mockRows([row({ slug: 'a' })]);
    const ok = await call({ path: 'eventos/a' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body!).slug).toBe('a');
    const miss = await call({ path: 'eventos/zzz' });
    expect(miss.status).toBe(404);
    expect(JSON.parse(miss.body!).error).toBe('not_found');
  });

  it('erros: 400 parâmetro, 404 rota, 405 método, 502 upstream, 503 sem chave — todos JSON', async () => {
    mockRows([]);
    const bad = await call({ path: 'eventos', limit: '999' });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body!)).toMatchObject({ error: 'invalid_parameter', status: 400 });

    for (const path of ['', 'outra-coisa', 'eventos/a/b', 'eventos/../x']) {
      const r = await call({ path });
      expect(r.status, path).toBe(404);
      expect(r.headers['content-type']).toMatch(/^application\/json/);
      expect(JSON.parse(r.body!)).toMatchObject({ error: 'not_found', status: 404 });
    }

    const post = await call({ path: 'eventos' }, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers['allow']).toContain('GET');
    expect(JSON.parse(post.body!).error).toBe('method_not_allowed');

    mockRows([], false, 500);
    const up = await call({ path: 'eventos' });
    expect(up.status).toBe(502);
    expect(JSON.parse(up.body!).error).toBe('upstream_error');

    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const nokey = await call({ path: 'eventos' });
    expect(nokey.status).toBe(503);
    expect(JSON.parse(nokey.body!).error).toBe('service_unavailable');
  });

  it('OPTIONS responde 204 sem corpo (CORS)', async () => {
    const r = await call({ path: 'eventos' }, 'OPTIONS');
    expect(r.status).toBe(204);
  });
});

describe('configuração publicada', () => {
  it('vercel.json reescreve /api/v1/:path* para a função', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    const r = cfg.rewrites.find((x: any) => x.source === '/api/v1/:path*');
    expect(r.destination).toBe('/api/v1?path=:path*');
    expect(cfg.rewrites[0].source).toBe('/api/v1/:path*'); // antes do catch-all
  });

  it('/developers, /docs e /api (exato) redirecionam 308 para /desenvolvedores', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    for (const from of ['/developers', '/docs', '/api']) {
      const r = cfg.redirects.find((x: any) => x.source === from);
      expect(r, from).toBeTruthy();
      expect(r.destination).toBe('/desenvolvedores');
      expect(r.permanent).toBe(true);
    }
  });

  it('openapi.json documenta /api/v1, versão, depreciação e não inventa segurança', () => {
    const spec = JSON.parse(readFileSync('public/openapi.json', 'utf-8'));
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/eventos', '/api/v1/eventos/{slug}']));
    expect(spec.info.description).toMatch(/90 dias/);
    expect(spec.info.description).toMatch(/Deprecation/);
    expect(spec.security).toEqual([]);
    expect(spec.components.securitySchemes).toBeUndefined();
    for (const code of ['400', '405', '502', '503']) {
      expect(spec.paths['/api/v1/eventos'].get.responses[code], code).toBeTruthy();
    }
    expect(spec.paths['/api/v1/eventos/{slug}'].get.responses['404']).toBeTruthy();
    expect(spec.components.schemas.ApiError.required).toEqual(['error', 'message', 'hint', 'status']);
  });

  it('/desenvolvedores é rota conhecida, tem Markdown com título "CoreoHub API" e está no llms.txt', () => {
    expect(MARKDOWN_PATHS['/desenvolvedores']).toBe('desenvolvedores');
    expect(KNOWN_TOP_SEGMENTS).toContain('desenvolvedores');
    const md = pageMarkdown(PAGES.desenvolvedores as any);
    expect(md).toMatch(/^# CoreoHub API/);
    expect(md).toContain('/api/v1/eventos');
    expect(md).toContain('90 dias');
    const llms = readFileSync('public/llms.txt', 'utf-8');
    expect(llms).toContain('https://coreohub.com/desenvolvedores');
    expect(llms).toContain('/api/v1/eventos');
  });
});

describe('AI Catalog (/.well-known/ai-catalog.json, especificação ai-catalog.io)', () => {
  const cat = JSON.parse(readFileSync('public/.well-known/ai-catalog.json', 'utf-8'));
  it('tem specVersion Major.Minor e entries (campos obrigatórios)', () => {
    expect(cat.specVersion).toMatch(/^\d+\.\d+$/);
    expect(Array.isArray(cat.entries)).toBe(true);
  });
  it('cada entrada tem identifier, type e exatamente um entre url e data; identifier único', () => {
    const ids = new Set<string>();
    for (const e of cat.entries) {
      expect(typeof e.identifier).toBe('string');
      expect(typeof e.type).toBe('string');
      expect(Number('url' in e) + Number('data' in e), e.identifier).toBe(1);
      expect(ids.has(e.identifier)).toBe(false);
      ids.add(e.identifier);
    }
    expect(cat.host.displayName).toBeTruthy();
  });
  it('só lista artefatos que existem (o OpenAPI publicado) e é servido como application/ai-catalog+json', () => {
    for (const e of cat.entries) expect(e.url).toBe('https://coreohub.com/openapi.json');
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    const h = cfg.headers.find((x: any) => /ai-catalog/.test(x.source));
    expect(h.headers.find((x: any) => x.key === 'Content-Type').value).toMatch(/^application\/ai-catalog\+json/);
    const home = cfg.headers.find((x: any) => x.source === '/');
    expect(home.headers[0].value).toContain('rel="ai-catalog"');
  });
});

describe('endereços do catálogo', () => {
  it('/ai-catalog.json e /.well-known/ai-catalog reescrevem para o arquivo, e o HTML declara o link', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    for (const from of ['/ai-catalog.json', '/.well-known/ai-catalog']) {
      const r = cfg.rewrites.find((x: any) => x.source === from);
      expect(r, from).toBeTruthy();
      expect(r.destination).toBe('/.well-known/ai-catalog.json');
    }
    expect(readFileSync('index.html', 'utf-8')).toContain('rel="ai-catalog"');
  });
});

describe('contraste da home', () => {
  it('LandingPage não usa text-slate-500 (contraste 3,7:1 sobre fundo escuro; usar slate-400, 6,9:1)', () => {
    const src = readFileSync('pages/LandingPage.tsx', 'utf-8');
    expect(src).not.toContain('text-slate-500');
    expect(src).not.toContain('text-slate-600');
  });
});
