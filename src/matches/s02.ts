/**
 * S02 五目並べ（サブゲーム、2 人）
 * 9×9 の盤面に、交互に石を 1 つずつ置く。縦、横、斜めのどれかに 5 つ以上並べた方が勝ち。盤面が埋まれば引き分け。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S02_N = 9;
export const S02_MS = 30_000;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export type S02Move = { t: 'put'; cell: number };

export interface S02State {
  players: CharId[];
  /** -1 空き、0 先手、1 後手 */
  board: number[];
  turn: number;
  winner: number;
  line: number[];
  last: number;
  count: number;
  phase: 'play' | 'done';
  stage: string;
}

export interface S02View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  board: number[];
  turn: number;
  winner: number;
  line: number[];
  last: number;
  count: number;
  phase: S02State['phase'];
}

const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < S02_N && y < S02_N;

/** cell に who の石がある時、そこを通る 5 つ以上の並び（無ければ空） */
export function lineAt(board: number[], cell: number, who: number): number[] {
  const x = cell % S02_N;
  const y = Math.floor(cell / S02_N);
  for (const [dx, dy] of DIRS) {
    const cells = [cell];
    for (const sg of [1, -1]) {
      for (let k = 1; k < S02_N; k++) {
        const nx = x + dx * k * sg;
        const ny = y + dy * k * sg;
        if (!inside(nx, ny) || board[ny * S02_N + nx] !== who) break;
        cells.push(ny * S02_N + nx);
      }
    }
    if (cells.length >= 5) return cells;
  }
  return [];
}

/** cell に who が置いた時の、4 方向の「並びの長さ」と「両端の空き」から出す点 */
function shape(board: number[], cell: number, who: number): number {
  const x = cell % S02_N;
  const y = Math.floor(cell / S02_N);
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let len = 1;
    let open = 0;
    for (const sg of [1, -1]) {
      let k = 1;
      for (; k < 5; k++) {
        const nx = x + dx * k * sg;
        const ny = y + dy * k * sg;
        if (!inside(nx, ny) || board[ny * S02_N + nx] !== who) break;
        len++;
      }
      const ex = x + dx * k * sg;
      const ey = y + dy * k * sg;
      if (inside(ex, ey) && board[ey * S02_N + ex] === -1) open++;
    }
    if (len >= 5) total += 100000;
    else if (len === 4) total += open === 2 ? 10000 : open === 1 ? 1200 : 0;
    else if (len === 3) total += open === 2 ? 900 : open === 1 ? 90 : 0;
    else if (len === 2) total += open === 2 ? 60 : open === 1 ? 10 : 0;
    else total += open;
  }
  return total;
}

function ai(v: S02View, ctx: AiCtx): S02Move {
  const me = v.me;
  const empty = v.board.map((c, i) => (c === -1 ? i : -1)).filter((i) => i >= 0);
  if (v.count === 0) return { t: 'put', cell: 40 };
  const st = skill(ctx.stats.strategy);
  const ob = skill(ctx.stats.observation);
  let best = empty[0];
  let bv = -Infinity;
  for (const c of empty) {
    const x = c % S02_N;
    const y = Math.floor(c / S02_N);
    // 石の近くだけを考える
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (inside(x + dx, y + dy) && v.board[(y + dy) * S02_N + x + dx] !== -1) { near = true; break; }
    if (!near) continue;
    const own = shape(v.board, c, me);
    let opp = shape(v.board, c, 1 - me);
    // 観察が低いと、相手の 3 つ並びを時々見落とす（4 つ並びは見落とさない）
    if (opp < 5000 && ctx.rng.chance((1 - ob) * 0.25 + ctx.noise * 0.1)) opp *= 0.2;
    const val = own * 1.1 + opp * (0.75 + st * 0.2) + ctx.rng.next() * (20 + (1 - st) * 120);
    if (val > bv) { bv = val; best = c; }
  }
  return { t: 'put', cell: best };
}

export const S02: MatchEngine<S02State, S02Move, S02View> = {
  id: 's02',
  name: '五目並べ',
  kind: 'sub',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '9×9 の盤面に交互に石を置き、先に 5 つ並べた方が勝ち。',
  rules: [
    '9×9 の盤面に、交互に石を 1 つずつ置きます。空いているマスなら、どこにでも置けます。',
    '縦、横、斜めのどれかに、自分の石を 5 つ以上並べた方が勝ちです。',
    '盤面が全部埋まったら引き分けです。',
    '先手と後手は、日ごとに入れ替わります。',
    '時間切れの場合：空いているマスのうち、一番左上に置かれます。',
  ],
  init(players) {
    return { players: [...players], board: Array(S02_N * S02_N).fill(-1), turn: 0, winner: -1, line: [], last: -1, count: 0, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [s.players[s.turn]];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `${s.count + 1} 手目`, time: S02_MS };
  },
  validate(s, p, m) {
    return !!m && s.phase === 'play' && s.players[s.turn] === p && m.t === 'put' && Number.isInteger(m.cell) && s.board[m.cell] === -1;
  },
  defaultMove(s) {
    return { t: 'put', cell: s.board.indexOf(-1) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`s02: illegal move ${JSON.stringify(m)}`);
    s.board[m.cell] = s.turn;
    s.last = m.cell;
    s.count += 1;
    const line = lineAt(s.board, m.cell, s.turn);
    if (line.length) { s.winner = s.turn; s.line = line; s.phase = 'done'; } else if (s.count >= S02_N * S02_N) s.phase = 'done';
    else s.turn = 1 - s.turn;
    s.stage = String(s.count);
  },
  view(s, p) {
    return { self: p, me: p === 'spectator' ? -1 : s.players.indexOf(p), players: s.players, board: [...s.board], turn: s.turn, winner: s.winner, line: s.line, last: s.last, count: s.count, phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.winner === i ? 1 : 0]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => (s.winner === s.players.indexOf(p) ? 1 : 0));
  },
};
