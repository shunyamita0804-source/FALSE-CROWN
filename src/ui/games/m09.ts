/**
 * M09 四王の戦場・改の画面。左に盤面、右に手番と操作、横に得点を置く。
 * 自分の駒をタップすると動けるマスが光る（取れる駒は赤い枠）。行き先をタップして選び、もう一度タップするか「動かす」で確定する。
 * 行き先が敵に取られる位置の時は、確定の前に知らせる。CPU の手は 1 手ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { ALIVE_PTS, CENTER, CENTER_PTS, KING_PTS, SOLDIER_PTS, attackedBy, movesOf, startPieces, type M09Log, type M09Move, type M09View, type Piece } from '../../matches/m09';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import { HEX_COLORS } from '../hexboard';
import type { MatchUi } from '../matchui';
import { pieceBoard, pieceEl } from '../pieceboard';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; from?: number; to?: number; key?: string }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 850;
export const M09_COLORS = [HEX_COLORS[0], HEX_COLORS[1], HEX_COLORS[2], HEX_COLORS[3]];

/** 記録の先頭 n 件までを反映した盤面と得点 */
function boardAt(v: M09View, n: number): { pieces: Piece[]; points: number[]; caps: number[] } {
  const pieces = startPieces(v.seats);
  const points = v.players.map(() => 0);
  const caps = v.players.map(() => 0);
  for (let k = 0; k < n; k++) {
    const l = v.log[k];
    const i = v.seats.indexOf(l.seat);
    if (l.kind === 'center') { points[i] += CENTER_PTS; continue; }
    if (l.kind !== 'move') continue;
    const vi = pieces.findIndex((p) => p.pos === l.to);
    if (vi >= 0) { points[i] += pieces[vi].king ? KING_PTS : SOLDIER_PTS; caps[i] += 1; pieces.splice(vi, 1); }
    const pc = pieces.find((p) => p.pos === l.from && p.seat === l.seat);
    if (pc) pc.pos = l.to!;
  }
  return { pieces, points, caps };
}

