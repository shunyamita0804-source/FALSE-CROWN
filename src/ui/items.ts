/**
 * 手帳「アイテム」タブ。ピースの残高と出入り、救いのメダルの所持・使用済み・期限・使用条件を見るだけの画面。
 * メダルはここからは使えない（使えるのは今までどおり、メインマッチの結果発表の直後だけ）。
 */
import { phaseName } from '../app/game';
import { medalsOf, pieceLedger, type MedalEntry } from '../core/itemview';
import { MEDAL_LAST_DAY } from '../core/rescue';
import { nameOf } from '../core/state';
import type { GameState } from '../core/types';
import { t } from '../i18n/i18n';
import { assetUrl } from '../assets/registry';
import { icon } from './art';
import { h, type Child } from './dom';

const art = (path: string, cls: string): HTMLElement | null => {
  const url = assetUrl(path);
  return url ? h('img', { class: cls, src: url, alt: '', draggable: 'false' }) : null;
};
const piece = (n: number) => h('span', { class: 'piece' }, String(n));
const signed = (n: number) => h('span', { class: `piece ${n > 0 ? 'good' : 'bad'}` }, `${n > 0 ? '+' : '−'}${Math.abs(n)}`);

function medalLine(s: GameState, m: MedalEntry): Child {
  const status = t(`items.medal.${m.status}`);
  const detail =
    m.status === 'used'
      ? t('items.medal.usedText', { target: nameOf(s, m.target!), swapped: nameOf(s, m.swapped!) })
      : m.status === 'held'
        ? t('items.medal.heldText', { day: m.day })
        : t('items.medal.unusedText', { day: m.day });
  const declined = m.declined.length ? t('items.medal.declined', { names: m.declined.map((id) => nameOf(s, id)).join('、') }) : null;
  return h('div', { class: `entry row item-medal ${m.status}`, style: 'gap:12px;align-items:center', 'data-status': m.status },
    art('ui/v11/common/rescue_medal_icon', 'item-medal-ic'),
    h('div', { class: 'col grow', style: 'gap:2px' },
      h('div', null, h('b', { class: 'gold' }, `DAY ${m.day}`), '　', h('span', { class: 'tag' }, status)),
      h('div', { class: 'small' }, detail),
      declined ? h('div', { class: 'small dim' }, declined) : null));
}

export function renderItems(s: GameState): Child[] {
  const led = pieceLedger(s, 'hero');
  const medals = medalsOf(s, 'hero');
  const out: Child[] = [];

  // ピース
  out.push(h('h4', { class: 'gold row', style: 'gap:8px;align-items:center' }, icon('piece_gold'), t('items.pieces')));
  out.push(h('div', { class: 'entry row items-balance', style: 'gap:18px;align-items:center;flex-wrap:wrap' },
    h('div', null, t('items.balance'), '　', h('b', { style: 'font-size:1.3em' }, piece(led.balance))),
    h('div', { class: 'small' }, t('items.totalIn'), ' ', signed(led.totalIn || 0)),
    h('div', { class: 'small' }, t('items.totalOut'), ' ', led.totalOut ? signed(-led.totalOut) : '0'),
    h('div', { class: 'small dim' }, t('items.initial', { n: led.initial }))));
  if (!led.entries.length) out.push(h('div', { class: 'dim small' }, t('items.noHistory')));
  else {
    out.push(h('div', { class: 'item-ledger' },
      h('div', { class: 'item-row head' }, h('span', null, t('items.colWhen')), h('span', null, t('items.colWhat')), h('span', null, t('items.colDelta')), h('span', null, t('items.colAfter'))),
      led.entries.map((e) => h('div', { class: `item-row ${e.delta > 0 ? 'in' : 'out'}` },
        h('span', { class: 'small dim' }, `DAY ${e.day}　${phaseName(e.phase)}`),
        h('span', null, e.reason, e.other ? h('span', { class: 'small dim' }, '　', t(e.delta > 0 ? 'items.from' : 'items.to', { name: nameOf(s, e.other) })) : null),
        signed(e.delta),
        piece(e.after)))));
  }

  // 救いのメダル
  out.push(h('h4', { class: 'gold row', style: 'gap:8px;align-items:center;margin-top:8px' }, art('ui/v11/common/rescue_medal_icon', 'item-medal-ic sm'), t('items.medal.title')));
  out.push(h('div', { class: 'small' }, t('items.medal.count', { held: medals.filter((m) => m.status === 'held').length, used: medals.filter((m) => m.status === 'used').length, unused: medals.filter((m) => m.status === 'unused').length })));
  if (!medals.length) out.push(h('div', { class: 'dim small' }, t('items.medal.none')));
  else out.push(...medals.map((m) => medalLine(s, m)));
  out.push(h('div', { class: 'note-box small items-rules' },
    h('b', { class: 'gold' }, t('items.medal.rulesTitle')),
    h('ul', null, ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((k) => h('li', null, t(`items.medal.${k}`, { last: MEDAL_LAST_DAY }))))));
  return out;
}
