/**
 * P07 ブラック＆ホワイト（v11、3 人）
 * 半径 3 の六角盤（37 マス。真ん中の 1 マスは穴で、置けるのは 36 マス）。3 色の駒を 3 個ずつ、120 度回しても同じになる形に置いて始める。
 * 手番に空きマスへ駒を 1 個置く。置いた駒と自分の駒の間に、まっすぐ並んだ他の色の駒（色が混ざっていてもよい。空きマスがあると不可）があれば、すべて自分の色に返す。
 * 返せる場所がある時は、必ず返せる場所に置く。無い時は、自分の駒の隣の空きマスに置ける。それも無ければパス。
 * 12 巡。盤面が埋まるか、全員が続けてパスしたら終わる。順位は駒の数、同数は穴を囲む 6 マスにある自分の駒の数。
 * 先手は巡ごとに交代する。3 巡ごとに 15 秒の相談時間がある。ピースで買える補助はない。
 */
import type { CharId } from '../data/characters';
import { DIRS, cellAt, hexGrid, ringOf, type HexGrid } from './hex';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const RADIUS = 3;
export const ROUNDS = 12;
export const MOVE_MS = 30_000;
export const BREAK_MS = 15_000;
export const G: HexGrid = hexGrid(RADIUS);
/** 真ん中の 1 マスは穴で、誰も置けない（空きマスが 27 になり、全員が同じ回数だけ置ける） */
export const HOLE = cellAt(G, 0, 0);
export const HOLE_V = -2;
export const isCenter = (c: number) => ringOf(G, c) === 1;
/** 角の 6 マス（どの方向からも挟まれないので、返されない） */
export const isCorner = (c: number) => { const [q, r] = G.cells[c]; return ringOf(G, c) === RADIUS && (q === 0 || r === 0 || q + r === 0); };

/** 最初の配置。3 人：中心の周りの 6 マスに A C B A C B、その外側に 1 個ずつ。2 人：中心の周りに交互 */
export function startBoard(n: number): number[] {
  const b = new Array<number>(G.cells.length).fill(-1);
  b[HOLE] = HOLE_V;
  if (n === 2) { DIRS.forEach(([q, r], i) => { b[cellAt(G, q, r)] = i % 2; }); return b; }
  const ring = [0, 2, 1, 0, 2, 1];
  DIRS.forEach(([q, r], i) => { b[cellAt(G, q, r)] = ring[i]; });
  [1, 3, 5].forEach((d, k) => { b[cellAt(G, DIRS[d][0] * 2, DIRS[d][1] * 2)] = k; });
  return b;
}

/** cell に seat の駒を置いた時に返る駒 */
export function flipsFor(board: number[], seat: number, cell: number): number[] {
  if (board[cell] !== -1) return [];
  const out: number[] = [];
  const [q0, r0] = G.cells[cell];
  for (const [dq, dr] of DIRS) {
    const run: number[] = [];
    let q = q0 + dq;
    let r = r0 + dr;
    for (;;) {
      const c = cellAt(G, q, r);
      if (c < 0 || board[c] < 0) break;
      if (board[c] === seat) { out.push(...run); break; }
      run.push(c);
      q += dq;
      r += dr;
    }
  }
  return out;
}

export interface Legal { kind: 'flip' | 'free' | 'pass'; cells: number[] }

/** 置ける場所：返せる場所があればそれだけ。無ければ自分の駒の隣の空きマス。それも無ければパス */
export function legalFor(board: number[], seat: number): Legal {
  const flip: number[] = [];
  const free: number[] = [];
  board.forEach((o, c) => {
    if (o !== -1) return;
    if (flipsFor(board, seat, c).length) flip.push(c);
    else if (G.adj[c].some((n) => board[n] === seat)) free.push(c);
  });
  if (flip.length) return { kind: 'flip', cells: flip };
  if (free.length) return { kind: 'free', cells: free };
  return { kind: 'pass', cells: [] };
}

export const countOf = (board: number[], seat: number) => board.filter((o) => o === seat).length;
export const centerOf = (board: number[], seat: number) => board.filter((o, c) => o === seat && isCenter(c)).length;

export type P07Move = { t: 'put'; cell: number } | { t: 'pass' } | { t: 'ready' };
export interface P07Log { round: number; seat: number; cell: number | null; flipped: number[] }

export interface P07State {
  players: CharId[];
  board: number[];
  round: number;
  turn: number;
  phase: 'play' | 'break' | 'done';
  passes: number;
  ready: Record<string, boolean>;
  log: P07Log[];
  stage: string;
}

export interface P07View {
  self: CharId | 'spectator';
  players: CharId[];
  seat: number;
  board: number[];
  round: number;
  rounds: number;
  phase: P07State['phase'];
  order: CharId[];
  toMove: CharId | null;
  /** 手番の人が置ける場所 */
  legal: Legal;
  counts: Record<string, number>;
  centers: Record<string, number>;
  ready: Record<string, boolean>;
  log: P07Log[];
}

export const orderAt = (players: CharId[], round: number) => players.map((_, i) => players[(i + round) % players.length]);
const moverOf = (s: P07State) => orderAt(s.players, s.round)[s.turn];

const posValue = (c: number) => (isCorner(c) ? 2.6 : ringOf(G, c) === RADIUS ? 0.7 : isCenter(c) ? 0.5 : ringOf(G, c) === RADIUS - 1 ? -0.5 : 0);

/**
 * CPU：置ける場所をすべて試し、増える駒の数、場所の良さ（角は返されない、中央は同数の時に効く）、
 * 次の人に返される駒の数で選ぶ。読みの重さは能力で変わる。
 */