export function renderM09(v: M09View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  const seat = v.me >= 0 ? v.seats[v.me] : -1;
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.log.map((l) => (l.kind === 'center' ? -9 : l.seat)).lastIndexOf(seat);
    S = { n: Math.max(0, mine + 1, v.log.length - v.players.length) };
    SEEN.set(ui.slot, S);
  }
  const St = S;
  if (St.n > v.log.length) St.n = v.log.length;
  const replaying = St.n < v.log.length;
  if (replaying && !St.timer) {
    const nxt = v.log[St.n];
    St.timer = setTimeout(() => {
      St.timer = undefined;
      St.n = Math.min(v.log.length, St.n + 1);
      const l = v.log[St.n - 1];
      Sound.se(l?.kind === 'center' ? 'coins' : l?.cap ? 'chipsHit' : l?.kind === 'move' ? 'chip' : 'click');
      ui.rerender();
    }, nxt.kind === 'center' ? 500 : STEP_MS);
  }
  const B = boardAt(v, St.n);
  const done = v.phase === 'done' && !replaying;
  const points = done ? v.points : B.points;
  const last: M09Log | undefined = St.n > 0 ? v.log[St.n - 1] : undefined;
  const who = (s: number) => v.players[v.seats.indexOf(s)];
  const turnOf = replaying ? (v.log[St.n].kind === 'center' ? null : who(v.log[St.n].seat)) : v.toMove;
  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const key = `${v.round}-${v.log.length}`;
  if (St.key !== key || !myTurn) { St.key = key; St.from = St.to = undefined; }

  const order = v.players.map((_, i) => i).sort((a, b) => points[b] - points[a]);
  const table = h('div', { class: 'm01-rank pz-rank' }, order.map((i) => {
    const p = v.players[i];
    const s = v.seats[i];
    const king = B.pieces.some((q) => q.seat === s && q.king);
    const sol = B.pieces.filter((q) => q.seat === s && !q.king).length;
    return h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${turnOf === p ? ' now' : ''}${!king && !sol ? ' out' : ''}` },
      h('i', { class: 'hx-sw', style: `background:${M09_COLORS[s]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('small', { class: 'dim' }, `${king ? t('m09.kingTag') : t('m09.noKing')}・${t('m09.solN', { n: sol })}`), h('b', null, String(points[i])));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('m09.tableNote', { k: KING_PTS, s: SOLDIER_PTS, c: CENTER_PTS, a: ALIVE_PTS }))),
    h('div', { class: 'box' }, h('h4', null, t('m07.orderTitle')), h('div', { class: 'hx7-order' }, v.order.map((p) => h('span', { class: `hx7-ord${turnOf === p ? ' now' : ''}`, style: `--c:${M09_COLORS[v.seats[v.players.indexOf(p)]]}`, title: ui.name(p) }, face(p))))),
  ];

  // 印：中央、直前の手、選択中の駒と行き先
  const marks: Record<number, string> = { [CENTER]: 'center' };
  const add = (c: number, cls: string) => { marks[c] = `${marks[c] ?? ''} ${cls}`; };
  if (last?.kind === 'move') { add(last.from!, 'from'); add(last.to!, last.cap ? 'to hit' : 'to'); }
  if (last?.kind === 'center') add(CENTER, 'award');
  const mine = B.pieces.filter((p) => p.seat === seat);
  const sel = St.from !== undefined ? mine.find((p) => p.pos === St.from) : undefined;
  const dests = sel ? movesOf(B.pieces, sel) : [];
  if (myTurn) {
    if (sel) { add(sel.pos, 'sel'); for (const c of dests) add(c, B.pieces.some((p) => p.pos === c) ? 'can cap' : 'can'); }
    else for (const p of mine) if (movesOf(B.pieces, p).length) add(p.pos, 'movable');
    if (St.to !== undefined) add(St.to, 'chosen');
  }
  // 行き先が取られる位置かどうか
  let danger: Piece[] = [];
  if (sel && St.to !== undefined) {
    const next = B.pieces.filter((p) => p.pos !== St.to).map((p) => (p === sel ? { ...p, pos: St.to! } : p));
    danger = attackedBy(next, St.to, seat);
    for (const d of danger) add(d.pos, 'threat');
  }
  const confirm = () => {
    if (St.from === undefined || St.to === undefined) return;
    const mv = { t: 'move', from: St.from, to: St.to } satisfies M09Move;
    Sound.se(B.pieces.some((p) => p.pos === St.to) ? 'chipsHit' : 'chip');
    St.from = St.to = undefined;
    St.n = v.log.length + 1;
    ui.submit(mv);
  };
  const board = pieceBoard({
    n: 7, cell: 80, pieces: B.pieces.map((p) => ({ pos: p.pos, seat: p.seat, kind: p.king ? 'king' as const : 'soldier' as const })), colors: M09_COLORS, me: seat, marks,
    onCell: myTurn ? (c) => {
      const own = mine.find((p) => p.pos === c);
      if (own) { if (!movesOf(B.pieces, own).length) { Sound.se('error'); return; } St.from = St.from === c ? undefined : c; St.to = undefined; Sound.se('select'); ui.rerender(); return; }
      if (!sel || !dests.includes(c)) { Sound.se('error'); return; }
      if (St.to === c) { confirm(); return; }
      St.to = c; Sound.se('select'); ui.rerender();
    } : undefined,
  });

  let head: Child;
  let body: Child = null;
  let note: Child = '';
  const foot: Child[] = [];
  if (done) {
    head = h('div', { class: 'm01-big' }, t('p01.finished'));
    body = h('div', { class: 'small dim' }, t('m09.doneNote', { a: ALIVE_PTS }));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('m07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, t('m09.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies M09Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    const out = !watching && !mine.length;
    const lastText = last ? (last.kind === 'center' ? t('m09.last.center', { name: ui.name(who(last.seat)), n: CENTER_PTS }) : last.kind === 'pass' ? t('m08.last.pass', { name: ui.name(who(last.seat)) }) : last.cap ? t(last.cap.king ? 'm09.last.capKing' : 'm09.last.cap', { name: ui.name(who(last.seat)), other: ui.name(who(last.cap.seat)) }) : t('m08.last.move', { name: ui.name(who(last.seat)) })) : '';
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, out ? t('m09.youOut') : myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : t('m09.roundEnd')),
      !watching && !out ? h('span', { class: 'small dim row', style: 'gap:8px;align-items:center' }, t('p07.yourColor'), h('i', { class: 'hx-sw', style: `background:${M09_COLORS[seat]}` })) : null,
      lastText ? h('span', { class: 'small dim' }, lastText) : null);
    if (myTurn) {
      const anyMove = mine.some((p) => movesOf(B.pieces, p).length);
      if (!anyMove) { note = t('m09.noMove'); foot.push(button(t('m06.pass'), () => { St.n = v.log.length + 1; ui.submit({ t: 'pass' } satisfies M09Move); }, { kind: 'primary' })); }
      else {
        if (!sel) note = t('m09.howPick');
        else if (St.to === undefined) note = t(sel.king ? 'm09.howKing' : 'm09.howSoldier');
        else {
          const victim = B.pieces.find((p) => p.pos === St.to);
          const gain = victim ? t(victim.king ? 'm09.gainKing' : 'm09.gainSoldier', { n: victim.king ? KING_PTS : SOLDIER_PTS }) : St.to === CENTER ? t('m09.gainCenter', { n: CENTER_PTS }) : '';
          note = [gain ? h('span', { class: 'gold' }, gain) : null, danger.length ? h('span', { class: 'pz-warn' }, t(sel.king ? 'm09.warnKing' : 'm09.warn')) : gain ? null : t('m08.moveReady')];
        }
        foot.push(button(t('m09.doMove'), confirm, { kind: 'primary', disabled: St.to === undefined }));
        if (sel) foot.push(button(t('m09.unpick'), () => { St.from = St.to = undefined; ui.rerender(); }, { small: true }));
      }
    }
  }
  const legend = h('div', { class: 'pz-legend small dim' }, pieceEl('king', M09_COLORS[seat >= 0 ? seat : 0], 44), t('m09.lgKing'), pieceEl('soldier', M09_COLORS[seat >= 0 ? seat : 0], 44), t('m09.lgSoldier'));
  const main = h('div', { class: 'hx7 pz7' }, h('div', { class: 'hx7-left' }, board),
    h('div', { class: 'hx7-panel' }, head, body, h('div', { class: 'small fb-note pz-note' }, note), h('div', { class: 'hx7-foot' }, foot), done ? null : legend));
  return { main, side };
}
