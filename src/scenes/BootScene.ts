import Phaser from 'phaser';
import { availableAssets, CHAR_H, CHAR_W } from '../assets/registry';

/**
 * 起動シーン。public/assets/ に置かれた正式素材（フィールド用）を読み込む。
 * - 背景など: `asset:<拡張子なしのパス>`
 * - キャラクター歩行: `char:<フォルダ>`（96×128 の 4×4。行は 下・上・左・右）
 * - キャラクター静止: `stand:<フォルダ>`（96×128 の 4 コマ。下・上・左・右）
 * UI 用の画像（立ち絵・顔）は DOM 側が URL で直接参照する。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setBaseURL(import.meta.env.BASE_URL);
    for (const file of availableAssets()) {
      const path = file.replace(/\.(png|webp|jpg)$/i, '');
      const m = /^characters\/([^/]+)\/(walk|stand)$/.exec(path);
      if (m) this.load.spritesheet(`${m[2] === 'walk' ? 'char' : 'stand'}:${m[1]}`, `assets/${file}`, { frameWidth: CHAR_W, frameHeight: CHAR_H });
      else if (path.startsWith('maps/') || path.startsWith('backgrounds/rooms/') || path.startsWith('props/')) this.load.image(`asset:${path}`, `assets/${file}`);
    }
  }

  create(): void {
    this.scene.start('Field');
  }
}
