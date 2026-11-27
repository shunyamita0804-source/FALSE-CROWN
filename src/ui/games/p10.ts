/**
 * P10 最後の一手の画面。左に 5×5 の盤面、右に手番と操作、横に得点を置く。
 * 自分の駒をタップすると動けるマスが光る（飛び越して取れる先は赤い枠）。行き先をタップして選び、もう一度タップするか「動かす」で確定する。
 * 行き先が次に取られる位置の時は、確定の前に知らせる。相手の手と、巡の終わりの中央の点は順に見せる。
 */
import { Sound } from '../../audio/audio';
import type { CharId, NpcId } from '../../data/characters';
import { t } from '../../i18n/i18n';
import { CAP_PTS, CENTER_PTS, applyStep, stepsOf, type P10Log, type P10Move, type P10View, type Piece } from '../../matches/p10';
import { face } from '../art';
import { button, h, type Child } from '../dom';
import { HEX_COLORS } from '../hexboard';
import type { MatchUi } from '../matchui';
import { pieceBoard } from '../pieceboard';

interface Seen { n: number; timer?: ReturnType<typeof setTimeout>; from?: number; to?: number; key?: string }
const SEEN = new WeakMap<object, Seen>();
const STEP_MS = 800;
export const P10_COLORS = [HEX_COLORS[0], HEX_COLORS[1]];

