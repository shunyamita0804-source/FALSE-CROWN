import Phaser from 'phaser';
import { MAX_DEVICE_PIXEL_RATIO, REFERENCE_HEIGHT } from '../config/display';

export function deviceScale(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
}

/** キャンバスを端末の実解像度に合わせ続ける（低解像度からの拡大はしない） */
export function installNativeResolution(game: Phaser.Game): void {
  const apply = () => {
    const dpr = deviceScale();
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    game.scale.setZoom(1 / dpr);
    game.scale.resize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  };
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 200));
  apply();
}

export interface LogicalView {
  /** 論理座標での画面幅（端末の縦横比で変わる） */
  width: number;
  /** 論理座標での画面高さ（常に REFERENCE_HEIGHT） */
  height: number;
  /** 論理座標 → 実ピクセルの倍率 */
  zoom: number;
}

/**
 * シーンのメインカメラを「高さ REFERENCE_HEIGHT の論理座標」に合わせ、
 * 画面サイズが変わるたびに onLayout を呼ぶ。
 * フィールドと UI はそれぞれ別シーン・別カメラで、この関数を個別に使う。
 */
export function fitCameraToReference(scene: Phaser.Scene, onLayout: (view: LogicalView) => void): void {
  const apply = () => {
    const { width, height } = scene.scale.gameSize;
    const zoom = height / REFERENCE_HEIGHT;
    const view: LogicalView = { width: width / zoom, height: REFERENCE_HEIGHT, zoom };
    const cam = scene.cameras.main;
    cam.setSize(width, height);
    cam.setZoom(zoom);
    cam.centerOn(view.width / 2, view.height / 2);
    onLayout(view);
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, apply));
  apply();
}
