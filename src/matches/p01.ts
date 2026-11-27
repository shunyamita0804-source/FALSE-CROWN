/**
 * P01 数字の鎖（v11、4 人）
 * 4×4 の数字盤（1〜9）で、縦横に隣り合うマスを 3〜6 個なぞり、合計を目標値に合わせる。
 * 6 ラウンド、各ラウンド 2 問、1 問 25 秒。正解 10 点＋なぞった長さ（最大 6）＋残り時間の加点（最大 3）。
 * 全員が同じ盤面、同じ目標値で同時に解く。2 ラウンドごとに 15 秒の休憩。ピースの補助はない。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 6;
export const QUESTIONS = 2;
export const Q_MS = 25_000;
export const BREAK_MS = 15_000;
export const SIZE = 4;
export const MIN_LEN = 3;
export const MAX_LEN = 6;

export type P01Move = { t: 'chain'; path: number[]; ms: number } | { t: 'pass' } | { t: 'ready' };

export interface P01Answer {
  ok: boolean;
  len: number;
  ms: number;
  points: number;
  path: number[];
}

export interface P01State {
  players: CharId[];
  round: number;
  q: number;
  phase: 'solve' | 'break' | 'done';
  boards: number[][];
  targets: number[][];
  current: Record<string, P01Answer | undefined>;
  answers: Record<string, P01Answer[]>;
  ready: Record<string, boolean>;
}

export interface P01View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  q: number;
  questions: number;
  phase: P01State['phase'];
  board: number[];
  target: number;
  submitted: boolean;
  answers: Record<string, P01Answer[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
  /** 直前の問題の結果（全員ぶん。公開情報） */
  last: { board: number[]; target: number; answers: Record<string, P01Answer> } | null;
}

export const adjacent = (a: number, b: number) => Math.abs((a % SIZE) - (b % SIZE)) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) === 1;

/** 経路が規則どおりか（隣接、重複なし、長さ 3〜6） */
export function legalPath(path: unknown): path is number[] {
  if (!Array.isArray(path) || path.length < MIN_LEN || path.length > MAX_LEN) return false;
  if (path.some((c) => !Number.isInteger(c) || c < 0 || c >= SIZE * SIZE)) return false;
  if (new Set(path).size !== path.length) return false;
  for (let i = 1; i < path.length; i++) if (!adjacent(path[i - 1], path[i])) return false;
  return true;
}

export const sumOf = (board: number[], path: number[]) => path.reduce((n, c) => n + board[c], 0);

export function pointsOf(len: number, ms: number): number {
  return 10 + Math.min(MAX_LEN, len) + Math.floor((Math.max(0, Q_MS - ms) / Q_MS) * 3);
}

function neighbors(c: number): number[] {
  const out: number[] = [];
  const x = c % SIZE;
  const y = Math.floor(c / SIZE);
  if (x > 0) out.push(c - 1);
  if (x < SIZE - 1) out.push(c + 1);
  if (y > 0) out.push(c - SIZE);
  if (y < SIZE - 1) out.push(c + SIZE);
  return out;
}

/** 目標値に合う経路をすべて数える（問題の検査用） */
export function allSolutions(board: number[], target: number, limit = 100000): number[][] {
  const out: number[][] = [];
  const path: number[] = [];
  const used = new Array<boolean>(SIZE * SIZE).fill(false);
  const rec = (c: number, sum: number): void => {
    if (out.length >= limit) return;
    path.push(c);
    used[c] = true;
    const s = sum + board[c];
    if (s === target && path.length >= MIN_LEN) out.push([...path]);
    if (s < target && path.length < MAX_LEN) for (const n of neighbors(c)) if (!used[n]) rec(n, s);
    path.pop();
    used[c] = false;
  };
  for (let c = 0; c < SIZE * SIZE; c++) rec(c, 0);
  return out;
}

/** 合法な経路を先に作り、その合計を目標値にする（必ず正解がある） */
function randomPath(rng: Rng, len: number): number[] | null {
  const path = [rng.int(0, SIZE * SIZE - 1)];
  while (path.length < len) {
    const opts = neighbors(path[path.length - 1]).filter((n) => !path.includes(n));
    if (!opts.length) return null;
    path.push(rng.pick(opts));
  }
  return path;
}

