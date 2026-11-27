/**
 * H03 鏡の迷宮（裏ゲーム、1 人）
 * 左右に 7×7 の盤面が 1 つずつあり、駒が 1 個ずつ置かれている。1 回の操作で 2 つの駒が同時に動く。
 * 左の駒は押した方向へ、右の駒は左右だけ逆の方向へ動く（上下は同じ）。壁や外枠にぶつかる駒は、その場に止まる。
 * 2 つの駒が同時にゴールに乗れば、その面は成功。1 面 30 手まで、全 3 面。
 */
import type { CharId } from '../data/characters';
import { H03_STAGES, type MirrorStage } from '../story/hiddendata';
import { sortGroups, type AiCtx, type MatchEngine } from './types';

export const H03_MS = 150_000;
export type Dir = 'U' | 'D' | 'L' | 'R';
export type H03Move = { t: 'go'; dir: Dir } | { t: 'reset' } | { t: 'giveup' };
type XY = [number, number];

export interface H03State { players: CharId[]; idx: number; pos: [XY, XY]; moves: number; cleared: number; failed: boolean; phase: 'play' | 'done'; stage: string }
export interface H03View { self: CharId | 'spectator'; idx: number; total: number; boards: [string[], string[]]; pos: [XY, XY]; goal: [XY, XY]; moves: number; maxMoves: number; cleared: number; failed: boolean; phase: H03State['phase'] }

const VEC: Record<Dir, XY> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const MIRROR: Record<Dir, Dir> = { U: 'U', D: 'D', L: 'R', R: 'L' };

function step(board: string[], p: XY, d: Dir): XY {
  const [dx, dy] = VEC[d];
  const x = p[0] + dx;
  const y = p[1] + dy;
  if (x < 0 || y < 0 || y >= board.length || x >= board[0].length || board[y][x] === '#') return p;
  return [x, y];
}

/** 1 回の操作のあとの、2 つの駒の位置 */
export function mirrorStep(st: MirrorStage, pos: [XY, XY], d: Dir): [XY, XY] {
  return [step(st.boards[0], pos[0], d), step(st.boards[1], pos[1], MIRROR[d])];
}
export const atGoal = (st: MirrorStage, pos: [XY, XY]) => pos[0][0] === st.goal[0][0] && pos[0][1] === st.goal[0][1] && pos[1][0] === st.goal[1][0] && pos[1][1] === st.goal[1][1];

/** 今の位置からゴールまでの、いちばん短い操作の列（無ければ null） */
export function solveMirror(st: MirrorStage, from: [XY, XY]): Dir[] | null {
  const key = (p: [XY, XY]) => `${p[0][0]},${p[0][1]},${p[1][0]},${p[1][1]}`;
  const seen = new Map<string, { prev: string; d: Dir } | null>([[key(from), null]]);
  const queue: [XY, XY][] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (atGoal(st, cur)) {
      const out: Dir[] = [];
      let k = key(cur);
      for (let e = seen.get(k); e; e = seen.get(k)) { out.unshift(e.d); k = e.prev; }
      return out;
    }
    for (const d of ['U', 'D', 'L', 'R'] as Dir[]) {
      const nx = mirrorStep(st, cur, d);
      const k = key(nx);
      if (seen.has(k)) continue;
      seen.set(k, { prev: key(cur), d });
      queue.push(nx);
    }
  }
  return null;
}

function ai(v: H03View, ctx: AiCtx): H03Move {
  const st = H03_STAGES[v.idx];
  const sol = solveMirror(st, v.pos);
  if (!sol || !sol.length) return { t: 'giveup' };
  // 時々、遠回りの手を選ぶ
  if (ctx.rng.chance(ctx.noise * 0.15)) return { t: 'go', dir: (['U', 'D', 'L', 'R'] as Dir[])[ctx.rng.int(0, 3)] };
  return { t: 'go', dir: sol[0] };
}

const startOf = (i: number): [XY, XY] => [[...H03_STAGES[i].start[0]], [...H03_STAGES[i].start[1]]];

export const H03: MatchEngine<H03State, H03Move, H03View> = {
  id: 'h03',
  name: '鏡の迷宮',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '左右の盤面の駒が、左右だけ逆に動く。2 つの駒を同時にゴールへ運ぶ。',
  rules: [
    '左右に 7×7 の盤面があり、駒が 1 個ずつあります。1 回の操作で、2 つの駒が同時に動きます。',
    '左の駒は、押した方向へ 1 マス動きます。右の駒は、左右だけ逆に動きます（上下は同じ）。',
    '壁や外枠にぶつかる駒は、その場に止まります。もう片方の駒は動きます。',
    '2 つの駒が同時にゴールに乗れば、その面は成功です。全部で 3 面あります。',
    '1 面は 30 手まで。動けなかった操作と「最初から」も 1 手に数えます。',
    '30 手で成功できなかった時、または時間切れの時は失敗です。次の日に、もう一度挑めます。',
  ],
  init(players) {
    return { players: [...players], idx: 0, pos: startOf(0), moves: 0, cleared: 0, failed: false, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `${s.idx + 1} 面 / ${H03_STAGES.length}`, time: H03_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    return m.t === 'giveup' || m.t === 'reset' || (m.t === 'go' && ['U', 'D', 'L', 'R'].includes(m.dir));
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h03: illegal move');
    if (m.t === 'giveup') { s.failed = true; s.phase = 'done'; return; }
    const st = H03_STAGES[s.idx];
    s.moves += 1;
    s.pos = m.t === 'reset' ? startOf(s.idx) : mirrorStep(st, s.pos, m.dir);
    if (atGoal(st, s.pos)) {
      s.cleared += 1;
      if (s.idx + 1 >= H03_STAGES.length) { s.phase = 'done'; return; }
      s.idx += 1;
      s.pos = startOf(s.idx);
      s.moves = 0;
      s.stage = String(s.idx);
      return;
    }
    if (s.moves >= st.maxMoves) { s.failed = true; s.phase = 'done'; }
  },
  view(s, p) {
    const st = H03_STAGES[s.idx];
    return { self: p, idx: s.idx, total: H03_STAGES.length, boards: st.boards, pos: [[...s.pos[0]], [...s.pos[1]]], goal: st.goal, moves: s.moves, maxMoves: st.maxMoves, cleared: s.cleared, failed: s.failed, phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, s.cleared]));
  },
  ranking(s) {
    return sortGroups(s.players, () => s.cleared);
  },
};
