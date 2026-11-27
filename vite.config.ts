import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages ではリポジトリ名配下（/FALSE-CROWN/）で配信される。
// Capacitor（iOS）ビルド時は相対パス './' を使う: `BASE_PATH=./ npm run build`
const base = process.env.BASE_PATH ?? '/FALSE-CROWN/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'FALSE CROWN',
        short_name: 'FALSE CROWN',
        description: 'FALSE CROWN（仮タイトル）',
        lang: 'ja',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#000000',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ゲーム素材（画像・音声・マップ・フォント）もすべてプリキャッシュしてオフライン動作させる
        globPatterns: ['**/*.{js,css,html,png,jpg,webp,svg,json,tmj,tsj,xml,ttf,otf,woff,woff2,mp3,ogg,m4a,wav}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
