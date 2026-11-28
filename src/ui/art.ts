/**
 * UI で使う人物画像（顔・立ち絵）。正式素材があればそれを、無ければ仮素材を返す。
 */
import { assetUrl, charFolder, emblemOf, EXPRESSIONS, FX_ASSETS, iconUrl, type FxName, type GameArt } from '../assets/registry';
import { drawEmblem, drawFace, drawPortrait } from '../assets/placeholders';
import { HERO_PALETTES, NPC_BY_ID, type NpcId } from '../data/characters';
import { hashString } from '../core/rng';
import portraitsJson from '../data/portraits.json';
import { h } from './dom';

const cache = new Map<string, string>();

/** 立ち絵の描き方（data/portraits.json）。bust は胸から上の新しい絵 */
interface PortraitStyle { style?: 'bust'; normal?: string }
const STYLES = (portraitsJson as unknown as { characters: Record<string, PortraitStyle> }).characters;
const styleOf = (id: string): PortraitStyle | undefined => STYLES[id];
/** 胸から上の新しい絵の人か */
export const isBustArt = (id: string): boolean => styleOf(id)?.style === 'bust';
let heroGender: 'm' | 'f' = 'm';

export function setHeroGender(g: 'm' | 'f'): void {
  heroGender = g;
}

function palette(id: string) {
  if (id === 'hero' || id === 'hero_m' || id === 'hero_f') return { pal: HERO_PALETTES[id === 'hero_f' ? 'f' : id === 'hero_m' ? 'm' : heroGender], gender: id === 'hero_f' ? 'f' as const : id === 'hero_m' ? 'm' as const : heroGender };
  if (id === 'host_observer' || id === 'host') return { pal: { hair: '#0a0a10', skin: '#f4f4f4', coat: '#0c0c12', accent: '#f4f4f4', pants: '#0a0a10' }, gender: 'm' as const };
  const def = NPC_BY_ID[id as NpcId];
  if (!def) return { pal: { hair: '#444', skin: '#ddd', coat: '#333', accent: '#888', pants: '#222' }, gender: 'm' as const };
  return { pal: def.palette, gender: def.gender };
}

export function faceUrl(id: string): string {
  const folder = charFolder(id === 'host' ? 'host_observer' : id, heroGender);
  const key = `face:${folder}`;
  let url = cache.get(key);
  if (!url) {
    // 新しい絵の人は、旧デザインの face.png を使わず、立ち絵の上側を丸く切り取って見せる（CSS の .face.face-bust）
    if (isBustArt(id)) url = portraitUrl(id, 'normal');
    url ??= assetUrl(`characters/${folder}/face`) ?? (() => {
      const { pal, gender } = palette(id);
      return drawFace(pal, gender, 128, hashString(id)).toDataURL();
    })();
    cache.set(key, url);
  }
  return url;
}


export function portraitUrl(id: string, expr = 'normal'): string {
  // 通常絵の代用（透過の通常絵が届くまで、決めた表情を通常として使う）
  if (expr === 'normal' && styleOf(id)?.normal) expr = styleOf(id)!.normal!;
  const folder = charFolder(id === 'host' ? 'host_observer' : id, heroGender);
  const key = `portrait:${folder}:${expr}`;
  let url = cache.get(key);
  if (!url) {
    url = assetUrl(`characters/${folder}/portrait_${expr}`) ?? assetUrl(`characters/${folder}/portrait_normal`) ?? (() => {
      const { pal, gender } = palette(id);
      return drawPortrait(pal, gender, expr, 420, hashString(id)).toDataURL();
    })();
    cache.set(key, url);
  }
  return url;
}

export function face(id: string, cls = ''): HTMLElement {
  // 新しい絵の人は、立ち絵の頭のあたりを丸い枠に拡大して見せる（画像は加工しない）
  if (isBustArt(id)) return h('span', { class: `face face-bust ${cls}`, style: `background-image:url("${faceUrl(id)}")`, role: 'img' });
  return h('img', { class: `face ${cls}`, src: faceUrl(id), alt: '', draggable: false });
}

export function emblemUrl(): string {
  let url = cache.get('emblem');
  if (!url) {
    url = assetUrl('ui/logo/emblem') ?? assetUrl('ui/logo/app_icon') ?? drawEmblem(512).toDataURL();
    cache.set('emblem', url);
  }
  return url;
}

export function bgUrl(name: string): string | null {
  return assetUrl(`backgrounds/${name}`) ?? assetUrl(`ui/background/${name}`);
}

/** タイトルロゴ（正式素材が無ければ null を返し、呼び出し側で文字のロゴを出す） */
export function logoUrl(): string | null {
  return assetUrl('ui/logo/title_logo');
}

/** 正式アイコン。素材が無い名前は null（呼び出し側は文字だけで表示する） */
export function icon(name: string, cls = ''): HTMLImageElement | null {
  const url = iconUrl(name);
  return url ? h('img', { class: `ic ${cls}`, src: url, alt: '', draggable: false }) : null;
}

