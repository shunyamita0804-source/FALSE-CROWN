import Phaser from 'phaser';
import { availableAssets, CHAR_H, CHAR_W } from '../assets/registry';

/**
 * 起動シーン。public/assets/ に置かれた正式素材（フィールド用）を読み込む。
 * - マップ背景 `asset:<拡張子なしのパス>` は容量が大きいので、FieldScene が部屋に入る時に読み込む
 * - キャラクター歩行: `char:<フォルダ>`（96×128 の 4×4。行は 下・上・左・右）
 * - キャラクター静止: `stand:<フォルダ>`（96×128 の 4 コマ。下・上・左・右）
 * - 着席（届いた人だけ）: `sit:<フォルダ>`（96×128 の 4 コマ。正面・後ろ・左・右。腰はマスの (48, 90)）、
 *   斜め `sitd:<フォルダ>`（右下・左下・右上・左上）。無い人は FieldScene が立ち絵で仮に描く
 * UI 用の画像（立ち絵・顔）は DOM 側が URL で直接参照する。
 */
const SHEET_KEY: Record<string, string> = { walk: 'char', stand: 'stand', sit: 'sit', sit_diag: 'sitd' };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setBaseURL(import.meta.env.BASE_URL);
    for (const file of availableAssets()) {
      const path = file.replace(/\.(png|webp|jpg)$/i, '');
      const m = /^characters\/([^/]+)\/(walk|stand|sit|sit_diag)$/.exec(path);
      if (m) this.load.spritesheet(`${SHEET_KEY[m[2]]}:${m[1]}`, `assets/${file}`, { frameWidth: CHAR_W, frameHeight: CHAR_H });
    }
  }

  create(): void {
    this.scene.start('Field');
  }
}
