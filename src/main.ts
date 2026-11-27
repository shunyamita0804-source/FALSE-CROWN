import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { GAME_WIDTH, GAME_HEIGHT, BACKGROUND_COLOR } from './config/display';
import { installIntegerScaling } from './scale';
import { BootScene } from './scenes/BootScene';
import { PlaceholderScene } from './scenes/PlaceholderScene';

// タッチ端末ではタッチ操作ボタンを表示
if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: BACKGROUND_COLOR,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { keyboard: false },
  scene: [BootScene, PlaceholderScene],
});

installIntegerScaling(game);

// オフライン用 Service Worker（Capacitor アプリ内では不要なので登録しない）
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if (!isNative && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}
