/** P01 数字の鎖の画面。盤面を中央に大きく置き、合計と目標値を数字で大きく見せる。 */
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { Q_MS, type P01Answer, type P01Move, type P01View } from '../../matches/p01';
import { face } from '../art';
import { ChainBoard } from '../chainboard';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';

interface Local { board?: ChainBoard }

function ans(a: P01Answer | undefined): Child {
  if (!a) return null;
  return a.ok ? h('span', { class: 'p01-ans ok' }, t('p01.okLen', { n: a.len }), h('b', null, ` +${a.points}`)) : h('span', { class: 'p01-ans ng' }, t('p01.miss'));
}

function table(v: P01View, ui: MatchUi): HTMLElement {
  const me = v.self as CharId;
  const order = [...v.players].sort((a, b) => v.totals[b] - v.totals[a]);
  return h('div', { class: 'p01-table' }, order.map((p, i) => h('div', { class: `p01-row${p === me ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}` },
    h('span', { class: 'no' }, String(i + 1)), face(p), h('span', { class: 'nm' }, ui.name(p)), v.last ? ans(v.last.answers[p]) : null, h('b', { class: 'tot' }, String(v.totals[p])))));
}

export function renderP01(v: P01View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const L = ui.local as Local;
  const side = [h('div', { class: 'box scroll grow' }, h('h4', null, t('p01.rank')), table(v, ui), h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p01.lastNote')))];
  if (v.phase !== 'solve' || v.self === 'spectator' || v.submitted) {
    const main = h('div', { class: 'p01-break' },
      h('div', { class: 'm01-big' }, v.phase === 'done' ? t('p01.finished') : t('p01.breakTitle', { n: v.round + 1 })),
      v.phase === 'break' && v.self !== 'spectator' ? h('div', { class: 'row', style: 'gap:8px;justify-content:center;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      v.phase === 'break' && v.self !== 'spectator' && !v.ready[me] ? button(t('p01.next', { n: v.round + 2 }), () => ui.submit({ t: 'ready' } satisfies P01Move), { kind: 'primary', autofocus: true }) : null);
    return { main, side };
  }
  if (!L.board) {
    const board = new ChainBoard(v.board, v.target, {
      onSubmit: (path) => {
        board.lock();
        ui.submit({ t: 'chain', path, ms: Math.min(Q_MS, ui.elapsed()) } satisfies P01Move);
      },
    });
    L.board = board;
  }
  return { main: [h('div', { class: 'p01-play' }, L.board.el)], side };
}
