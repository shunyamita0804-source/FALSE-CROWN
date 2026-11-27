/**
 * P10 最後の一手（v11、2 人、5×5 の盤面）
 * 左右の端の列に、駒を 4 個ずつ置く（左右対称。真ん中の段は空ける）。手番に、駒 1 個を縦か横へ 1 マス動かす。
 * 隣に敵の駒があり、その先のマスが空いていれば、飛び越えて取れる（3 点）。飛び越しは 1 手に 1 回。取れる時でも、普通に動いてよい。
 * 巡（2 人が 1 手ずつ）の終わりに、中央の 5 マス（十字）にいる駒 1 個につき 1 点。
 * 1 ゲームは 20 巡、またはどちらかの駒が無くなるまで。先手と後手を入れ替えて 2 ゲーム行い、合計点で決める。
 * 同点は、2 ゲームの終了時に残った駒の合計、それでも同じなら共通決定戦。1 手 15 秒。パスは、動かせる手が無い時と時間切れの時だけ。
 * 5 巡ごとに 15 秒の休憩。補助はない。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const N = 5;
export const ROUNDS = 20;
export const GAMES = 2;
export const CAP_PTS = 3;
export const CENTER_PTS = 1;
export const MOVE_MS = 15_000;
export const BREAK_MS = 15_000;

const at = (x: number, y: number) => y * N + x;
const xy = (c: number): [number, number] => [c % N, Math.floor(c / N)];
/** 中央の 5 マス（十字） */
export const CENTERS = [at(2, 2), at(1, 2), at(3, 2), at(2, 1), at(2, 3)];
const IS_CENTER = Array.from({ length: N * N }, (_, c) => CENTERS.includes(c));
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface Piece { seat: number; pos: number }
/** 最初の配置：席 0 は左端、席 1 は右端 */
export const startPieces = (): Piece[] => [0, 1, 3, 4].flatMap((y) => [{ seat: 0, pos: at(0, y) }, { seat: 1, pos: at(N - 1, y) }]);

export interface Step { from: number; to: number; cap?: number }

/** その席の動かせる手（1 マス動く、または敵を飛び越えて取る） */
export function stepsOf(pieces: Piece[], seat: number): Step[] {
  const occ = new Map(pieces.map((p) => [p.pos, p.seat]));
  const out: Step[] = [];
  for (const p of pieces) {
    if (p.seat !== seat) continue;
    const [x, y] = xy(p.pos);
    for (const [dx, dy] of DIRS) {
      const a = x + dx;
      const b = y + dy;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const o = occ.get(at(a, b));
      if (o === undefined) { out.push({ from: p.pos, to: at(a, b) }); continue; }
      if (o === seat) continue;
      const a2 = a + dx;
      const b2 = b + dy;
      if (a2 < 0 || b2 < 0 || a2 >= N || b2 >= N || occ.has(at(a2, b2))) continue;
      out.push({ from: p.pos, to: at(a2, b2), cap: at(a, b) });
    }
  }
  return out;
}

export const applyStep = (pieces: Piece[], seat: number, s: Step): Piece[] =>
  pieces.filter((p) => p.pos !== s.cap).map((p) => (p.pos === s.from && p.seat === seat ? { seat, pos: s.to } : p));

export const centerCount = (pieces: Piece[], seat: number) => pieces.reduce((n, p) => n + (p.seat === seat && IS_CENTER[p.pos] ? 1 : 0), 0);

export type P10Move = { t: 'move'; from: number; to: number } | { t: 'pass' } | { t: 'ready' };
export interface P10Log { game: number; round: number; seat: number; kind: 'move' | 'pass' | 'score'; from?: number; to?: number; cap?: number; gain?: number[]; pieces: Piece[]; points: number[] }

export interface P10State {
  players: CharId[];
  game: number;
  round: number;
  /** この巡の何手目か（0 は先手、1 は後手） */
  k: number;
  phase: 'play' | 'break' | 'done';
  pieces: Piece[];
  /** 合計点（席の順） */
  points: number[];
  /** ゲームごとの得点 */
  gamePts: number[][];
  /** 終わったゲームで残った駒の合計 */
  remain: number[];
  caps: number[];
  ready: Record<string, boolean>;
  log: P10Log[];
  stage: string;
}

export interface P10View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  game: number;
  games: number;
  round: number;
  rounds: number;
  phase: P10State['phase'];
  toMove: CharId | null;
  /** このゲームの先手の席 */
  first: number;
  pieces: Piece[];
  points: number[];
  gamePts: number[][];
  caps: number[];
  ready: Record<string, boolean>;
  log: P10Log[];
}

