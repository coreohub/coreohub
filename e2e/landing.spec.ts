import { test, expect } from '@playwright/test';

/**
 * Landing page de marketing. Em dev responde em /lp
 * (em prod a raiz detecta o domínio e renderiza a mesma página).
 */
const LP = '/lp';

test.beforeEach(async ({ page }) => {
  await page.goto(LP);
});

test.describe('Hero', () => {
  test('renderiza título, kicker e CTA principal', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/plataforma de gestão/i);
    await expect(page.getByRole('button', { name: /criar meu festival grátis/i }).first()).toBeVisible();
  });

  test('CTA da hero leva para /criar-evento', async ({ page }) => {
    await page.getByRole('button', { name: /criar meu festival grátis/i }).first().click();
    await expect(page).toHaveURL(/\/criar-evento/);
  });

  test('barra de stats mostra as 3 métricas', async ({ page }) => {
    for (const metric of ['10%', 'R$ 0', '30s']) {
      await expect(page.getByText(metric, { exact: true }).first()).toBeVisible();
    }
  });

  test('imagem de fundo é decorativa (não poluí leitor de tela)', async ({ page }) => {
    const hero = page.locator('section img[aria-hidden="true"]').first();
    await expect(hero).toHaveAttribute('alt', '');
  });
});

test.describe('Navbar', () => {
  test('fica fixa e ganha fundo ao rolar', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toHaveCSS('position', 'fixed');

    // sem rolagem: transparente
    await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await page.mouse.wheel(0, 400);
    await expect(async () => {
      const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    }).toPass({ timeout: 2000 });
  });

  test('não cobre o conteúdo ao navegar por âncora', async ({ page }) => {
    const scrollPadding = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollPaddingTop
    );
    // com header fixo, scroll-padding-top precisa compensar a altura dele
    expect(scrollPadding).not.toBe('auto');
  });
});