function makeRound(rng: Rng): { board: number[]; targets: number[] } {
  for (let guard = 0; guard < 200; guard++) {
    const board = Array.from({ length: SIZE * SIZE }, () => rng.int(1, 9));
    const targets: number[] = [];
    for (let q = 0; q < QUESTIONS; q++) {
      let p: number[] | null = null;
      for (let g = 0; g < 30 && !p; g++) p = randomPath(rng, rng.int(MIN_LEN + 1, MAX_LEN));
      if (!p) break;
      const t = sumOf(board, p);
      if (targets.includes(t)) break;
      targets.push(t);
    }
    if (targets.length === QUESTIONS) return { board, targets };
  }
  throw new Error('p01: 問題を生成できませんでした');
}

const totalOf = (a: P01Answer[]) => a.reduce((n, x) => n + x.points, 0);

function resolve(s: P01State): void {
  for (const p of s.players) s.answers[p].push(s.current[p] ?? { ok: false, len: 0, ms: Q_MS, points: 0, path: [] });
  s.current = {};
  if (s.q < QUESTIONS - 1) {
    s.q += 1;
    return;
  }
  if (s.round >= ROUNDS - 1) {
    s.phase = 'done';
    return;
  }
  // 2 ラウンドごとに休憩
  if ((s.round + 1) % 2 === 0) {
    s.phase = 'break';
    s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
    return;
  }
  s.round += 1;
  s.q = 0;
}

/**
 * CPU：見えている盤面だけを使い、無作為な出発点から深さ優先で経路を探す。能力（論理）で調べられる数が変わる。
 * 答えにかかる時間は実際の計算時間ではなく、調べた数から決めた仮の時間。
 */
function p01Ai(v: P01View, ctx: AiCtx): P01Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const logic = skill(ctx.stats.logic);
  const rate = (15 + logic * 6) * Math.max(0.5, 1 + ctx.rng.gauss(0, 0.3)) / Math.max(0.6, ctx.noise * 0.5 + 0.5); // 1 秒に調べられるマスの数
  const read = 2.6 + (1 - logic) * 0.7;
  const limitSec = Q_MS / 1000 - 0.8;
  const budget = Math.floor((limitSec - read) * rate);
  // 短い鎖から順に探す。見つけた後、さらに長い鎖を狙って粘るかどうかは性格と能力しだい
  const greed = 0.15 + ctx.personality.ambition / 400 + logic * 0.12;
  let nodes = 0;
  let best: { path: number[]; at: number } | null = null;
  const path: number[] = [];
  const used = new Array<boolean>(SIZE * SIZE).fill(false);
  let want = MIN_LEN;
  let hit: number[] | null = null;
  const rec = (c: number, sum: number): void => {
    if (nodes >= budget || hit) return;
    nodes++;
    path.push(c);
    used[c] = true;
    const sm = sum + v.board[c];
    if (path.length === want) {
      if (sm === v.target) hit = [...path];
    } else if (sm < v.target) for (const n of ctx.rng.shuffle(neighbors(c))) if (!used[n]) rec(n, sm);
    path.pop();
    used[c] = false;
  };
  for (want = MIN_LEN; want <= MAX_LEN && nodes < budget; want++) {
    hit = null;
    for (const c of ctx.rng.shuffle(Array.from({ length: SIZE * SIZE }, (_, i) => i))) {
      if (nodes >= budget || hit) break;
      rec(c, 0);
    }
    if (hit) {
      best = { path: hit, at: nodes };
      if (!ctx.rng.chance(greed)) break;
    }
  }
  const stopAt = () => nodes;
  const found = best as { path: number[]; at: number } | null;
  if (!found) return { t: 'pass' };
  const spent = Math.min(nodes, stopAt());
  const sec = read + spent / rate + found.path.length * 0.35;
  return { t: 'chain', path: found.path, ms: Math.round(Math.min(Q_MS - 300, Math.max(2500, sec * 1000 * (1 + ctx.rng.gauss(0, 0.08))))) };
}