/** ゲーム game の、巡の k 手目に動く席 */
export const seatAt = (game: number, k: number) => (game + k) % 2;

// ---- CPU ----

interface Sim { pieces: Piece[]; diff: number; round: number; k: number; game: number }

/** 席 0 から見た評価（得点の差、駒の数の差、中央に近い駒） */
function evalSim(s: Sim): number {
  let v = s.diff;
  const left = ROUNDS - s.round;
  for (const p of s.pieces) {
    const [x, y] = xy(p.pos);
    const d = Math.abs(x - 2) + Math.abs(y - 2);
    const w = 2.0 + (d <= 1 ? Math.min(left, 4) * 0.55 : d === 2 ? 0.35 : 0);
    v += p.seat === 0 ? w : -w;
  }
  return v;
}

function search(s: Sim, depth: number, alpha: number, beta: number): number {
  const n0 = s.pieces.reduce((n, p) => n + (p.seat === 0 ? 1 : 0), 0);
  if (s.round >= ROUNDS || n0 === 0 || n0 === s.pieces.length) return s.diff + (n0 - (s.pieces.length - n0)) * 0.01;
  if (depth <= 0) return evalSim(s);
  const seat = seatAt(s.game, s.k);
  const steps = stepsOf(s.pieces, seat);
  const next = (pieces: Piece[], gain: number): Sim => {
    let diff = s.diff + (seat === 0 ? gain : -gain);
    let round = s.round;
    let k = s.k + 1;
    if (k >= 2) { k = 0; round += 1; diff += (centerCount(pieces, 0) - centerCount(pieces, 1)) * CENTER_PTS; }
    return { pieces, diff, round, k, game: s.game };
  };
  if (!steps.length) return search(next(s.pieces, 0), depth - 1, alpha, beta);
  // 取る手、中央へ入る手から先に読む
  steps.sort((a, b) => (b.cap !== undefined ? 2 : 0) + (IS_CENTER[b.to] ? 1 : 0) - (a.cap !== undefined ? 2 : 0) - (IS_CENTER[a.to] ? 1 : 0));
  if (seat === 0) {
    let best = -Infinity;
    for (const st of steps) {
      best = Math.max(best, search(next(applyStep(s.pieces, seat, st), st.cap !== undefined ? CAP_PTS : 0), depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const st of steps) {
    best = Math.min(best, search(next(applyStep(s.pieces, seat, st), st.cap !== undefined ? CAP_PTS : 0), depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** CPU：相手の応手まで数手先を読む（読む深さは能力で変わる）。中央、取る手、取られない位置を評価する */
function p10Ai(v: P10View, ctx: AiCtx): P10Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const seat = v.me;
  const steps = stepsOf(v.pieces, seat);
  if (!steps.length) return { t: 'pass' };
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.logic);
  const depth = Math.max(1, Math.min(5, Math.round(1.6 + st * 2.2 + lg * 1.0 + ctx.rng.gauss(0, 0.4))));
  const sd = 0.2 + ctx.noise * 0.9 + (1 - st) * 0.9;
  const k = seatAt(v.game, 0) === seat ? 0 : 1;
  const sign = seat === 0 ? 1 : -1;
  let best = steps[0];
  let bestVal = -Infinity;
  for (const s of steps) {
    const pieces = applyStep(v.pieces, seat, s);
    let diff = (v.points[0] - v.points[1]) + sign * (s.cap !== undefined ? CAP_PTS : 0);
    let round = v.round;
    let kk = k + 1;
    if (kk >= 2) { kk = 0; round += 1; diff += (centerCount(pieces, 0) - centerCount(pieces, 1)) * CENTER_PTS; }
    const val = sign * search({ pieces, diff, round, k: kk, game: v.game }, depth - 1, -Infinity, Infinity) + ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = s; }
  }
  return { t: 'move', from: best.from, to: best.to };
}

function endGame(s: P10State): void {
  for (const seat of [0, 1]) s.remain[seat] += s.pieces.filter((p) => p.seat === seat).length;
  if (s.game >= GAMES - 1) { s.phase = 'done'; return; }
  s.game += 1;
  s.round = 0;
  s.k = 0;
  s.pieces = startPieces();
  s.phase = 'break';
  s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
  s.stage = `g${s.game}-break`;
}

export const P10: MatchEngine<P10State, P10Move, P10View> = {
  id: 'p10',
  name: '最後の一手',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 2,
  summary: '5×5 の盤面で駒を 1 マスずつ動かす。敵を飛び越えて取り、中央の十字に駒を置いて点を重ねる。',
  rules: [
    '5×5 の盤面です。左右の端の列に、駒を 4 個ずつ置いて始めます。',
    '手番に、駒 1 個を、縦か横へ 1 マス動かします。',
    `隣に敵の駒があり、その先のマスが空いていれば、飛び越えて取れます（${CAP_PTS} 点）。飛び越しは 1 手に 1 回です。取れる時でも、普通に動いて構いません。`,
    `巡（2 人が 1 手ずつ）の終わりに、中央の 5 マス（十字）にいる駒 1 個につき ${CENTER_PTS} 点が入ります。`,
    `1 ゲームは ${ROUNDS} 巡、またはどちらかの駒が無くなるまで。先手と後手を入れ替えて、2 ゲーム行います。`,
    '1 手 15 秒。パスは、動かせる手が無い時と、時間切れの時だけです。',
    '5 巡ごとに 15 秒の休憩があり、話せます。勝ち負けを約束させる取引はできません。',
    'ピースで買える補助はありません。',
    '2 ゲームの合計点の低い人が脱落します。同点は、2 ゲームの終了時に残った駒の合計で決めます。それでも同じなら共通決定戦です。',
  ],
  init(players) {
    return {
      players: [...players], game: 0, round: 0, k: 0, phase: 'play', pieces: startPieces(),
      points: [0, 0], gamePts: [[0, 0], [0, 0]], remain: [0, 0], caps: [0, 0],
      ready: Object.fromEntries(players.map((p) => [p, false])), log: [], stage: 'g0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return [s.players[seatAt(s.game, s.k)]];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: s.round === 0 ? `休憩（次はゲーム ${s.game + 1}）` : `休憩（次は ${s.round + 1} 巡目）`, time: BREAK_MS, negotiation: true };
    return { label: `ゲーム ${s.game + 1} / ${GAMES}　${s.round + 1} 巡目 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    const seat = seatAt(s.game, s.k);
    if (s.players[seat] !== p) return false;
    if (m.t === 'pass') return true;
    return m.t === 'move' && stepsOf(s.pieces, seat).some((x) => x.from === m.from && x.to === m.to);
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'pass' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p10: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `g${s.game}-${s.round}-0`; }
      return;
    }
    const seat = s.players.indexOf(p);
    const g = s.game;
    if (m.t === 'pass') s.log.push({ game: g, round: s.round, seat, kind: 'pass', pieces: s.pieces, points: [...s.points] });
    else {
      const st = stepsOf(s.pieces, seat).find((x) => x.from === m.from && x.to === m.to)!;
      s.pieces = applyStep(s.pieces, seat, st);
      if (st.cap !== undefined) { s.points[seat] += CAP_PTS; s.gamePts[g][seat] += CAP_PTS; s.caps[seat] += 1; }
      s.log.push({ game: g, round: s.round, seat, kind: 'move', from: st.from, to: st.to, cap: st.cap, pieces: s.pieces, points: [...s.points] });
    }
    s.k += 1;
    s.stage = `g${g}-${s.round}-${s.k}`;
    if (s.k < 2) {
      // 先手の手で相手の駒が無くなった時は、後手の手番を待たずに巡を終える
      if (s.pieces.some((x) => x.seat === 1 - seat)) return;
    }
    // 巡の終わり：中央の点
    const gain = [centerCount(s.pieces, 0) * CENTER_PTS, centerCount(s.pieces, 1) * CENTER_PTS];
    for (const i of [0, 1]) { s.points[i] += gain[i]; s.gamePts[g][i] += gain[i]; }
    s.log.push({ game: g, round: s.round, seat: -1, kind: 'score', gain, pieces: s.pieces, points: [...s.points] });
    s.round += 1;
    s.k = 0;
    s.stage = `g${g}-${s.round}-0`;
    const n0 = s.pieces.filter((x) => x.seat === 0).length;
    if (s.round >= ROUNDS || n0 === 0 || n0 === s.pieces.length) { endGame(s); return; }
    if (s.round % 5 === 0) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      s.stage = `g${g}-${s.round}-break`;
    }
  },
  view(s, p) {
    return {
      self: p, me: p === 'spectator' ? -1 : s.players.indexOf(p), players: s.players, game: s.game, games: GAMES, round: s.round, rounds: ROUNDS, phase: s.phase,
      toMove: s.phase === 'play' ? s.players[seatAt(s.game, s.k)] : null, first: seatAt(s.game, 0),
      pieces: s.pieces, points: [...s.points], gamePts: s.gamePts.map((x) => [...x]), caps: [...s.caps], ready: { ...s.ready }, log: s.log,
    };
  },
  ai: p10Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.points[i]]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.points[s.players.indexOf(p)], (p) => s.remain[s.players.indexOf(p)]);
  },
};
