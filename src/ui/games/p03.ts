/**
 * P03 スピードカードの画面。卓を中央に大きく置く。
 * 出し切るか、出せるカードも置き換えも無くなった時点で、自動で提出する。時間切れの時は、そこまでの手順で採点する。
 */
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { DECK, ROUND_MS, type P03Move, type P03Result, type P03View } from '../../matches/p03';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { SpeedTable } from '../speedtable';

interface Local { table?: SpeedTable; last?: number; sent?: boolean }

function res(r: P03Result | undefined): Child {
  if (!r) return null;
  return h('span', { class: `p01-ans ${r.cleared ? 'ok' : ''}` }, t(r.cleared ? 'p03.resClear' : 'p03.res', { n: r.played, r: r.refreshes }), h('b', null, ` +${r.points}`));
}

function table(v: P03View, ui: MatchUi): HTMLElement {
  const me = v.self as CharId;
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  return h('div', { class: 'p01-table' }, order.map((p, i) => {
    const rs = v.results[p];
    return h('div', { class: `p01-row${p === me ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
      h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), res(rs[rs.length - 1]), h('b', { class: 'tot' }, String(v.totals[p])));
  }));
}

export function renderP03(v: P03View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('p03.rank')), table(v, ui), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')))];
  if (v.phase !== 'solve' || v.self === 'spectator' || v.submitted) {
    const mine = v.results[me]?.[v.results[me].length - 1];
    const main = h('div', { class: 'p01-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : v.phase === 'break' ? t('p01.breakTitle', { n: v.round + 1 }) : t('m03.waiting')),
      mine && v.phase !== 'solve' ? h('div', { class: 'm01-score' },
        h('div', { class: 'm01-chip on' }, h('small', null, t('p03.cards', { n: mine.played, max: DECK })), h('b', null, String(mine.played * 2))),
        h('span', { class: 'plus' }, '+'),
        h('div', { class: `m01-chip${mine.cleared ? ' on' : ''}` }, h('small', null, t('p03.clear')), h('b', null, String(mine.cleared ? 8 : 0))),
        h('span', { class: 'plus' }, '='),
        h('div', { class: 'm01-chip total' }, h('small', null, t('m03.roundPts')), h('b', null, String(mine.points)))) : null,
      v.phase === 'break' && v.self !== 'spectator' ? h('div', { class: 'row', style: 'gap:8px;justify-content:center;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && v.self !== 'spectator' && !v.ready[me] ? button(t('p01.next', { n: v.round + 2 }), () => ui.submit({ t: 'ready' } satisfies P03Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side };
  }
  if (!L.table) {
    L.last = ROUND_MS;
    const tb = new SpeedTable(v.layout, {
      onAct: (a) => { if (a.k === 'p') L.last = Math.min(ROUND_MS, Math.max(1, ui.elapsed())); },
      onEnd: (acts) => {
        if (L.sent) return;
        L.sent = true;
        ui.timeoutMove = undefined;
        // 最後の札を見せてから提出する
        setTimeout(() => ui.submit({ t: 'run', acts, ms: L.last ?? ROUND_MS } satisfies P03Move), 900);
      },
    });
    L.table = tb;
    ui.timeoutMove = () => ({ t: 'run', acts: [...tb.acts], ms: L.last ?? ROUND_MS } satisfies P03Move);
  }
  return { main: [h('div', { class: 'p01-play' }, L.table.el)], side };
}
