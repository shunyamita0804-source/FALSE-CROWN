/**
 * M10 トライアングルの画面。左に三角形の盤面、右に手番と操作、横に得点を置く。
 * 自分の兵をタップすると動ける点が光る（取れる兵は赤）。行き先をタップして選び、もう一度タップするか「動かす」で確定する。
 * 宝石を持った兵が旗の隣にいる時は、自分の旗をタップして納める。CPU の手は 1 手ずつ順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { ADJ, CAP_PTS, DELIVER_PTS, HOME, HOME_PTS, HOLD_PTS, PEACE, actsOf, startBoard, type Board, type M10Log, type M10Move, type M10View } from '../../matches/m10';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import type { MatchUi } from '../matchui';
import { TRI_COLORS, triBoard } from '../triboard';

/** to：点の番号。-2 は「旗に納める」 */
interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; from?: number; to?: number; key?: string }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 900;
const FLAG_TO = -2;

export function renderM10(v: M10View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  const seat = v.me >= 0 ? v.seats[v.me] : -1;
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.log.map((l) => l.seat).lastIndexOf(seat);
    S = { n: Math.max(0, mine + 1, v.log.length - v.players.length) };
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
      Sound.se(l?.kind === 'deliver' ? 'coins' : l?.fx?.cap !== undefined ? 'chipsHit' : l?.kind === 'move' ? 'chip' : 'click');
      ui.rerender();
    }, STEP_MS);
  }
  const last: M10Log | undefined = St.n > 0 ? v.log[St.n - 1] : undefined;
  const B: Board = last ? last.board : startBoard(v.seats);
  const done = v.phase === 'done' && !replaying;
  const points = done ? v.points : last ? last.points : v.players.map(() => 0);
  const who = (s: number) => v.players[v.seats.indexOf(s)];
  const turnOf = replaying ? who(v.log[St.n].seat) : v.toMove;
  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const peace = v.round < PEACE;
  const key = `${v.round}-${v.log.length}`;
  if (St.key !== key || !myTurn) { St.key = key; St.from = St.to = undefined; }

  const order = v.players.map((_, i) => i).sort((a, b) => points[b] - points[a]);
  const table = h('div', { class: 'm01-rank pz-rank' }, order.map((i) => {
    const p = v.players[i];
    const s = v.seats[i];
    const sol = B.soldiers.filter((q) => q.seat === s);
    return h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${turnOf === p ? ' now' : ''}${!sol.length ? ' out' : ''}` },
      h('i', { class: 'hx-sw', style: `background:${TRI_COLORS[s]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('small', { class: 'dim' }, t('m10.rowInfo', { n: sol.length, g: sol.filter((q) => q.gem >= 0).length })), h('b', null, String(points[i])));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('m10.tableNote', { d: DELIVER_PTS, c: CAP_PTS, a: HOLD_PTS, b: HOME_PTS }))),
    h('div', { class: 'box' }, h('h4', null, t('m07.orderTitle')), h('div', { class: 'hx7-order' }, v.order.map((p) => h('span', { class: `hx7-ord${turnOf === p ? ' now' : ''}`, style: `--c:${TRI_COLORS[v.seats[v.players.indexOf(p)]]}`, title: ui.name(p) }, face(p))))),
  ];

  const marks: Record<number, string> = {};
  const flagMarks: Record<number, string> = {};
  const add = (c: number, cls: string) => { marks[c] = `${marks[c] ?? ''} ${cls}`; };
  if (last?.kind === 'move') { add(last.from!, 'from'); add(last.to!, last.fx?.cap !== undefined ? 'to hit' : 'to'); }
  if (last?.kind === 'deliver') { add(last.from!, 'to'); flagMarks[last.seat] = 'got'; }
  const acts = myTurn ? actsOf(B, seat, peace) : [];
  const mine = B.soldiers.filter((p) => p.seat === seat);
  const sel = St.from !== undefined ? mine.find((p) => p.pos === St.from) : undefined;
  const selActs = sel ? acts.filter((a) => a.from === sel.pos) : [];
  const dests = selActs.filter((a) => a.t === 'move').map((a) => (a as { to: number }).to);
  const canDeliver = selActs.some((a) => a.t === 'deliver');
  if (myTurn) {
    if (sel) {
      add(sel.pos, 'sel');
      for (const c of dests) add(c, B.soldiers.some((p) => p.pos === c) ? 'can cap' : 'can');
      if (canDeliver) flagMarks[seat] = St.to === FLAG_TO ? 'deliver chosen' : 'deliver';
    } else for (const p of mine) if (acts.some((a) => a.from === p.pos)) add(p.pos, 'movable');
    if (St.to !== undefined && St.to >= 0) add(St.to, 'chosen');
  }
  // 行き先の隣に敵の兵がいるか（次に取られるかもしれない）
  let danger: number[] = [];
  if (sel && St.to !== undefined && St.to >= 0 && v.round >= PEACE - 1) {
    danger = ADJ[St.to].filter((n) => B.soldiers.some((q) => q.pos === n && q.seat !== seat && n !== St.to));
    for (const d of danger) add(d, 'threat');
  }
  const confirm = () => {
    if (St.from === undefined || St.to === undefined) return;
    const mv: M10Move = St.to === FLAG_TO ? { t: 'deliver', from: St.from } : { t: 'move', from: St.from, to: St.to };
    Sound.se(St.to === FLAG_TO ? 'coins' : B.soldiers.some((p) => p.pos === St.to) ? 'chipsHit' : 'chip');
    St.from = St.to = undefined;
    St.n = v.log.length + 1;
    ui.submit(mv);
  };
  const board = triBoard({ board: B, seats: v.seats, me: seat, marks, flagMarks },
    myTurn ? (c) => {
      const own = mine.find((p) => p.pos === c);
      if (own) { if (!acts.some((a) => a.from === c)) { Sound.se('error'); return; } St.from = St.from === c ? undefined : c; St.to = undefined; Sound.se('select'); ui.rerender(); return; }
      if (!sel || !dests.includes(c)) { Sound.se('error'); return; }
      if (St.to === c) { confirm(); return; }
      St.to = c; Sound.se('select'); ui.rerender();
    } : undefined,
    myTurn ? (fs) => {
      if (fs !== seat || !canDeliver) { Sound.se('error'); return; }
      if (St.to === FLAG_TO) { confirm(); return; }
      St.to = FLAG_TO; Sound.se('select'); ui.rerender();
    } : undefined);

  let head: Child;
  let body: Child = null;
  let note: Child = '';
  const foot: Child[] = [];
  if (done) {
    head = h('div', { class: 'm01-big' }, t('p01.finished'));
    body = h('div', { class: 'small dim' }, t('m10.doneNote', { a: HOLD_PTS, b: HOME_PTS }));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, t('m07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, t(v.round === PEACE ? 'm10.breakPeace' : 'm10.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies M10Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    const out = !watching && !mine.length;
    const nm = last ? ui.name(who(last.seat)) : '';
    const lastText = !last ? '' : last.kind === 'pass' ? t('m08.last.pass', { name: nm }) : last.kind === 'deliver' ? t('m10.last.deliver', { name: nm, n: DELIVER_PTS })
      : last.fx?.cap !== undefined ? t(last.fx.capGem ? 'm10.last.capGem' : 'm10.last.cap', { name: nm, other: ui.name(who(last.fx.cap)) }) : last.fx?.pick ? t('m10.last.pick', { name: nm }) : t('m08.last.move', { name: nm });
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, out ? t('m10.youOut') : myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : ''),
      !watching ? h('span', { class: 'small dim row', style: 'gap:8px;align-items:center' }, t('p07.yourColor'), h('i', { class: 'hx-sw', style: `background:${TRI_COLORS[seat]}` })) : null,
      peace ? h('span', { class: 'small tb-peace' }, t('m10.peace', { n: PEACE })) : null,
      lastText ? h('span', { class: 'small dim' }, lastText) : null);
    if (myTurn) {
      if (!acts.length) { note = t('m09.noMove'); foot.push(button(t('m06.pass'), () => { St.n = v.log.length + 1; ui.submit({ t: 'pass' } satisfies M10Move); }, { kind: 'primary' })); }
      else {
        if (!sel) note = t('m10.howPick');
        else if (St.to === undefined) note = t(canDeliver ? 'm10.howDeliver' : sel.gem >= 0 ? 'm10.howCarry' : 'm10.howMove');
        else if (St.to === FLAG_TO) note = h('span', { class: 'gold' }, t('m10.gainDeliver', { n: DELIVER_PTS }));
        else {
          const victim = B.soldiers.find((p) => p.pos === St.to);
          const gem = sel.gem < 0 && (B.ground.some((g) => g.node === St.to) || (victim && victim.gem >= 0));
          const gain = [victim ? t('m10.gainCap', { n: CAP_PTS }) : '', gem ? t('m10.gainPick') : ''].filter(Boolean).join('　');
          note = [gain ? h('span', { class: 'gold' }, gain) : null, danger.length ? h('span', { class: 'pz-warn' }, t(peace ? 'm10.warnSoon' : 'm10.warn')) : gain ? null : t('m08.moveReady')];
        }
        foot.push(button(t(St.to === FLAG_TO ? 'm10.doDeliver' : 'm09.doMove'), confirm, { kind: 'primary', disabled: St.to === undefined }));
        if (sel) foot.push(button(t('m09.unpick'), () => { St.from = St.to = undefined; ui.rerender(); }, { small: true }));
      }
    }
  }
  void HOME;
  const main = h('div', { class: 'hx7 tb7' }, h('div', { class: 'hx7-left' }, board),
    h('div', { class: 'hx7-panel' }, head, body, h('div', { class: 'small fb-note pz-note' }, note), h('div', { class: 'hx7-foot' }, foot), done ? null : h('div', { class: 'small dim' }, t('m10.legend'))));
  return { main, side };
}
