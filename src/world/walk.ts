/**
 * 歩行アニメーションの共通処理（主人公と NPC で同じものを使う）。
 * 経過時間ではなく進んだ距離でコマを送るので、移動速度と足の動きが常に一致し、フレームレートにも依存しない。
 */

/** 止まってから待機画像に切り替えるまでの時間（ms）。マスの継ぎ目では切り替えない */
export const WALK_LINGER_MS = 70;
/** 歩行 1 コマあたりに進む距離（px）。4 コマで 2 マスぶん */
export const WALK_FRAME_PX = 32; // タイル 64px の半分

/** 進んだ距離から歩行のコマ番号（0〜3）を求める */
export function walkFrame(distPx: number): number {
  return Math.floor(Math.max(0, distPx) / WALK_FRAME_PX) % 4;
}