/** 競技の紋章（素材が無い競技は null） */
export function emblem(matchId: string, cls = ''): HTMLImageElement | null {
  const url = emblemOf(matchId);
  return url ? h('img', { class: `emblem ${cls}`, src: url, alt: '', draggable: false }) : null;
}

/** 順位の印。1〜3 位は正式のメダル（数字はプログラムで重ねる）、4 位以下は数字だけ */
export function rankMark(i: number): HTMLElement {
  const url = i < 3 ? assetUrl(`ui/v11/common/rank_${i + 1}`) : null;
  return url
    ? h('span', { class: `rank-medal r${i + 1}`, style: `background-image:url("${url}")` }, String(i + 1))
    : h('span', { class: 'rank-plain' }, String(i + 1));
}

/** v11 の競技素材の URL（無ければ null）。path は ui/v11/ からの相対 */
export function v11Url(path: string): string | null {
  return assetUrl(`ui/v11/${path}`);
}

/**
 * 競技専用素材を、幅 w（px）で表示する。1 枚に複数の図柄が並ぶ素材は、画像を切り出さずに表示範囲だけを合わせる。
 * 縦横比は元の図柄のまま。
 */
export function gameArt(a: GameArt, w: number, cls = ''): HTMLElement | null {
  const url = assetUrl(a.path);
  if (!url) return null;
  const [x0, y0, x1, y1] = a.box ?? [0, 0, a.size, a.size];
  const k = w / (x1 - x0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return h('span', { class: `gart ${cls}`, style: `width:${r(w)}px;height:${r((y1 - y0) * k)}px;background-image:url("${url}");background-size:${r(a.size * k)}px ${r(a.size * k)}px;background-position:${r(-x0 * k)}px ${r(-y0 * k)}px` });
}

/** 演出用の帯に、プログラム側の文字を載せる。帯の無い素材は画像の下に文字を出す */
export function fxBanner(name: FxName, text: string, cls = ''): HTMLElement {
  const def = FX_ASSETS[name];
  const url = assetUrl(def.path);
  if (!url) return h('div', { class: `banner ${name === 'defeat' || name === 'elimination' ? 'red' : ''} ${cls}` }, text);
  const band = def.band;
  return h('div', { class: `fx fx-${name}${band ? ' fx-inband' : ''} ${cls}` },
    h('div', { class: 'fx-art' }, h('img', { src: url, alt: '', draggable: false }),
      band ? h('div', { class: 'fx-text', style: `top:${(band.y - band.h / 2) * 100}%;height:${band.h * 100}%` }, h('span', null, text)) : null),
    band ? null : h('div', { class: 'fx-text below' }, h('span', null, text)));
}

/** ゲージ。ratio は 0〜1。枠と光沢は正式素材、長さはプログラムで制御する */
export function gauge(ratio: number, cls = ''): HTMLElement {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return h('div', { class: `gauge ${cls}` }, h('div', { class: 'gauge-clip', style: `width:${pct}%` }, h('div', { class: 'gauge-fill' })));
}

const fxShown = new Set<string>();
/** 同じ出来事（key）では 1 回だけ演出の帯を出す（画面の描き直しで何度も出さない） */
export function fxOnce(key: string, name: FxName, text: string, ms = 2200): void {
  if (fxShown.has(key)) return;
  fxShown.add(key);
  fxPop(name, text, ms);
}

/** 画面上部に演出の帯を短時間だけ出す（操作は妨げない） */
export function fxPop(name: FxName, text: string, ms = 2600): void {
  const stage = typeof document === 'undefined' ? null : document.getElementById('ui');
  if (!stage) return;
  const el = fxBanner(name, text, 'sm fx-pop');
  stage.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/**
 * 人物の胸から上の表示。立ち絵の画像は加工せず、表示する範囲だけを絞る（上から約 45%、左右は中央寄り）。
 * 胸から上の新しい絵（portraits.json の bust）は絞らず、絵全体を枠の下端に合わせる（.bust-art）。どの表情も同じ寸法・同じ位置で出す。
 * 表情を替える時は setBust を使う。
 */
const preloaded = new Set<string>();
/** 表情を切り替えた瞬間に絵が抜けたり前の顔が残って見えたりしないよう、その人の全表情を先に読み込んでおく */
function preloadExpressions(id: string): void {
  const folder = charFolder(id === 'host' ? 'host_observer' : id, heroGender);
  if (preloaded.has(folder)) return;
  preloaded.add(folder);
  for (const e of EXPRESSIONS) {
    const img = new Image();
    img.src = portraitUrl(id, e);
  }
}

export function bust(id: string, expr = 'normal', cls = ''): HTMLElement {
  preloadExpressions(id);
  const el = document.createElement('div');
  el.className = `bust${isBustArt(id) ? ' bust-art' : ''} ${cls}`;
  setBust(el, id, expr);
  return el;
}

export function setBust(el: HTMLElement, id: string, expr = 'normal'): void {
  // 同じ枠で話し手が替わる場面もあるので、描き方はその都度合わせる
  el.classList.toggle('bust-art', isBustArt(id));
  preloadExpressions(id);
  el.style.backgroundImage = `url("${portraitUrl(id, expr)}")`;
}
