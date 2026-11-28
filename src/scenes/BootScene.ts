import Phaser from 'phaser';
import { availableAssets, CHAR_H, CHAR_W } from '../assets/registry';

/**
 * 起動シーン。public/assets/ に置かれた正式素材（フィールド用）を読み込む。
 * - マップ背景 `asset:<拡張子なしのパス>` は容量が大きいので、FieldScene が部屋に入る時に読み込む
 * - キャラクター歩行: `char:<フォルダ>`（96×128 の 4×4。行は 下・上・左・右）
 * - キャラクター静止: `stand:<フォルダ>`（96×128 の 4 コマ。下・上・左・右）
 * - 着席（届いた人だけ）: `sit:<フォルダ>`（96×128 の 4 コマ。正面・後ろ・左・右。腰はマスの (48, 90)）、
 *   斜め `sitd:<フォルダ>`（右下・左下・右上・左上）。無い人は FieldScene が立ち絵で仮に描く
 * どれも 2 倍の解像度（`<名前>@2x.png`、1 コマ 192×256、基準点も 2 倍）を置けば、そちらを使う。
 * UI 用の画像（立ち絵・顔）は DOM 側が URL で直接参照する。
 */
const SHEET_KEY: Record<string, string> = { walk: 'char', stand: 'stand', sit: 'sit', sit_diag: 'sitd' };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setBaseURL(import.meta.env.BASE_URL);
    // 2 倍の解像度の絵（<名前>@2x.png、1 コマ 192×256）があれば、そちらを優先して読む。
    // 表示の大きさと基準点（足元・腰）は比率で決めているので、コマの画素数が違っても同じ位置・同じ大きさに出る
    const files = availableAssets();
    const has2x = new Set(files.map((f) => f.replace(/\.(png|webp|jpg)$/i, '')).filter((p) => p.endsWith('@2x')));
    for (const file of files) {
      const path = file.replace(/\.(png|webp|jpg)$/i, '');
      const m = /^characters\/([^/]+)\/(walk|stand|sit|sit_diag)(@2x)?$/.exec(path);
      if (!m) continue;
      const k = m[3] ? 2 : 1;
      if (k === 1 && has2x.has(`${path}@2x`)) continue;
      this.load.spritesheet(`${SHEET_KEY[m[2]]}:${m[1]}`, `assets/${file}`, { frameWidth: CHAR_W * k, frameHeight: CHAR_H * k });
    }
  }

  create(): void {
    this.scene.start('Field');
  }
}