export const P01: MatchEngine<P01State, P01Move, P01View> = {
  id: 'p01',
  name: '数字の鎖',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '隣り合う数字をなぞって、合計を目標値に合わせる。長い鎖ほど高得点。',
  rules: [
    '4×4 の盤面に 1〜9 の数字が並びます。全員が同じ盤面、同じ目標値で同時に解きます。',
    '縦か横に隣り合うマスを 3〜6 個なぞり、数字の合計を目標値に合わせます。同じマスは 2 度使えません。',
    '全 6 ラウンド、1 ラウンド 2 問。1 問の制限時間は 25 秒です。',
    '正解すると 10 点。さらに、なぞったマスの数（最大 6）と、残り時間に応じた加点（最大 3）が加わります。',
    '合計が目標値と違う、時間切れ、未回答は 0 点です。正解は 1 つとは限りません。',
    '2 ラウンドごとに 15 秒の休憩があります。この競技にピースの補助はありません。',
    '合計点の最下位が脱落します。同点は、正解した数、正解にかかった時間の合計の順で決めます。それでも同じなら共通決定戦です。',
  ],
  init(players, rng) {
    const rounds = Array.from({ length: ROUNDS }, () => makeRound(rng));
    return {
      players: [...players],
      round: 0,
      q: 0,
      phase: 'solve',
      boards: rounds.map((r) => r.board),
      targets: rounds.map((r) => r.targets),
      current: {},
      answers: Object.fromEntries(players.map((p) => [p, []])),
      ready: {},
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `休憩（次はラウンド ${s.round + 2}）`, time: BREAK_MS, negotiation: true };
    return { label: `ラウンド ${s.round + 1} / ${ROUNDS}　第 ${s.q + 1} 問`, time: Q_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.current[p]) return false;
    if (m.t === 'pass') return true;
    if (m.t !== 'chain') return false;
    if (typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0 || m.ms > Q_MS + 1000) return false;
    return legalPath(m.path);
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'pass' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p01: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) {
        s.phase = 'solve';
        s.round += 1;
        s.q = 0;
      }
      return;
    }
    if (m.t === 'pass') s.current[p] = { ok: false, len: 0, ms: Q_MS, points: 0, path: [] };
    else {
      const ms = Math.min(Q_MS, m.ms);
      const ok = sumOf(s.boards[s.round], m.path) === s.targets[s.round][s.q];
      s.current[p] = { ok, len: m.path.length, ms, points: ok ? pointsOf(m.path.length, ms) : 0, path: [...m.path] };
    }
    if (s.players.every((x) => s.current[x])) resolve(s);
  },
  view(s, p) {
    const r = Math.min(s.round, ROUNDS - 1);
    const n = s.answers[s.players[0]].length;
    let last: P01View['last'] = null;
    if (n > 0) {
      const lr = Math.floor((n - 1) / QUESTIONS);
      const lq = (n - 1) % QUESTIONS;
      last = { board: s.boards[lr], target: s.targets[lr][lq], answers: Object.fromEntries(s.players.map((x) => [x, s.answers[x][n - 1]])) };
    }
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: ROUNDS,
      q: s.q,
      questions: QUESTIONS,
      phase: s.phase,
      board: s.boards[r],
      target: s.targets[r][Math.min(s.q, QUESTIONS - 1)],
      submitted: p !== 'spectator' && !!s.current[p],
      answers: s.answers,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.answers[x])])),
      ready: { ...s.ready },
      last,
    };
  },
  ai: p01Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.answers[p])]));
  },
  ranking(s) {
    const ok = (p: CharId) => s.answers[p].filter((a) => a.ok).length;
    const time = (p: CharId) => s.answers[p].reduce((n, a) => n + (a.ok ? a.ms : Q_MS), 0);
    return sortGroups(s.players, (p) => totalOf(s.answers[p]) * 100 + ok(p), (p) => -time(p));
  },
};

/** 練習に使う盤面（本番の問題とは別）。目標値は 14 */
export const P01_PRACTICE = [4, 2, 7, 1, 6, 3, 5, 8, 2, 9, 1, 4, 5, 3, 6, 2];
