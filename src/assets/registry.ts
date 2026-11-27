/**
 * 素材レジストリ：論理ID → 画像パス・シート分割・アンカー・スケール・9-slice。
 * ゲームロジックと UI は論理ID だけを使う。正式素材（PNG）が public/assets/ に置かれると、
 * ビルド時に生成される一覧（virtual:asset-list）で検出され、仮素材から自動で切り替わる。
 * 素材が無い ID は assets/placeholders.ts の仮素材で描画する（進行は止めない）。
 *
 * 寸法は 03_ENGINE_ASSETS_QA.md の補正値（キャラ 96×128、タイル 64、立ち絵 768×1024、顔 256）。
 */
import available from 'virtual:asset-list';

export const TILE = 64;
export const CHAR_W = 96;
export const CHAR_H = 128;
/** セル内の足元基準 */
export const CHAR_FOOT = { x: 48, y: 120 };

export interface AssetDef {
  /** public/assets/ からの相対パス（拡張子なし） */
  path: string;
  frame?: { w: number; h: number };
  anchor?: { x: number; y: number };
  scale?: number;
  slice?: { l: number; r: number; t: number; b: number };
}

const set = new Set<string>(available as string[]);

/** 正式素材が存在するか（拡張子 .png / .webp / .jpg） */
export function assetFile(path: string): string | null {
  for (const ext of ['png', 'webp', 'jpg']) if (set.has(`${path}.${ext}`)) return `${path}.${ext}`;
  return null;
}

export function assetUrl(path: string): string | null {
  const f = assetFile(path);
  return f ? `${import.meta.env.BASE_URL}assets/${f}` : null;
}

export const charAsset = (id: string, kind: 'walk' | 'stand' | 'face' | `portrait_${string}`) => `characters/${id}/${kind}`;

/** キャラクターの素材フォルダ名（主人公は性別で分かれる） */
export function charFolder(id: string, gender: 'm' | 'f'): string {
  return id === 'hero' ? `hero_${gender}` : id;
}

export const EXPRESSIONS = ['normal', 'smile', 'anger', 'sad', 'wary', 'smirk', 'surprise', 'think'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** UI の 9-slice 余白（暫定。正式素材で確認して調整） */
export const UI_ASSETS: Record<string, AssetDef> = {
  'panel/window': { path: 'ui/panel/window', slice: { l: 48, r: 48, t: 48, b: 48 } },
  'panel/dialogue': { path: 'ui/panel/dialogue', slice: { l: 64, r: 64, t: 48, b: 48 } },
  'panel/nameplate': { path: 'ui/panel/nameplate', slice: { l: 40, r: 40, t: 24, b: 24 } },
  'panel/negotiation': { path: 'ui/panel/negotiation', slice: { l: 48, r: 48, t: 48, b: 48 } },
  'panel/hud': { path: 'ui/panel/hud', slice: { l: 64, r: 64, t: 24, b: 24 } },
  'panel/card': { path: 'ui/panel/card', slice: { l: 40, r: 40, t: 40, b: 40 } },
  'panel/card_back': { path: 'ui/panel/card_back' },
  'button/primary_normal': { path: 'ui/button/primary_normal', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/primary_pressed': { path: 'ui/button/primary_pressed', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/primary_disabled': { path: 'ui/button/primary_disabled', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/secondary_normal': { path: 'ui/button/secondary_normal', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/secondary_pressed': { path: 'ui/button/secondary_pressed', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/secondary_disabled': { path: 'ui/button/secondary_disabled', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/danger_normal': { path: 'ui/button/danger_normal', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/danger_pressed': { path: 'ui/button/danger_pressed', slice: { l: 48, r: 48, t: 32, b: 32 } },
  'button/danger_disabled': { path: 'ui/button/danger_disabled', slice: { l: 48, r: 48, t: 32, b: 32 } },
};

/**
 * 正式 UI 素材が届いている場合、CSS 変数として公開する（border-image で 9-slice）。
 * 届いていない部品は CSS の仮デザインのまま。
 */
export function applyUiAssets(root: HTMLElement = document.documentElement): string[] {
  const applied: string[] = [];
  for (const [id, def] of Object.entries(UI_ASSETS)) {
    const url = assetUrl(def.path);
    if (!url) continue;
    const name = `--asset-${id.replace(/[/_]/g, '-')}`;
    root.style.setProperty(name, `url("${url}")`);
    if (def.slice) root.style.setProperty(`${name}-slice`, `${def.slice.t} ${def.slice.r} ${def.slice.b} ${def.slice.l}`);
    applied.push(id);
  }
  root.dataset.uiAssets = applied.join(' ');
  return applied;
}

export function iconUrl(name: string): string | null {
  return assetUrl(`ui/icons/${name}`);
}

export function availableAssets(): string[] {
  return [...set];
}
