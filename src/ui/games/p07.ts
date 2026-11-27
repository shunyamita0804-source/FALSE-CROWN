/**
 * P07 ブラック＆ホワイトの画面。左に盤面、右に手番と操作、横に駒の数を置く。
 * 置ける場所の印をタップすると、返る駒が先に分かる。もう一度タップするか「置く」で確定する。
 * CPU の手は一瞬で決まるので、自分の番が来る前に 1 手ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { centerOf, countOf, flipsFor, legalFor, startBoard, type P07Move, type P07View } from '../../matches/p07';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import { FlipBoard, PIECE_COLORS, PIECE_EDGE, type FlipSel } from '../flipboard';
import type { MatchUi } from '../matchui';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; sel: FlipSel; bad?: boolean }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 950;
const SIZE = 43;

export const chip = (seat: number) => h('i', { class: 'fb-chip', style: `background:${PIECE_COLORS[seat]};border-color:${PIECE_EDGE[seat]}` });

export function renderP07(v: P07View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.log.map((l) => l.seat).lastIndexOf(v.seat);
    S = { n: Math.max(0, mine + 1, v.log.length - (v.players.length - 1)), sel: {} };
    SEEN.set(ui.slot, S);
  }
  const St = S;
  if (St.n > v.log.length) St.n = v.log.length;
  const replaying = St.n < v.log.length;
  if (replaying && !St.timer) {
    St.timer = setTimeout(() => {
      St.timer = undefined;
      St.n = Math.min(v.log.length, St.n + 1);
      const l = v.log[St.n - 1];
      Sound.se(l?.cell == null ? 'click' : l.flipped.length >= 3 ? 'chipsHit' : 'chip');
      ui.rerender();
    }, v.log[St.n].cell == null ? 420 : STEP_MS);
  }
  // 見せている時点の盤面（最初の配置から記録をたどる）
  const board = startBoard(v.players.length);
  for (let i = 0; i < St.n; i++) { const l = v.log[i]; if (l.cell == null) continue; board[l.cell] = l.seat; for (const c of l.flipped) board[c] = l.seat; }
  const last = St.n > 0 ? v.log[St.n - 1] : undefined;
  const turnOf = replaying ? v.players[v.log[St.n].seat] : v.toMove;

  const order = [...v.players].sort((a, b) => countOf(board, v.players.indexOf(b)) - countOf(board, v.players.indexOf(a)));
  const table = h('div', { class: 'p01-table fb-rank' }, order.map((p, i) => {
    const seat = v.players.indexOf(p);
    return h('div', { class: `p01-row${p === me ? ' me' : ''}${i === order.length - 1 ? ' last' : ''}${turnOf === p ? ' now' : ''}` },
      chip(seat), face(p), h('span', { class: 'nm' }, ui.name(p)), h('small', { class: 'dim' }, t('p07.ctr', { n: centerOf(board, seat) })), h('b', { class: 'tot' }, String(countOf(board, seat))));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('p07.rankTitle')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p07.tableNote')), h('div', { class: 'small dim', style: 'margin-top:4px' }, t('p01.lastNote'))),
    h('div', { class: 'box' }, h('h4', null, t('m07.orderTitle')), h('div', { class: 'fb-order' }, v.order.map((p) => h('span', { class: `fb-ord${turnOf === p ? ' now' : ''}` }, chip(v.players.indexOf(p)), face(p))))),
  ];

  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  if (!myTurn || (St.sel.cell !== undefined && !v.legal.cells.includes(St.sel.cell))) { St.sel.cell = undefined; St.bad = false; }
  const note = h('div', { class: 'small fb-note' });
  const foot = h('div', { class: 'hx7-foot' });
  const confirm = () => {
    if (St.sel.cell === undefined) return;
    const mv = { t: 'put', cell: St.sel.cell } satisfies P07Move;
    St.sel.cell = undefined;
    St.n = v.log.length + 1;
    Sound.se('chip');
    ui.submit(mv);
  };
  const fb = new FlipBoard({
    board, seat: v.seat, legal: myTurn ? v.legal.cells : [], active: myTurn, size: SIZE, last: last ? { cell: last.cell, flipped: last.flipped } : undefined, sel: St.sel,
    onChange: () => { St.bad = false; drawFoot(); }, onConfirm: confirm, onBad: () => { St.bad = true; drawFoot(); },
  });
  const drawFoot = () => {
    foot.replaceChildren();
    note.classList.remove('gold');
    if (!myTurn) { note.textContent = ''; return; }
    if (v.legal.kind === 'pass') {
      note.textContent = t('p07.mustPass');
      foot.append(button(t('m06.pass'), () => { St.n = v.log.length + 1; ui.submit({ t: 'pass' } satisfies P07Move); }, { kind: 'primary', autofocus: true }));
      return;
    }
    const n = fb.flips().length;
    if (St.sel.cell !== undefined) { note.textContent = n ? t('p07.willFlip', { n }) : t('p07.willFree'); note.classList.add('gold'); }
    else note.textContent = St.bad ? t(v.legal.kind === 'flip' ? 'p07.badFlip' : 'p07.badFree') : t(v.legal.kind === 'flip' ? 'p07.howFlip' : 'p07.howFree');
    foot.append(button(t('m07.put'), confirm, { kind: 'primary', disabled: St.sel.cell === undefined }));
  };
  drawFoot();
  if (myTurn && v.legal.kind !== 'pass') {
    ui.timeoutMove = () => {
      // 時間切れ：返せる数が一番少ない場所
      let best = v.legal.cells[0];
      let k = Infinity;
      for (const c of v.legal.cells) { const f = flipsFor(v.board, v.seat, c).length; if (f < k) { k = f; best = c; } }
      return { t: 'put', cell: best } satisfies P07Move;
    };
  }
  void legalFor;

  let head: Child;
  let body: Child = null;
  if (v.phase === 'done' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('p01.finished'));
    body = h('div', { class: 'fb-final' }, order.map((p) => h('div', { class: `fb-finalrow${p === me ? ' me' : ''}` }, chip(v.players.indexOf(p)), h('span', { class: 'nm' }, ui.name(p)), h('b', null, String(v.counts[p])))));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('p07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, t('p07.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:8px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies P07Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : ''),
      watching ? null : h('span', { class: 'small dim row', style: 'gap:8px;align-items:center' }, t('p07.yourColor'), chip(v.seat)),
      last && last.cell != null ? h('span', { class: 'small dim' }, t('p07.lastMove', { name: ui.name(v.players[last.seat]), n: last.flipped.length })) : last ? h('span', { class: 'small dim' }, t('p07.lastPass', { name: ui.name(v.players[last.seat]) })) : null);
  }
  const main = h('div', { class: 'hx7 fb7' }, h('div', { class: 'hx7-left' }, fb.el), h('div', { class: 'hx7-panel' }, head, body, note, foot));
  return { main, side };
}
