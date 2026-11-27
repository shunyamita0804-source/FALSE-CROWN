import Phaser from 'phaser';
import { MAX_DEVICE_PIXEL_RATIO, REFERENCE_HEIGHT } from '../config/display';

export function deviceScale(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
}

export interface ScreenBox {
  width: number;
  height: number;
  /** セーフエリア（CSS ピクセル） */
  safe: { top: number; right: number; bottom: number; left: number };
}

/**
 * 実際に使える画面の大きさとセーフエリア。
 * iPhone のホーム画面から起動した横向き表示では、縦向きのステータスバーぶん（約 47〜59pt）が
 * 「上の余白」として報告され、そのぶん画面の高さが短く伝えられることがある（下に黒い帯が出て、上部 UI が下がる）。
 * 横向きの iPhone に上の余白は無いので、その場合は余白を 0 とし、高さを本来の画面いっぱいに戻す。
 */
export function screenBox(): ScreenBox {
  let width = window.visualViewport?.width ?? window.innerWidth;
  let height = window.visualViewport?.height ?? window.innerHeight;
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.getElementById('safe-probe');
  if (probe) {
    const cs = getComputedStyle(probe);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) safe[side] = parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0;
  }
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const landscape = width > height;
  const phone = Math.min(screen.width, screen.height) <= 500;
  if (touch && landscape && phone && safe.top > 30) {
    const full = Math.min(screen.width, screen.height);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    // 画面の高さが、上の余白ぶんだけ短く伝えられている時だけ戻す
    if (standalone && height < full - 1 && height + safe.top <= full + 1) height = Math.min(full, height + safe.top);
    safe.top = 0;
  }
  void width;
  return { width, height, safe };
}

/** ページ全体（背景のゲーム画面と UI）を、使える画面いっぱいに広げる */
export function fitPageToScreen(): ScreenBox {
  const box = screenBox();
  const short = box.height > (window.visualViewport?.height ?? window.innerHeight) + 1;
  const px = short ? `${box.height}px` : '';
  // 高さが短く伝えられている時だけ、明示的に画面いっぱいの高さを指定する
  document.documentElement.style.height = px;
  document.body.style.height = px;
  const game = document.getElementById('game');
  if (game) game.style.height = px;
  if (game) game.style.bottom = short ? 'auto' : '';
  return box;
}

/** キャンバスを端末の実解像度に合わせ続ける（低解像度からの拡大はしない） */
export function installNativeResolution(game: Phaser.Game): void {
  const apply = () => {
    const dpr = deviceScale();
    const { width: w, height: h } = fitPageToScreen();
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
