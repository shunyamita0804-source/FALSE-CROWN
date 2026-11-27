import { Input } from './input/InputState';
import { placeIn, setPathTo } from './world/sim';
import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { CHANNEL } from './app/entitlement';
import { applyUpdateIfAny, pokeServiceWorker, updateAvailable } from './app/update';
import { rescueFlow } from './ui/rescue';
import { ceremonyScreen, handoutScreen } from './ui/ceremony';
import { G, runGame } from './app/game';
import { applyUiAssets } from './assets/registry';
import { Sound } from './audio/audio';
import { BACKGROUND_COLOR } from './config/display';
import { newGame } from './core/state';
import type { GameState } from './core/types';
import { installNativeResolution } from './display/viewport';
import { t } from './i18n/i18n';
import { deleteSave, loadGame } from './save/save';
import { BootScene } from './scenes/BootScene';
import { FieldScene } from './scenes/FieldScene';
import { setHeroGender } from './ui/art';
import { alertDialog, initStage, toast, uiKey } from './ui/dom';
import { playMatch } from './ui/matchui';
import * as screens from './ui/screens';
import { talkTo } from './ui/talk';

if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
document.body.dataset.channel = CHANNEL;

initStage();
applyUiAssets();
Sound.init(G.meta.settings.bgm, G.meta.settings.se, G.meta.settings.voice);
screens.initSettings();

G.ui = {
  playStory: screens.playStory,
  hudShow: screens.hudShow,
  hudUpdate: screens.hudUpdate,
  hudLog: screens.hudLog,
  openMenu: () => screens.openMenu(),
  talkTo,
  playMatch,
  rulesScreen: screens.rulesScreen,
  rankingScreen: screens.rankingScreen,
  eliminationScreen: screens.eliminationScreen,
  endingScreen: screens.endingScreen,
  boardScreen: screens.boardScreen,
  purchaseScreen: screens.purchaseScreen,
  showInspect: screens.showInspect,
  rescueFlow,
  ceremony: ceremonyScreen,
  handout: handoutScreen,
};

// UI の操作音（ボタンの種類で音を変える）
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement | null)?.closest?.('button');
  if (!b || (b as HTMLButtonElement).disabled || b.dataset.key) return;
  if (b.classList.contains('btn-primary')) Sound.se('confirm');
  else if (b.classList.contains('btn-ghost')) Sound.se('back');
  else Sound.se('click');
}, true);
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && document.querySelector('.layer:not(.layer-passive)')) Sound.se('select');
});
void uiKey;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: BACKGROUND_COLOR,
  // 高精細描画: 端末の実解像度で描き、全画面のピクセル化や拡大フィルターは使わない
  antialias: true,
  pixelArt: false,
  roundPixels: false,
  scale: { mode: Phaser.Scale.NONE },
  // 画面上のボタンや HUD への操作を、フィールドへのタップとして拾わない
  input: { keyboard: false, windowEvents: false },
  audio: { noAudio: true },
  scene: [BootScene, FieldScene],
});
installNativeResolution(game);

async function boot(): Promise<void> {
  for (;;) {
    // タイトルへ戻るたびに新しい版を確認し、あれば入れ替える（プレイ中には読み込み直さない）
    if (!isNative && (await applyUpdateIfAny())) return;
    const choice = await screens.titleScreen();
    let state: GameState | null = null;
    if (choice === 'continue') {
      const loaded = loadGame();
      if (!loaded) {
        await alertDialog(t('title.loadFailTitle'), t('title.loadFail'));
        continue;
      }
      if (loaded.fromBackup) await alertDialog(t('title.backupTitle'), t('title.backup'));
      state = loaded.state;
    } else if (choice === 'new') {
      const opt = await screens.newGameScreen();
      if (!opt) continue;
      deleteSave();
      state = newGame(opt);
    } else if (import.meta.env.VITE_CHANNEL !== 'product') {
      // 製品版ビルドではこの分岐ごと取り除かれ、開発者メニューのコードは含まれない
      const { devMenu } = await import('./dev/devmenu');
      state = await devMenu();
      if (!state) continue;
    }
    if (!state) continue;
    setHeroGender(state.hero.gender);
    G.state = state;
    await runGame();
  }
}
// オフライン用 Service Worker（Capacitor アプリ内では不要なので登録しない）
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
let updateNoticed = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden || isNative) return;
  pokeServiceWorker();
  if (!G.state) void applyUpdateIfAny();
  else if (!updateNoticed) void updateAvailable().then((yes) => {
    if (!yes || updateNoticed) return;
    updateNoticed = true;
    toast(t('update.available'), 'info', 6000);
  });
});
if (import.meta.env.VITE_CHANNEL !== 'product') (window as unknown as { __fc?: unknown }).__fc = { G, Input, Sound, sim: { placeIn, setPathTo } };
void boot();

if (!isNative && 'serviceWorker' in navigator) registerSW({ immediate: true });
