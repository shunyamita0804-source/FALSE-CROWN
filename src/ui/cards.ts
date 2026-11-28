/**
 * クロス・カードのカードの描画（独自の 4 種の紋：王冠、鍵、月、星）。数字は文字で描く。
 * 紋は正式素材（ui/v11/m06/suit_*.png）、届いていなければ SVG。絵札 J・Q・K は肖像の紋（court_*.png）を添える。
 */
import { RANK_LABEL, rankOf, SUITS, suitOf } from '../matches/m06';
import { v11Url } from './art';
import { h } from './dom';

export const SUIT_COLOR = ['#c9962b', '#2f7fc4', '#7a4fc0', '#c2453d'];
export const SUIT_NAME = ['王冠', '鍵', '月', '星'];
const SUIT_PATH: Record<string, string> = {
  crown: '<path d="M4 30 L2 10 L11 18 L20 5 L29 18 L38 10 L36 30 Z"/><rect x="4" y="32" width="32" height="4" rx="1"/>',
  key: '<circle cx="13" cy="13" r="9" fill="none" stroke-width="5"/><path d="M19 19 L36 36 M29 29 L34 24 M33 33 L37 29" fill="none" stroke-width="5" stroke-linecap="round"/>',
  moon: '<path d="M27 3 A17 17 0 1 0 37 27 A13 13 0 0 1 27 3 Z"/>',
  star: '<polygon points="20,2 25.3,14 38,15 28.3,23.6 31.5,36.5 20,29.5 8.5,36.5 11.7,23.6 2,15 14.7,14"/>',
};

export function suitSvg(suit: number): string {
  const c = SUIT_COLOR[suit];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" aria-label="${SUIT_NAME[suit]}"><g fill="${c}" stroke="${c}" stroke-width="0" stroke-linejoin="round">${SUIT_PATH[SUITS[suit]]}</g></svg>`;
}

export function suitEl(suit: number, cls = ''): HTMLElement {
  const url = v11Url(`m06/suit_${SUITS[suit]}`);
  if (url) return h('span', { class: `xc-suit art ${cls}`, role: 'img', 'aria-label': SUIT_NAME[suit] }, h('img', { src: url, alt: '', draggable: false }));
  const el = h('span', { class: `xc-suit ${cls}` });
  el.innerHTML = suitSvg(suit);
  return el;
}

const COURT: Record<number, string> = { 11: 'j', 12: 'q', 13: 'k' };

/** カード 1 枚（表）。tag を button にすると押せる */
export function cardEl(c: number, opts: { cls?: string; button?: boolean; disabled?: boolean } = {}): HTMLElement {
  const s = suitOf(c);
  const court = COURT[rankOf(c)];
  const courtUrl = court ? v11Url(`m06/court_${court}`) : null;
  return h(opts.button ? 'button' : 'div', { class: `xc-card ${opts.cls ?? ''}${courtUrl ? ' court' : ''}`, type: opts.button ? 'button' : undefined, 'data-card': String(c), disabled: opts.button ? !!opts.disabled : undefined, style: `--xc:${SUIT_COLOR[s]}`, 'aria-label': `${SUIT_NAME[s]}の${RANK_LABEL(c)}` },
    courtUrl ? h('img', { class: 'xc-court', src: courtUrl, alt: '', draggable: false }) : null,
    h('b', null, RANK_LABEL(c)), suitEl(s), h('i', null, RANK_LABEL(c)));
}

export const cardBack = (cls = '') => h('div', { class: `xc-card back ${cls}` });
