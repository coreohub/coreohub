/**
 * Proxy de download pra documentos do Storage (regulamento PDF, extras).
 *
 * Sem isso, o link na vitrine aponta direto pro Supabase Storage
 * (ghpltzzijlvykiytwslu.supabase.co/...) — como é cross-origin, o atributo
 * `download` do <a> é ignorado pelo navegador e o clique navega pra uma
 * aba nova mostrando a URL crua do Supabase, em vez de baixar o arquivo.
 * Aqui o link fica same-origin (coreohub.com), o servidor busca o PDF e
 * devolve com Content-Disposition: attachment — o navegador baixa direto,
 * sem trocar de aba nem expor a URL de Storage.
 *
 * Allowlist de origem fixa (só bucket público do próprio projeto Supabase)
 * pra não virar um open proxy — nunca aceitar URL arbitrária do caller.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_PREFIX = 'https://ghpltzzijlvykiytwslu.supabase.co/storage/v1/object/public/';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  const nome = typeof req.query.nome === 'string' ? req.query.nome : 'documento.pdf';

  if (!url || !url.startsWith(ALLOWED_PREFIX)) {
    res.status(400).send('URL inválida.');
    return;
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).send('Não foi possível baixar o documento.');
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'application/pdf';
    const safeName = nome.replace(/[^\w.\- áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '').trim() || 'documento.pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(200).send(buffer);
  } catch {
    res.status(502).send('Erro ao buscar o documento.');
  }
}
