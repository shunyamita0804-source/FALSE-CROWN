import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import pkg from './package.json' with { type: 'json' };

/**
 * public/assets/ にある画像の一覧を `virtual:asset-list` として公開する。
 * 素材レジストリはこれを見て、正式素材があれば使い、無ければ仮素材で描画する。
 */
function assetList() {
  const root = join(process.cwd(), 'public', 'assets');
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return out;
    }
    for (const n of names) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (/\.(png|webp|jpg)$/i.test(n)) out.push(relative(root, p).split('\\').join('/'));
    }
    return out;
  };
  const id = 'virtual:asset-list';
  return {
    name: 'fc-asset-list',
    resolveId(source: string) {
      return source === id ? '\0' + id : null;
    },
    load(source: string) {
      return source === '\0' + id ? `export default ${JSON.stringify(walk(root))};` : null;
    },
  };
}

// GitHub Pages ではリポジトリ名配下（/FALSE-CROWN/）で配信される。
// Capacitor（iOS）ビルド時は相対パス './' を使う: `BASE_PATH=./ npm run build`
const base = process.env.BASE_PATH ?? '/FALSE-CROWN/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    assetList(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: [],
      manifest: {
        name: 'FALSE CROWN',
        short_name: 'FALSE CROWN',
        description: 'FALSE CROWN（仮タイトル）',
        lang: 'ja',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#050a18',
        theme_color: '#050a18',
        start_url: '.',
        scope: '.',
        // 正式アイコンは加工せず、原寸の 1 枚をそのまま指定する（縮小は端末側の表示に任せる）
        icons: [
          { src: 'assets/ui/logo/app_icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
          { src: 'assets/ui/logo/app_icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ゲーム素材（画像・音声・マップ・フォント）もすべてプリキャッシュしてオフライン動作させる
        globPatterns: ['**/*.{js,css,html,png,jpg,webp,svg,json,tmj,tsj,xml,ttf,otf,woff,woff2,mp3,ogg,m4a,wav}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // 初回読み込みを軽くするため、BGM と表情差分の立ち絵はプリキャッシュせず、使った時にキャッシュする。
        // （BGM はオフライン時は鳴らない。効果音・顔アイコン・歩行素材・通常立ち絵はオフラインでも使える）
        globIgnores: ['**/assets/audio/bgm/**', '**/assets/characters/*/portrait_!(normal).png', '**/assets/maps/**', '**/assets/backgrounds/**', '**/assets/props/**', '**/assets/tilesets/**', '**/assets/ui/background/**', '**/assets/ui/games/**'],
        runtimeCaching: [
          {
            // マップ背景とストーリー背景は容量が大きいので、表示した時にキャッシュする
            urlPattern: /\/assets\/(maps|backgrounds|ui\/background|ui\/games)\/.*\.png$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fc-maps', expiration: { maxEntries: 60 } },
          },
          {
            urlPattern: /\/assets\/characters\/.*\.png$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fc-characters', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
});
