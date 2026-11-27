import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { BACKGROUND_COLOR } from './config/display';
import { installNativeResolution } from './display/viewport';
import { BootScene } from './scenes/BootScene';
import { FieldScene } from './scenes/FieldScene';
import { UIScene } from './scenes/UIScene';

// タッチ端末ではタッチ操作ボタンを表示
if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
}

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
  scale: {
    mode: Phaser.Scale.NONE,
  },
  input: { keyboard: false },
  scene: [BootScene, FieldScene, UIScene],
});

installNativeResolution(game);

// オフライン用 Service Worker（Capacitor アプリ内では不要なので登録しない）
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if (!isNative && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}