function p07Ai(v: P07View, ctx: AiCtx): P07Move {
  if (v.phase !== 'play') return { t: 'ready' };
  if (v.legal.kind === 'pass') return { t: 'pass' };
  const seat = v.seat;
  const n = v.players.length;
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.observation); // 副：反転される危険に気づく（観察）
  const order = v.order.map((p) => v.players.indexOf(p));
  const next = order[(order.indexOf(seat) + 1) % n];
  const sd = 0.4 + ctx.noise * 1.2 + (1 - st) * 1.5;
  let best = v.legal.cells[0];
  let bestVal = -Infinity;
  for (const c of v.legal.cells) {
    const fl = flipsFor(v.board, seat, c);
    const b = [...v.board];
    b[c] = seat;
    for (const x of fl) b[x] = seat;
    let val = 1 + fl.length + posValue(c) * (0.5 + st);
    // 次の人の一番痛い返し
    let worst = 0;
    for (const m of legalFor(b, next).cells) { const lost = flipsFor(b, next, m).filter((x) => b[x] === seat).length; if (lost > worst) worst = lost; }
    val -= worst * (0.25 + lg * 0.75);
    val += ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = c; }
  }
  return { t: 'put', cell: best };
}

export const P07: MatchEngine<P07State, P07Move, P07View> = {
  id: 'p07',
  name: 'ブラック＆ホワイト',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 3,
  summary: '六角形の盤面に駒を置き、挟んだ他の色の駒を自分の色に返す。最後に駒が一番多い人が上位。',
  rules: [
    '盤面は六角形 36 マス（真ん中の 1 マスは穴で、置けません）。3 色の駒が 3 個ずつ置かれた状態から始めます。色はくじで決まります。',
    '手番に、空きマスへ自分の駒を 1 個置きます。置いた駒と自分の駒の間に、まっすぐ並んだ他の色の駒があれば、すべて自分の色に返します。色が混ざっていても返せます。間に空きマスがあると返せません。',
    '返せる場所がある時は、必ず返せる場所に置きます。',
    '返せる場所が無い時は、自分の駒の隣の空きマスに置けます。それも無ければパスです。',
    `全 ${ROUNDS} 巡。盤面が埋まった時、全員が続けてパスした時は、その時点で終わります。先手は巡ごとに交代します。`,
    '3 巡ごとに 15 秒の相談時間があります。誰を狙うかの相談はできますが、守るかどうかは本人次第です。ピースで買える補助はありません。',
    '駒の数の最下位が脱落します。同数は、穴を囲む 6 マスにある自分の駒の数で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：置ける場所のうち、返せる数が一番少ない場所に自動で置きます。',
  ],
  init(players, rng) {
    // 色（席）はくじで決める
    const seated = rng.shuffle([...players]);
    return {
      players: seated, board: startBoard(players.length), round: 0, turn: 0, phase: 'play', passes: 0,
      ready: Object.fromEntries(seated.map((p) => [p, false])), log: [], stage: '0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return [moverOf(s)];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `相談（次は第 ${s.round + 1} 巡）`, time: BREAK_MS, negotiation: true };
    return { label: `第 ${s.round + 1} 巡 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (moverOf(s) !== p) return false;
    const lg = legalFor(s.board, s.players.indexOf(p));
    if (m.t === 'pass') return lg.kind === 'pass';
    return m.t === 'put' && Number.isInteger(m.cell) && lg.cells.includes(m.cell);
  },
  defaultMove(s, p) {
    if (s.phase === 'break') return { t: 'ready' };
    const seat = s.players.indexOf(p);
    const lg = legalFor(s.board, seat);
    if (lg.kind === 'pass') return { t: 'pass' };
    let best = lg.cells[0];
    let n = Infinity;
    for (const c of lg.cells) { const k = flipsFor(s.board, seat, c).length; if (k < n) { n = k; best = c; } }
    return { t: 'put', cell: best };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p07: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `${s.round}-0`; }
      return;
    }
    const seat = s.players.indexOf(p);
    if (m.t === 'put') {
      const flipped = flipsFor(s.board, seat, m.cell);
      s.board[m.cell] = seat;
      for (const c of flipped) s.board[c] = seat;
      s.log.push({ round: s.round, seat, cell: m.cell, flipped });
      s.passes = 0;
    } else {
      s.log.push({ round: s.round, seat, cell: null, flipped: [] });
      s.passes += 1;
    }
    s.turn += 1;
    s.stage = `${s.round}-${s.turn}`;
    if (s.passes >= s.players.length || s.board.every((o) => o !== -1)) { s.phase = 'done'; return; }
    if (s.turn < s.players.length) return;
    s.turn = 0;
    s.round += 1;
    s.stage = `${s.round}-0`;
    if (s.round >= ROUNDS) { s.phase = 'done'; return; }
    if (s.round % 3 === 0) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      s.stage = `${s.round}-break`;
    }
  },
  view(s, p) {
    const mover = s.phase === 'play' ? moverOf(s) : null;
    return {
      self: p, players: s.players, seat: p === 'spectator' ? -1 : s.players.indexOf(p), board: [...s.board],
      round: s.round, rounds: ROUNDS, phase: s.phase, order: orderAt(s.players, Math.min(s.round, ROUNDS - 1)), toMove: mover,
      legal: mover ? legalFor(s.board, s.players.indexOf(mover)) : { kind: 'pass', cells: [] },
      counts: Object.fromEntries(s.players.map((x, i) => [x, countOf(s.board, i)])),
      centers: Object.fromEntries(s.players.map((x, i) => [x, centerOf(s.board, i)])),
      ready: { ...s.ready }, log: s.log,
    };
  },
  ai: p07Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, countOf(s.board, i)]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => countOf(s.board, s.players.indexOf(p)), (p) => centerOf(s.board, s.players.indexOf(p)));
  },
};
