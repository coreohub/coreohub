/**
 * Detecta navegadores embutidos (in-app WebView) de apps sociais onde o OAuth
 * do Google é bloqueado pelo próprio Google (erro 403 disallowed_useragent).
 *
 * Usado na tela de login pra esconder o "Continuar com Google" dentro do
 * Instagram/Facebook/TikTok e oferecer login por e-mail (OTP + link mágico),
 * que funciona em qualquer WebView.
 *
 * Função pura (recebe a UA por parâmetro) pra ser testável sem DOM.
 */
export function isInAppBrowser(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): boolean {
  if (!ua) return false;
  // Instagram | Facebook (FBAN/FBAV/FB_IAB/FBIOS) | TikTok (musical_ly) | Line.
  return /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|Line\//i.test(ua);
}
