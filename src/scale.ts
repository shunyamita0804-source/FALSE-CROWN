import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config/display';

/** 画面に収まる最大の整数倍率を計算し、ドットが崩れないように拡大する */
export function computeIntegerZoom(): number {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  // 物理ピクセル単位で整数倍にそろえ、CSS 側では dpr で割って表示する
  const physical = Math.floor(Math.min((vw * dpr) / GAME_WIDTH, (vh * dpr) / GAME_HEIGHT));
  return Math.max(1, physical) / dpr;
}

export function installIntegerScaling(game: Phaser.Game): void {
  const apply = () => game.scale.setZoom(computeIntegerZoom());
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 200));
  apply();
}
