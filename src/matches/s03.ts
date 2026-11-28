/**
 * S03 ミニリバーシ（サブゲーム、2 人）
 * 6×6 の盤面。中央に 2 個ずつ置いて始める。相手の石を自分の石で挟める所にだけ置け、挟んだ石は自分の色になる。
 * 置ける所が無ければパス。2 人とも置けなくなるか、盤面が埋まったら終わり。石の多い方が勝ち。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S03_N = 6;
export const S03_MS = 30_000;
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export type S03Move = { t: 'put'; cell: number } | { t: 'pass' };

export interface S03State {
  players: CharId[];
  board: number[];
  turn: number;
  last: number;
  flipped: number[];
  passed: boolean;
  count: number;
  phase: 'play' | 'done';
  stage: string;
}

export interface S03View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  board: number[];
  turn: number;
  last: number;
  flipped: number[];
  /** 直前に相手がパスしたか */
  passed: boolean;
  /** 今の番の人が置ける所 */
  legal: number[];
  stones: number[];
  phase: S03State['phase'];
}

/** who が cell に置いた時に返る石（置けなければ空） */
export function flipsOf(board: number[], cell: number, who: number): number[] {
  if (board[cell] !== -1) return [];
  const x = cell % S03_N;
  const y = Math.floor(cell / S03_N);
  const out: number[] = [];
  for (const [dx, dy] of D8) {
    const line: number[] = [];
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && ny >= 0 && nx < S03_N && ny < S03_N && board[ny * S03_N + nx] === 1 - who) {
      line.push(ny * S03_N + nx);
      nx += dx;
      ny += dy;
    }
    if (line.length && nx >= 0 && ny >= 0 && nx < S03_N && ny < S03_N && board[ny * S03_N + nx] === who) out.push(...line);
  }
  return out;
}

export const legalOf = (board: number[], who: number): number[] => board.map((_, i) => i).filter((i) => flipsOf(board, i, who).length > 0);
export const stonesOf = (board: number[]): number[] => [board.filter((c) => c === 0).length, board.filter((c) => c === 1).length];

function apply(board: number[], cell: number, who: number): number[] {
  const b = [...board];
  for (const f of flipsOf(board, cell, who)) b[f] = who;
  b[cell] = who;
  return b;
}

// 角は強く、角の隣は弱い
const W = [
  30, -12, 2, 2, -12, 30,
  -12, -16, -1, -1, -16, -12,
  2, -1, 1, 1, -1, 2,
  2, -1, 1, 1, -1, 2,
  -12, -16, -1, -1, -16, -12,
  30, -12, 2, 2, -12, 30,
];

function evalBoard(b: number[], me: number, left: number): number {
  const st = stonesOf(b);
  if (left <= 8) return (st[me] - st[1 - me]) * 10;
  let pos = 0;
  for (let i = 0; i < b.length; i++) if (b[i] === me) pos += W[i]; else if (b[i] === 1 - me) pos -= W[i];
  return pos + (legalOf(b, me).length - legalOf(b, 1 - me).length) * 4;
}

function search(b: number[], who: number, me: number, depth: number, alpha: number, beta: number): number {
  const left = b.filter((c) => c === -1).length;
  const moves = legalOf(b, who);
  if (depth === 0 || left === 0) return evalBoard(b, me, left);
  if (!moves.length) {
    if (!legalOf(b, 1 - who).length) { const st = stonesOf(b); return (st[me] - st[1 - me]) * 100; }
    return search(b, 1 - who, me, depth - 1, alpha, beta);
  }
  if (who === me) {
    let v = -Infinity;
    for (const m of moves) { v = Math.max(v, search(apply(b, m, who), 1 - who, me, depth - 1, alpha, beta)); alpha = Math.max(alpha, v); if (alpha >= beta) break; }
    return v;
  }
  let v = Infinity;
  for (const m of moves) { v = Math.min(v, search(apply(b, m, who), 1 - who, me, depth - 1, alpha, beta)); beta = Math.min(beta, v); if (alpha >= beta) break; }
  return v;
}

function ai(v: S03View, ctx: AiCtx): S03Move {
  if (!v.legal.length) return { t: 'pass' };
  const st = skill(ctx.stats.strategy);
  const ob = skill(ctx.stats.observation); // 副：角や辺の危険に気づく
  const depth = st > 0.75 ? 3 : st > 0.4 ? 2 : 1;
  let best = v.legal[0];
  let bv = -Infinity;
  for (const m of v.legal) {
    const val = search(apply(v.board, m, v.me), 1 - v.me, v.me, depth, -Infinity, Infinity) + ctx.rng.gauss(0, 3 + ctx.noise * 12 + (1 - st) * 6 + (1 - ob) * 2);
    if (val > bv) { bv = val; best = m; }
  }
  return { t: 'put', cell: best };
}

export const S03: MatchEngine<S03State, S03Move, S03View> = {
  id: 's03',
  name: 'ミニリバーシ',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '6×6 の盤面で、相手の石を挟んで自分の色に変える。石の多い方が勝ち。',
  rules: [
    '6×6 の盤面。中央に 2 個ずつ置いて始めます。',
    '相手の石を、縦、横、斜めのどれかで自分の石と挟める所にだけ置けます。挟んだ石は自分の色になります。',
    '置ける所が無い時はパスです。置ける所がある時は、パスできません。',
    '2 人とも置けなくなるか、盤面が埋まったら終わり。石の多い方が勝ち、同じ数なら引き分けです。',
    '先手と後手は、日ごとに入れ替わります。',
    '時間切れの場合：置ける所のうち、一番左上に置かれます。',
  ],
  init(players) {
    const board = Array(S03_N * S03_N).fill(-1);
    board[14] = 1; board[15] = 0; board[20] = 0; board[21] = 1;
    return { players: [...players], board, turn: 0, last: -1, flipped: [], passed: false, count: 0, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [s.players[s.turn]];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `${s.count + 1} 手目`, time: S03_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || s.players[s.turn] !== p) return false;
    const legal = legalOf(s.board, s.turn);
    if (m.t === 'pass') return legal.length === 0;
    return m.t === 'put' && legal.includes(m.cell);
  },
  defaultMove(s) {
    const legal = legalOf(s.board, s.turn);
    return legal.length ? { t: 'put', cell: legal[0] } : { t: 'pass' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`s03: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'put') {
      s.flipped = flipsOf(s.board, m.cell, s.turn);
      s.board = apply(s.board, m.cell, s.turn);
      s.last = m.cell;
      s.passed = false;
    } else {
      s.flipped = [];
      s.passed = true;
    }
    s.count += 1;
    s.stage = String(s.count);
    s.turn = 1 - s.turn;
    if (!legalOf(s.board, 0).length && !legalOf(s.board, 1).length) s.phase = 'done';
  },
  view(s, p) {
    return { self: p, me: p === 'spectator' ? -1 : s.players.indexOf(p), players: s.players, board: [...s.board], turn: s.turn, last: s.last, flipped: s.flipped, passed: s.passed, legal: s.phase === 'play' ? legalOf(s.board, s.turn) : [], stones: stonesOf(s.board), phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    const st = stonesOf(s.board);
    return Object.fromEntries(s.players.map((p, i) => [p, st[i]]));
  },
  ranking(s) {
    const st = stonesOf(s.board);
    return sortGroups(s.players, (p) => st[s.players.indexOf(p)]);
  },
};
