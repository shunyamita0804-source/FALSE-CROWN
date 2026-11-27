/**
 * 描画の基準値。
 *
 * キャンバスは常に端末の実解像度（CSS ピクセル × devicePixelRatio）で描画する。
 * 低解像度で描いて拡大する方式や、全画面のピクセル化・ぼかし・レトロフィルターは使わない
 * （docs/graphics-direction.md 参照）。
 *
 * レイアウトは「基準の高さ」を単位にした論理座標で行い、横幅は端末の縦横比に応じて伸縮する。
 * 数値は仮のもので、仕様確定後に調整する。
 */
export const REFERENCE_HEIGHT = 1080;

/** 極端に高密度な端末での負荷を抑えるための devicePixelRatio 上限（仮） */
export const MAX_DEVICE_PIXEL_RATIO = 3;

export const BACKGROUND_COLOR = '#000000';
