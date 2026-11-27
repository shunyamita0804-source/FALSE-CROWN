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
/** フィールド上の表示倍率（素材は加工せず、表示だけを拡大。足元の位置は変えない） */
export const CHAR_SCALE = 1.3;

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

/**
 * 正式 UI 素材。slice は元画像のピクセル単位での 9-slice 余白（四隅の装飾を伸ばさずに保つための値）。
 * 画像そのものは加工せず、CSS の border-image と background で表示する。
 */
const S = (v: number, h = v) => ({ l: h, r: h, t: v, b: v });
const BUTTON_KINDS = ['primary', 'secondary', 'danger'] as const;
const BUTTON_STATES = ['normal', 'pressed', 'disabled'] as const;
export const UI_ASSETS: Record<string, AssetDef> = {
  'panel/window': { path: 'ui/panel/window', slice: S(96) },
  'panel/dialogue': { path: 'ui/panel/dialogue', slice: S(56) },
  'panel/nameplate': { path: 'ui/panel/nameplate', slice: S(44, 40) },
  'panel/negotiation': { path: 'ui/panel/negotiation', slice: S(100) },
  // 左右の端だけを固定し、中央（4 区画の仕切りを含む）を横に伸ばす
  'panel/hud': { path: 'ui/panel/hud', slice: S(0, 70) },
  'panel/card': { path: 'ui/panel/card' },
  'panel/card_back': { path: 'ui/panel/card_back' },
  'panel/tab': { path: 'ui/panel/tab', slice: S(36) },
  'panel/progress_track': { path: 'ui/panel/progress_track', slice: S(0, 16) },
  'panel/progress_fill': { path: 'ui/panel/progress_fill' },
  ...Object.fromEntries(BUTTON_KINDS.flatMap((k) => BUTTON_STATES.map((st) => [`button/${k}_${st}`, { path: `ui/button/${k}_${st}`, slice: S(32) }]))),
  'control/dpad': { path: 'ui/control/dpad' },
  'control/action': { path: 'ui/control/action' },
  'control/cursor': { path: 'ui/control/cursor' },
  'background/title': { path: 'ui/background/title' },
  'background/menu': { path: 'ui/background/menu' },
  'background/result': { path: 'ui/background/result' },
  'background/prison_result': { path: 'ui/background/prison_result' },
  'icons/piece_gold': { path: 'ui/icons/piece_gold' },
  // v11 の追加素材。枠は四隅を伸ばさない 9-slice、タイル面は色をプログラム側で重ねる
  'v11/m01/puzzle_frame': { path: 'ui/v11/m01/puzzle_frame', slice: S(96) },
  'v11/m01/tile_surface': { path: 'ui/v11/m01/tile_surface' },
  'v11/m01/completion_glow': { path: 'ui/v11/m01/completion_glow' },
  'v11/m02/flash_frame': { path: 'ui/v11/m02/flash_frame', slice: S(60) },
  'v11/m03/pair_plate': { path: 'ui/v11/m03/pair_plate' },
  'v11/m04/rail_resource': { path: 'ui/v11/m04/rail_resource' },
  'v11/m05/relay_plate': { path: 'ui/v11/m05/relay_plate', slice: S(40) },
  'v11/m06/card_back': { path: 'ui/v11/m06/card_back' },
  'v11/prison/compact_frame': { path: 'ui/v11/prison/compact_frame', slice: S(96) },
  'v11/hidden/challenge_frame': { path: 'ui/v11/hidden/challenge_frame', slice: S(96) },
};

/** 演出用の帯。band は文字を載せる帯の中心と高さ（画像の高さに対する割合）。無い素材は画像の下に文字を出す */
export const FX_ASSETS = {
  victory: { path: 'ui/effects/victory', band: { y: 0.633, h: 0.2 } },
  defeat: { path: 'ui/effects/defeat', band: { y: 0.596, h: 0.34 } },
  elimination: { path: 'ui/effects/elimination', band: null },
  discovery: { path: 'ui/effects/discovery', band: null },
  final: { path: 'ui/effects/final', band: null },
} as const;
export type FxName = keyof typeof FX_ASSETS;

/**
 * 競技専用素材の割り当て。1 枚に複数の図柄が並ぶ素材は、元画像上の範囲（x0, y0, x1, y1）で図柄を指定し、
 * 画像は切り出さずに表示位置だけをずらして使う。
 */
export interface GameArt { path: string; size: number; box?: [number, number, number, number] }
const GA = (game: string, n: number, box?: [number, number, number, number]): GameArt => ({ path: `ui/games/${game}/asset_0${n}`, size: 512, box });
export const GAME_ART = {
  m01: {
    nation0: GA('m01', 1, [43, 10, 244, 252]), nation1: GA('m01', 1, [266, 10, 468, 252]), nation2: GA('m01', 1, [43, 258, 245, 502]), neutral: GA('m01', 1, [267, 258, 469, 502]),
    territory: GA('m01', 2), resource: GA('m01', 3),
    invade: GA('m01', 4, [10, 201, 106, 311]), defend: GA('m01', 4, [111, 201, 206, 311]), produce: GA('m01', 4, [209, 201, 304, 311]), hoard: GA('m01', 4, [309, 201, 402, 311]), spy: GA('m01', 4, [407, 201, 502, 311]),
  },
  m02: { crown: GA('m02', 1), gem: GA('m02', 2), key: GA('m02', 3), book: GA('m02', 4), coin: GA('m02', 5), gavel: GA('m02', 6) },
  m03: { chair: GA('m03', 1), member: GA('m03', 2), merchant: GA('m03', 3), rebel: GA('m03', 4), yes: GA('m03', 5, [10, 115, 254, 397]), no: GA('m03', 5, [259, 115, 502, 397]), bill: GA('m03', 6) },
  m04: { station: GA('m04', 1), rail: GA('m04', 2), train: GA('m04', 3), cargo: GA('m04', 4), mission: GA('m04', 5), fund: GA('m04', 6) },
  m05: { cards: GA('m05', 1), seal: GA('m05', 2) },
  m06: { tower: GA('m06', 1), piece: GA('m06', 2), value: GA('m06', 3) },
  m07: { vault: GA('m07', 1), token: GA('m07', 2), markers: GA('m07', 3) },
  m08: { device: GA('m08', 1), clue: GA('m08', 2), input: GA('m08', 3) },
  m09: { king: GA('m09', 1), soldier: GA('m09', 2), target: GA('m09', 3) },
  m10: { coop: GA('m10', 1), attack: GA('m10', 2) },
  m11: { throne: GA('m11', 1), emblem: GA('m11', 2), progress: GA('m11', 3) },
} as const;

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
