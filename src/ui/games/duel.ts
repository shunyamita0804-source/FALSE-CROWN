/** カード対決の画面（M11 の第 5 種目、H02 月下の賭場）。目標の数を中央に大きく出し、手札をタップして選び、確定する。 */
import { Sound } from '../../audio/audio';
import { t } from '../../i18n/i18n';
import type { DuelMove, DuelRound, DuelView } from '../../matches/duel';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

interface Local { sel?: number }

/** 1 ラウンドの結果の 1 行 */
export function duelRow(r: DuelRound, i: number, me: number): HTMLElement {
  const a = me >= 0 ? me : 0;
  const b = 1 - a;
  const res = r.gain[a] > r.gain[b] ? 'win' : r.gain[a] < r.gain[b] ? 'lose' : 'draw';
  return h('div', { class: `dl-row ${res}` }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'tg' }, t('duel.targetN', { n: r.target })), h('b', null, String(r.cards[a])), h('span', { class: 'dim' }, '－'), h('b', null, String(r.cards[b])), h('span', { class: 'rs' }, t(`duel.res.${res}`)));
}

export function renderDuel(v: DuelView, ui: MatchUi): { main: Child; side: Child } {
  const L = ui.local as Local;
  const watching = v.me < 0;
  const me = watching ? 0 : v.me;
  const op = 1 - me;
  const full = Array.from({ length: v.n }, (_, i) => i + 1);
  const last = v.log[v.log.length - 1];
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('duel.logTitle')),
    h('div', { class: 'dl-score' }, h('span', null, watching ? ui.name(v.players[me]) : t('p05.you')), h('b', null, `${v.wins[me]} － ${v.wins[op]}`), h('span', null, ui.name(v.players[op]))),
    h('div', { class: 'dl-log' }, v.log.map((r, i) => duelRow(r, i, v.me))),
    h('div', { class: 'small dim', style: 'margin-top:6px' }, t('duel.note')))];
  if (v.phase === 'done') {
    const res = v.wins[me] > v.wins[op] ? 'win' : v.wins[me] < v.wins[op] ? 'lose' : 'draw';
    return { main: h('div', { class: 'm02-break' }, h('div', { class: 'm01-big' }, t('p01.finished')), h('b', { class: 'gold', style: 'font-size:1.6em' }, `${v.wins[me]} － ${v.wins[op]}`), h('div', null, t(`duel.final.${res}`))), side };
  }
  const hand = v.hands[me];
  if (L.sel !== undefined && !hand.includes(L.sel)) L.sel = undefined;
  const can = !watching && !v.submitted;
  const play = (card: number) => {
    L.sel = undefined;
    Sound.se('card');
    ui.submit({ t: 'play', card } satisfies DuelMove);
  };
  const lastEl = last
    ? h('div', { class: `p05-last ${last.gain[me] > last.gain[op] ? 'hit' : last.gain[me] < last.gain[op] ? 'bust' : ''}` }, t('duel.last', { n: last.target, a: last.cards[me], b: last.cards[op], r: t(`duel.res.${last.gain[me] > last.gain[op] ? 'win' : last.gain[me] < last.gain[op] ? 'lose' : 'draw'}`) }))
    : h('div', { class: 'p05-last' }, t('duel.start'));
  const main = h('div', { class: 'p05 dl' },
    h('div', { class: 'p05-opps' }, h('div', { class: 'p05-opp' }, face(v.players[op]), h('div', { class: 'col' },
      h('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, h('b', null, ui.name(v.players[op])), h('span', { class: 'gold' }, t('duel.wins', { n: v.wins[op] }))),
      h('div', { class: 'p05-mini' }, full.map((c) => h('i', { class: v.hands[op].includes(c) ? '' : 'gone' }, String(c))))))),
    h('div', { class: 'p05-mid' },
      h('div', { class: 'p05-total hot' }, h('small', null, t('duel.target')), h('b', { 'data-target': String(v.target ?? '') }, String(v.target ?? '–'))),
      h('div', { class: 'col', style: 'gap:6px;align-items:flex-start' }, lastEl,
        h('div', { class: 'small dim row', style: 'gap:8px;align-items:center' }, t('duel.left'), h('span', { class: 'p05-mini' }, v.left.map((c) => h('i', null, String(c)))), v.left.length ? t('duel.leftNote') : t('duel.leftNone')),
        h('div', { class: 'small dim' }, can ? t('duel.how') : watching ? '' : t('duel.waiting')))),
    h('div', { class: 'p05-hand' }, hand.map((c) => {
      const d = Math.abs(c - (v.target ?? c));
      const el = h('button', { class: `p05-card${d === 0 ? ' hit' : ''}${L.sel === c ? ' sel' : ''}`, type: 'button', 'data-card': String(c), disabled: !can }, h('b', null, String(c)), h('small', null, d === 0 ? t('duel.exact') : t('duel.diff', { n: d })));
      el.addEventListener('click', () => {
        if (!can) return;
        if (L.sel === c) play(c);
        else { L.sel = c; Sound.se('select'); ui.rerender(); }
      });
      return el;
    }), can ? button(L.sel !== undefined ? t('p05.play', { c: L.sel }) : t('p05.pick'), () => { if (L.sel !== undefined) play(L.sel); }, { kind: 'primary', disabled: L.sel === undefined, cls: 'p05-go' }) : null));
  return { main, side };
}