test.describe('Navbar — desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'somente desktop');

  test('mostra links e CTA', async ({ page }) => {
    const nav = page.locator('header');
    await expect(nav.getByRole('link', { name: 'Festivais', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(nav.getByRole('button', { name: /criar festival/i })).toBeVisible();
  });
});

test.describe('Navbar — mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'somente mobile');

  test('hamburger abre e fecha o menu', async ({ page }) => {
    const navLink = page.locator('header').getByRole('link', { name: 'Festivais', exact: true });
    const open = page.getByRole('button', { name: 'Abrir menu' });
    await expect(open).toBeVisible();
    await open.click();

    await expect(navLink).toBeVisible();
    await page.getByRole('button', { name: 'Fechar menu' }).click();
    await expect(navLink).toBeHidden();
  });

  test('menu fecha com a tecla Escape', async ({ page }) => {
    const navLink = page.locator('header').getByRole('link', { name: 'Festivais', exact: true });
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expect(navLink).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(navLink).toBeHidden();
  });
});

test.describe('Calculadora de preço', () => {
  test('recalcula receita, comissão e líquido ao mover os sliders', async ({ page }) => {
    const sliders = page.locator('input[type=range]');
    await expect(sliders).toHaveCount(2);

    // padrão: 200 inscrições × R$150 = R$ 30.000
    await expect(page.getByText('R$ 30.000')).toBeVisible();
    await expect(page.getByText('R$ 3.000')).toBeVisible();
    await expect(page.getByText('R$ 27.000')).toBeVisible();

    // dobra as inscrições → dobra a receita
    await sliders.first().fill('400');
    await expect(page.getByText('R$ 60.000')).toBeVisible();
    await expect(page.getByText('R$ 6.000')).toBeVisible();
    await expect(page.getByText('R$ 54.000')).toBeVisible();
  });

  test('comissão é sempre 10% da receita bruta', async ({ page }) => {
    const sliders = page.locator('input[type=range]');
    await sliders.first().fill('350');
    await sliders.last().fill('200');
    // 350 × 200 = 70.000 → comissão 7.000 → líquido 63.000
    await expect(page.getByText('R$ 70.000')).toBeVisible();
    await expect(page.getByText('R$ 7.000')).toBeVisible();
    await expect(page.getByText('R$ 63.000')).toBeVisible();
  });

  test('sliders são anunciáveis por leitor de tela', async ({ page }) => {
    const sliders = page.locator('input[type=range]');
    for (const slider of await sliders.all()) {
      const name = await slider.evaluate((el: HTMLInputElement) => {
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
        if (el.id) return document.querySelector(`label[for="${el.id}"]`)?.textContent ?? null;
        return null;
      });
      expect(name, 'slider precisa de aria-label ou <label for>').toBeTruthy();
    }
  });
});

test.describe('FAQ', () => {
  test('abre e fecha as perguntas', async ({ page }) => {
    const q = page.getByRole('button', { name: /funciona mesmo offline/i });
    await q.click();
    await expect(page.getByText(/o app sincroniza automaticamente/i)).toBeVisible();
    await q.click();
    await expect(page.getByText(/o app sincroniza automaticamente/i)).toBeHidden();
  });

  test('expõe estado aberto/fechado para leitor de tela', async ({ page }) => {
    const q = page.getByRole('button', { name: /funciona mesmo offline/i });
    await expect(q).toHaveAttribute('aria-expanded', 'false');
    await q.click();
    await expect(q).toHaveAttribute('aria-expanded', 'true');
  });

  test('as 6 perguntas do FAQ batem com o JSON-LD do <head>', async ({ page }) => {
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    const graph = JSON.parse(jsonLd!)['@graph'];
    const faqPage = graph.find((n: any) => n['@type'] === 'FAQPage');
    const schemaQuestions: string[] = faqPage.mainEntity.map((q: any) => q.name);

    for (const question of schemaQuestions) {
      await expect(
        page.getByRole('button', { name: question }),
        `pergunta do schema ausente na página: "${question}"`
      ).toBeVisible();
    }
  });
});

test.describe('Conversão', () => {
  test('CTA final leva para /criar-evento', async ({ page }) => {
    await page.getByRole('button', { name: /criar meu festival grátis/i }).last().click();
    await expect(page).toHaveURL(/\/criar-evento/);
  });

  test('botão flutuante do WhatsApp aponta pro número certo', async ({ page }) => {
    const wa = page.getByRole('link', { name: 'Falar no WhatsApp' }).last();
    await expect(wa).toHaveAttribute('href', /wa\.me\/5517997936169/);
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', /noopener/);
  });
});

test.describe('SEO', () => {
  test('tem title, description e canonical', async ({ page }) => {
    await expect(page).toHaveTitle(/CoreoHub/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /festivais e mostras de dança/i
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /coreohub\.com/);
  });

  test('tem exatamente um H1', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('imagens de conteúdo têm alt', async ({ page }) => {
    const imgs = page.locator('img:not([aria-hidden="true"])');
    for (const img of await imgs.all()) {
      await expect(img).toHaveAttribute('alt', /.+/);
    }
  });
});

test.describe('Performance', () => {
  test('nenhuma imagem passa de 500KB', async ({ page }) => {
    // mede pela resposta de rede — resource timing zera encodedBodySize em cache
    const sizes: { file: string; kb: number }[] = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (!/\.(png|jpe?g|webp)(\?|$)/.test(url)) return;
      const len = Number(res.headers()['content-length'] ?? 0);
      if (len) sizes.push({ file: url.split('/').pop()!, kb: Math.round(len / 1024) });
    });

    await page.reload({ waitUntil: 'networkidle' });

    const oversized = sizes.filter((s) => s.kb > 500);
    expect(oversized, `imagens acima de 500KB: ${JSON.stringify(oversized)}`).toEqual([]);
  });

  test('não há erros no console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
