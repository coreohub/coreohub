import { describe, it, expect } from 'vitest';
import { isInAppBrowser } from '../utils/inAppBrowser';

// UAs reais (abreviados) coletados de cada in-app browser.
const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0.0.41.93 (iPhone15,2; iOS 17_4)';
const FACEBOOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/445.0.0.30.118;]';
const TIKTOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.0.0 Mobile Safari/537.36 musical_ly_2023 TikTok';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('isInAppBrowser', () => {
  it('detecta WebView do Instagram', () => {
    expect(isInAppBrowser(INSTAGRAM_IOS)).toBe(true);
  });

  it('detecta WebView do Facebook (FB_IAB/FBAV)', () => {
    expect(isInAppBrowser(FACEBOOK_ANDROID)).toBe(true);
  });

  it('detecta WebView do TikTok (musical_ly)', () => {
    expect(isInAppBrowser(TIKTOK_ANDROID)).toBe(true);
  });

  it('NÃO marca Chrome Android como in-app', () => {
    expect(isInAppBrowser(CHROME_ANDROID)).toBe(false);
  });

  it('NÃO marca Safari iOS como in-app', () => {
    expect(isInAppBrowser(SAFARI_IOS)).toBe(false);
  });

  it('NÃO marca Chrome desktop como in-app', () => {
    expect(isInAppBrowser(CHROME_DESKTOP)).toBe(false);
  });

  it('UA vazia → false (não quebra o login normal)', () => {
    expect(isInAppBrowser('')).toBe(false);
  });
});
