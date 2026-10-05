import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import handler from '../api/og-marketing';

// As páginas são componentes React (aliases e supabase); aqui lemos só o texto das FAQs do fonte.
const faqOf = (file: string, name: string): { q: string; a: string }[] => {
  const src = readFileSync(file, 'utf-8');
  const start = src.indexOf(`const ${name} = [`);
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('];', start));
  const re = /q: '((?:[^'\\]|\\.)*)',\s*a: '((?:[^'\\]|\\.)*)'/g;
  const out = [...block.matchAll(re)].map(m => ({ q: m[1], a: m[2] }));
  expect(out.length).toBeGreaterThan(0);
  return out;
};
const FAQ_ITEMS = faqOf('pages/LandingEspetaculo.tsx', 'FAQ_ITEMS');
const PLANOS_FAQ_ITEMS = faqOf('pages/Planos.tsx', 'PLANOS_FAQ_ITEMS');

// O HTML que bots (Googlebot, GPTBot, ClaudeBot...) recebem de /planos e /espetaculo vem de api/og-marketing.ts,
// não do React. Estes testes garantem que as FAQs e o JSON-LD de lá não divergem das páginas.

const render = async (page: string): Promise<string> => {
  let body = '';
  const res: any = {
    setHeader: () => res,
    status: () => res,
    send: (b: string) => { body = b; },
  };
  await handler({ query: { page } } as any, res);
  return body;
};

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jsonLdOf = (html: string) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]);
};

describe('api/og-marketing — FAQ e JSON-LD espelham as páginas', () => {
  it('espetáculo: todas as perguntas e respostas da página estão no corpo e no FAQPage', async () => {
    const html = await render('espetaculo');
    for (const { q, a } of FAQ_ITEMS) {
      expect(html).toContain(escHtml(q));
      expect(html).toContain(escHtml(a));
    }
    const ld = jsonLdOf(html);
    const faq = ld['@graph'].find((n: any) => n['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((x: any) => x.name)).toEqual(FAQ_ITEMS.map(i => i.q));
    expect(faq.mainEntity.map((x: any) => x.acceptedAnswer.text)).toEqual(FAQ_ITEMS.map(i => i.a));
    expect(ld['@graph'].some((n: any) => n['@type'] === 'Service')).toBe(true);
  });

  it('planos: FAQ da página no corpo e no FAQPage', async () => {
    const html = await render('planos');
    for (const { q, a } of PLANOS_FAQ_ITEMS) {
      expect(html).toContain(escHtml(q));
      expect(html).toContain(escHtml(a));
    }
    const ld = jsonLdOf(html);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((x: any) => x.name)).toEqual(PLANOS_FAQ_ITEMS.map(i => i.q));
  });

  it('nenhuma promessa antiga de "tudo incluso" no HTML dos bots', async () => {
    for (const page of ['espetaculo', 'planos']) {
      const html = await render(page);
      expect(html.toLowerCase()).not.toContain('tudo incluso');
      expect(html.toLowerCase()).not.toContain('absorve 100%');
    }
  });

  it('páginas sem FAQ não ganham JSON-LD nem corpo extra', async () => {
    const html = await render('festivais');
    expect(html).not.toContain('application/ld+json');
  });
});