export function renderP10(v: P10View, ui: MatchUi): { main: Child; side: Child } {
  const me = v.self as CharId;
  const watching = v.self === 'spectator';
  const seat = v.me;
  let S = SEEN.get(ui.slot);
  if (!S) {
    const mine = v.log.map((l) => l.seat).lastIndexOf(seat);
    S = { n: Math.max(0, mine + 1, v.log.length - 2) };
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
      if (l?.kind === 'score') { if ((l.gain?.[0] ?? 0) + (l.gain?.[1] ?? 0) > 0) Sound.se('coins'); } else Sound.se(l?.cap !== undefined ? 'chipsHit' : l?.kind === 'move' ? 'chip' : 'click');
      ui.rerender();
    }, nxt.kind === 'score' ? 450 : STEP_MS);
  }
  const last: P10Log | undefined = St.n > 0 ? v.log[St.n - 1] : undefined;
  // 表示中のゲーム：再生中は記録のゲーム、追いついたら今のゲーム
  const shownGame = replaying ? v.log[St.n].game : v.game;
  const pieces: Piece[] = !replaying ? v.pieces : last && last.game === shownGame ? last.pieces : v.start;
  const done = v.phase === 'done' && !replaying;
  const points = !replaying ? v.points : last ? last.points : [0, 0];
  const turnOf = replaying ? (v.log[St.n].seat >= 0 ? v.players[v.log[St.n].seat] : null) : v.toMove;
  const myTurn = !replaying && !watching && v.phase === 'play' && v.toMove === me;
  const key = `${v.game}-${v.round}-${v.log.length}`;
  if (St.key !== key || !myTurn) { St.key = key; St.from = St.to = undefined; }

  const order = [0, 1].sort((a, b) => points[b] - points[a]);
  const table = h('div', { class: 'm01-rank pz-rank' }, order.map((i) => {
    const p = v.players[i];
    return h('div', { class: `m01-rankrow${p === me ? ' me' : ''}${turnOf === p ? ' now' : ''}` },
      h('i', { class: 'hx-sw', style: `background:${P10_COLORS[i]}` }), face(p), h('span', { class: 'nm' }, ui.name(p)),
      h('small', { class: 'dim' }, t('p10.rowInfo', { n: pieces.filter((q) => q.seat === i).length })), h('b', null, String(points[i])));
  }));
  const side = [
    h('div', { class: 'box scroll grow' }, h('h4', null, t('m01.rank')), table, h('div', { class: 'small dim', style: 'margin-top:6px' }, t('p10.tableNote', { c: CAP_PTS, m: CENTER_PTS }))),
    v.games === 1 ? h('div', { class: 'box' }, h('div', { class: 'small' }, t('h06.sideNote'))) : h('div', { class: 'box' }, h('h4', null, t('p10.gameTitle', { n: shownGame + 1 })), h('div', { class: 'small' }, t('p10.firstNote', { name: ui.name(v.players[(shownGame) % 2]) })),
      [0, 1].filter((g) => g <= v.game).map((g) => h('div', { class: 'small dim' }, t('p10.gameRow', { n: g + 1, na: ui.name(v.players[0]), a: v.gamePts[g][0], b: v.gamePts[g][1], nb: ui.name(v.players[1]) })))),
  ];

  const marks: Record<number, string> = {};
  const add = (c: number, cls: string) => { marks[c] = `${marks[c] ?? ''} ${cls}`; };
  for (const c of v.centers) add(c, last?.kind === 'score' && pieces.some((p) => p.pos === c) ? 'center award' : 'center');
  if (last?.kind === 'move' && last.game === shownGame) { add(last.from!, 'from'); add(last.to!, 'to'); if (last.cap !== undefined) add(last.cap, 'to hit'); }
  const steps = myTurn ? stepsOf(pieces, seat) : [];
  const mine = pieces.filter((p) => p.seat === seat);
  const sel = St.from !== undefined ? mine.find((p) => p.pos === St.from) : undefined;
  const selSteps = sel ? steps.filter((s) => s.from === sel.pos) : [];
  const chosen = St.to !== undefined ? selSteps.find((s) => s.to === St.to) : undefined;
  if (myTurn) {
    if (sel) { add(sel.pos, 'sel'); for (const s of selSteps) add(s.to, s.cap !== undefined ? 'can cap' : 'can'); }
    else for (const p of mine) if (steps.some((s) => s.from === p.pos)) add(p.pos, 'movable');
    if (chosen) { add(chosen.to, 'chosen'); if (chosen.cap !== undefined) add(chosen.cap, 'threat'); }
  }
  // 行き先が、次に飛び越されて取られる位置かどうか
  let danger = false;
  if (chosen) {
    const next = applyStep(pieces, seat, chosen);
    const hits = stepsOf(next, 1 - seat).filter((s) => s.cap === chosen.to);
    danger = hits.length > 0;
    for (const s of hits) add(s.from, 'threat');
  }
  const confirm = () => {
    if (!chosen) return;
    Sound.se(chosen.cap !== undefined ? 'chipsHit' : 'chip');
    const mv = { t: 'move', from: chosen.from, to: chosen.to } satisfies P10Move;
    St.from = St.to = undefined;
    St.n = v.log.length + 1;
    ui.submit(mv);
  };
  const board = pieceBoard({
    n: 5, cell: 112, pieces: pieces.map((p) => ({ pos: p.pos, seat: p.seat, kind: 'pawn' as const })), colors: P10_COLORS, me: seat, marks,
    onCell: myTurn ? (c) => {
      const own = mine.find((p) => p.pos === c);
      if (own) { if (!steps.some((s) => s.from === c)) { Sound.se('error'); return; } St.from = St.from === c ? undefined : c; St.to = undefined; Sound.se('select'); ui.rerender(); return; }
      if (!sel || !selSteps.some((s) => s.to === c)) { Sound.se('error'); return; }
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
    body = h('div', { class: 'small dim' }, t(v.games === 1 ? 'h06.doneNote' : 'p10.doneNote'));
  } else if (v.phase === 'break' && !replaying) {
    head = h('div', { class: 'm01-big' }, v.round === 0 ? t('p10.breakGame', { n: v.game + 1 }) : t('m07.breakTitle', { n: v.round + 1 }));
    body = [
      h('div', { class: 'small dim' }, v.round === 0 ? t('p10.breakGameNote', { name: ui.name(v.players[v.first]) }) : t('p10.breakNote')),
      !watching ? h('div', { class: 'row mq-talk', style: 'gap:6px;flex-wrap:wrap' }, v.players.filter((p) => p !== me).map((p) => button([face(p), ui.name(p)], () => ui.talk(p as NpcId), { small: true }))) : null,
      !watching && !v.ready[me] ? button(t('m07.resume'), () => ui.submit({ t: 'ready' } satisfies P10Move), { kind: 'primary', autofocus: true }) : null,
    ];
  } else {
    const nm = last && last.seat >= 0 ? ui.name(v.players[last.seat]) : '';
    const lastText = !last ? '' : last.kind === 'score' ? t('p10.last.score', { a: last.gain![0], b: last.gain![1], na: ui.name(v.players[0]), nb: ui.name(v.players[1]) }) : last.kind === 'pass' ? t('m08.last.pass', { name: nm }) : last.cap !== undefined ? t('p10.last.cap', { name: nm, n: CAP_PTS }) : t('m08.last.move', { name: nm });
    head = h('div', { class: 'hx7-head' },
      h('b', { class: myTurn ? 'gold' : '' }, myTurn ? t('m07.yourTurn') : turnOf ? t('p05.waitTurn', { name: turnOf === me ? t('p05.you') : ui.name(turnOf) }) : t('m09.roundEnd')),
      !watching ? h('span', { class: 'small dim row', style: 'gap:8px;align-items:center' }, t('p07.yourColor'), h('i', { class: 'hx-sw', style: `background:${P10_COLORS[seat]}` })) : null,
      lastText ? h('span', { class: 'small dim' }, lastText) : null);
    if (myTurn) {
      if (!steps.length) { note = t('m09.noMove'); foot.push(button(t('m06.pass'), () => { St.n = v.log.length + 1; ui.submit({ t: 'pass' } satisfies P10Move); }, { kind: 'primary' })); }
      else {
        if (!sel) note = t('m09.howPick');
        else if (!chosen) note = t('p10.howMove');
        else {
          const gain = chosen.cap !== undefined ? t('p10.gainCap', { n: CAP_PTS }) : v.centers.includes(chosen.to) ? t('p10.gainCenter', { n: CENTER_PTS }) : '';
          note = [gain ? h('span', { class: 'gold' }, gain) : null, danger ? h('span', { class: 'pz-warn' }, t('p10.warn')) : gain ? null : t('m08.moveReady')];
        }
        foot.push(button(t('m09.doMove'), confirm, { kind: 'primary', disabled: !chosen }));
        if (sel) foot.push(button(t('m09.unpick'), () => { St.from = St.to = undefined; ui.rerender(); }, { small: true }));
      }
    }
  }
  const main = h('div', { class: 'hx7 pz7' }, h('div', { class: 'hx7-left' }, board),
    h('div', { class: 'hx7-panel' }, head, body, h('div', { class: 'small fb-note pz-note' }, note), h('div', { class: 'hx7-foot' }, foot), done ? null : h('div', { class: 'small dim' }, t('p10.legend'))));
  return { main, side };
}
