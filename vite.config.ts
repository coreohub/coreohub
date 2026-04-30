import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        tailwindcss(),
        VitePWA({
          registerType: 'autoUpdate',
          // Em dev fica desabilitado por default pra não atrapalhar HMR.
          devOptions: { enabled: false },
          // Activos extras incluídos no precache (cobertura offline-first).
          includeAssets: ['coreohub-avatar.png', 'CoreoHub - Avatar.png'],
          manifest: {
            name: 'CoreoHub',
            short_name: 'CoreoHub',
            description: 'Gestão Inteligente para Festivais de Dança',
            theme_color: '#ff0068',
            background_color: '#0b0b0f',
            display: 'standalone',
            orientation: 'any',
            scope: '/',
            start_url: '/',
            lang: 'pt-BR',
            categories: ['productivity', 'business'],
            icons: [
              {
                src: '/coreohub-avatar.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
              },
              {
                src: '/coreohub-avatar.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any',
              },
              {
                src: '/coreohub-avatar.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
              },
            ],
          },
          workbox: {
            // Tamanho máximo de ativo no precache (Vite gera bundles grandes).
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            // Estratégia de runtime: Supabase API e Storage não devem ser cacheadas
            // pra evitar dados velhos no terminal. App shell é cacheada estaticamente.
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/api/, /^\/functions/],
            runtimeCaching: [
              {
                // Imagens externas (avatares, banners) — cache stale-while-revalidate
                urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|svg|webp|gif)$/i,
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'coreohub-images',
                  expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
                },
              },
              {
                // Supabase REST/RPC: NetworkOnly — sempre dado fresco
                urlPattern: /^https:\/\/.*\.supabase\.co\/(rest|functions)\//,
                handler: 'NetworkOnly',
              },
            ],
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
