/**
 * P08 数字の天秤（v11、2 人）
 * 全 7 ラウンド。各ラウンドに数字タイル 8 枚と、皿に最初から載っている固定の重り（1〜8）がある。
 * タイルを左右の皿に載せて（各皿 4 枚まで）、左右の合計を同じにする。ラウンドごとに追加の条件（何枚以上使う、このタイルは左、など）が示される。
 * 全員が同じ問題を同時に解く。制限 90 秒。正解 20 点 ＋ 残り時間に応じて最大 5 点。つり合わない、条件に合わない時は 0 点。別の答えも正解。
 * 3 ラウンドの後に 20 秒の休憩。ピースで買える補助はない。順位は合計点、正解数、正解にかかった時間の合計の順。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 7;
export const ROUND_MS = 90_000;
export const BREAK_MS = 20_000;
export const OK_PTS = 20;
export const TIME_PTS = 5;
export const PAN_MAX = 4;
export const TILES = 8;

export interface Scale {
  tiles: number[];
  /** 最初から載っている固定の重り（0 は無し） */
  fixL: number;
  fixR: number;
  /** 使うタイルの最小枚数（8 は全部） */
  minUse: number;
  /** 左（右）に載せなければならないタイルの番号 */
  mustL: number[];
  mustR: number[];
}

/** place[i]：0 は使わない、1 は左、2 は右 */
export interface Judge { left: number; right: number; nL: number; nR: number; used: number; balanced: boolean; useOk: boolean; mustOk: boolean; panOk: boolean; ok: boolean }

export function judge(sc: Scale, place: number[]): Judge {
  let left = sc.fixL;
  let right = sc.fixR;
  let nL = 0;
  let nR = 0;
  sc.tiles.forEach((v, i) => { if (place[i] === 1) { left += v; nL++; } else if (place[i] === 2) { right += v; nR++; } });
  const used = nL + nR;
  const balanced = left === right && used > 0;
  const useOk = used >= sc.minUse;
  const mustOk = sc.mustL.every((i) => place[i] === 1) && sc.mustR.every((i) => place[i] === 2);
  const panOk = nL <= PAN_MAX && nR <= PAN_MAX;
  return { left, right, nL, nR, used, balanced, useOk, mustOk, panOk, ok: balanced && useOk && mustOk && panOk };
}

/** 正解を数え上げる（深さ優先。皿の枚数と指定の条件で枝を刈る）。limit 個で打ち切る */
export function solutions(sc: Scale, limit = Infinity): number[][] {
  const out: number[][] = [];
  const n = sc.tiles.length;
  const place = new Array<number>(n).fill(0);
  const force = new Array<number>(n).fill(-1);
  for (const i of sc.mustL) force[i] = 1;
  for (const i of sc.mustR) force[i] = 2;
  // 残りのタイルの合計（差を埋められない枝を刈る）
  const rest = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) rest[i] = rest[i + 1] + sc.tiles[i];
  const go = (i: number, diff: number, nL: number, nR: number): void => {
    if (out.length >= limit) return;
    if (Math.abs(diff) > rest[i]) return;
    if (i === n) {
      if (diff === 0 && nL + nR > 0 && nL + nR >= sc.minUse) out.push([...place]);
      return;
    }
    if (nL + nR + (n - i) < sc.minUse) return;
    const f = force[i];
    if (f < 0 || f === 0) { place[i] = 0; go(i + 1, diff, nL, nR); }
    if ((f < 0 || f === 1) && nL < PAN_MAX) { place[i] = 1; go(i + 1, diff + sc.tiles[i], nL + 1, nR); }
    if ((f < 0 || f === 2) && nR < PAN_MAX) { place[i] = 2; go(i + 1, diff - sc.tiles[i], nL, nR + 1); }
    place[i] = 0;
  };
  go(0, sc.fixL - sc.fixR, 0, 0);
  return out;
}

/** ラウンドごとの条件（だんだん厳しくなる）。sol は正解の数の範囲 */
const PLAN: { max: number; fix: 'one' | 'both'; minUse: number; mustL: number; mustR: number; sol: [number, number] }[] = [
  { max: 9, fix: 'one', minUse: 1, mustL: 0, mustR: 0, sol: [100, 300] },
  { max: 10, fix: 'one', minUse: 1, mustL: 1, mustR: 0, sol: [25, 70] },
  { max: 12, fix: 'both', minUse: 6, mustL: 0, mustR: 0, sol: [10, 70] },
  { max: 12, fix: 'both', minUse: 4, mustL: 1, mustR: 1, sol: [8, 24] },
  { max: 14, fix: 'both', minUse: 7, mustL: 0, mustR: 0, sol: [6, 20] },
  { max: 15, fix: 'both', minUse: 6, mustL: 1, mustR: 1, sol: [3, 10] },
  { max: 16, fix: 'both', minUse: 8, mustL: 1, mustR: 0, sol: [1, 4] },
];

export function makeScale(rng: Rng, round: number): Scale {
  const pl = PLAN[Math.min(round, PLAN.length - 1)];
  for (let tries = 0; tries < 600; tries++) {
    const pool = Array.from({ length: pl.max }, (_, i) => i + 1);
    const tiles = rng.shuffle(pool).slice(0, TILES).sort((a, b) => a - b);
    const fixL = 1 + Math.floor(rng.next() * 8);
    let fixR = pl.fix === 'both' ? 1 + Math.floor(rng.next() * 8) : 0;
    if (fixR === fixL) fixR = (fixR % 8) + 1;
    const idx = rng.shuffle(tiles.map((_, i) => i));
    const sc: Scale = { tiles, fixL, fixR, minUse: pl.minUse, mustL: idx.slice(0, pl.mustL), mustR: idx.slice(pl.mustL, pl.mustL + pl.mustR) };
    const n = solutions(sc, pl.sol[1] + 1).length;
    if (n >= pl.sol[0] && n <= pl.sol[1]) return sc;
  }
  // 見つからない時は、必ず解ける簡単な問題
  return { tiles: [1, 2, 3, 4, 5, 6, 7, 8], fixL: 3, fixR: 0, minUse: 1, mustL: [], mustR: [] };
}

export const pointsFor = (ok: boolean, ms: number) => (ok ? OK_PTS + Math.round((TIME_PTS * Math.max(0, ROUND_MS - ms)) / ROUND_MS) : 0);

export type P08Move = { t: 'answer'; place: number[]; ms: number } | { t: 'ready' };
export interface P08Result { place: number[]; ok: boolean; ms: number; points: number }

export interface P08State {
  players: CharId[];
  round: number;
  phase: 'solve' | 'break' | 'done';
  scales: Scale[];
  /** 各ラウンドの正解の一例（振り返り用） */
  examples: (number[] | null)[];
  current: Record<string, { place: number[]; ms: number } | undefined>;
  results: Record<string, P08Result[]>;
  ready: Record<string, boolean>;
}

export interface P08View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: P08State['phase'];
  scale: Scale;
  submitted: boolean;
  results: Record<string, P08Result[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
  /** 直前のラウンドの問題と、正解の一例（振り返り用） */
  lastScale: Scale | null;
  lastExample: number[] | null;
}

const totalOf = (r: P08Result[]) => r.reduce((n, x) => n + x.points, 0);

/** CPU：見えている問題を全部調べて正解を見つける。かかる時間は、正解の少なさと能力で決まる */
function p08Ai(v: P08View, ctx: AiCtx): P08Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const lg = skill(ctx.stats.logic);
  const sols = solutions(v.scale, 200);
  if (!sols.length) return { t: 'answer', place: v.scale.tiles.map(() => 0), ms: ROUND_MS };
  // 正解が少ないほど、また使う枚数が多いほど、見つけるのに時間がかかる
  const hard = Math.min(0.6, 1 / Math.sqrt(sols.length));
  const sec = (8 + (1 - lg) * 12 + hard * (56 + (1 - lg) * 80) + v.scale.minUse * 2.4) * Math.max(0.6, 1 + ctx.rng.gauss(0, 0.3)) * (1 + ctx.noise * 0.3);
  if (sec * 1000 > ROUND_MS - 500) {
    // 時間切れ：載せかけの配置（つり合っていない）
    const place = [...sols[0]];
    const used = place.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    place[used[used.length - 1]] = 0;
    return { t: 'answer', place, ms: ROUND_MS };
  }
  return { t: 'answer', place: sols[Math.floor(ctx.rng.next() * sols.length)], ms: Math.round(sec * 1000) };
}

export const P08: MatchEngine<P08State, P08Move, P08View> = {
  id: 'p08',
  name: '数字の天秤',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '数字タイルを左右の皿に載せて、合計を同じにする。ラウンドごとに追加の条件がある。',
  rules: [
    `全 ${ROUNDS} ラウンド。全員が同じ問題を同時に解きます。`,
    '数字タイルが 8 枚あります。皿には、最初から固定の重りが載っています（動かせません）。',
    'タイルを左右の皿に載せて、左右の合計（固定の重りを含む）を同じにします。皿 1 つに載せられるのは 4 枚までです。使わないタイルがあっても構いません。',
    'ラウンドごとに追加の条件があります（何枚以上使う、このタイルは左に載せる、など）。条件はいつも画面に出ています。',
    `制限時間は 90 秒。正解で ${OK_PTS} 点、残り時間に応じて最大 ${TIME_PTS} 点。つり合っていない時、条件に合わない時は 0 点です。答えが何通りかある時は、どれでも正解です。`,
    '3 ラウンドの後に 20 秒の休憩があり、話せます。ピースで買える補助はありません。',
    '合計点の低い人が脱落します。同点は、正解の数、正解にかかった時間の合計の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点で載っているタイルで判定します。',
  ],
  init(players, rng) {
    const scales = Array.from({ length: ROUNDS }, (_, r) => makeScale(rng, r));
    return {
      players: [...players], round: 0, phase: 'solve',
      scales, examples: scales.map((sc) => solutions(sc, 1)[0] ?? null),
      current: {}, results: Object.fromEntries(players.map((p) => [p, []])), ready: Object.fromEntries(players.map((p) => [p, false])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `休憩（次はラウンド ${s.round + 1}）`, time: BREAK_MS, negotiation: true };
    return { label: `ラウンド ${s.round + 1} / ${ROUNDS}`, time: ROUND_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.current[p] || m.t !== 'answer') return false;
    if (!Array.isArray(m.place) || m.place.length !== TILES || m.place.some((x) => x !== 0 && x !== 1 && x !== 2)) return false;
    return typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= ROUND_MS + 1000;
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'answer', place: new Array<number>(TILES).fill(0), ms: ROUND_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p08: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) s.phase = 'solve';
      return;
    }
    s.current[p] = { place: [...m.place], ms: Math.min(ROUND_MS, m.ms) };
    if (!s.players.every((x) => s.current[x])) return;
    const sc = s.scales[s.round];
    for (const x of s.players) {
      const cur = s.current[x]!;
      const ok = judge(sc, cur.place).ok;
      s.results[x].push({ place: cur.place, ok, ms: ok ? cur.ms : ROUND_MS, points: pointsFor(ok, cur.ms) });
    }
    s.current = {};
    if (s.round >= ROUNDS - 1) { s.phase = 'done'; return; }
    s.round += 1;
    if (s.round === 3) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
    }
  },
  view(s, p) {
    const me = p === 'spectator' ? null : p;
    const n = s.results[s.players[0]].length;
    const last = n > 0 ? s.scales[n - 1] : null;
    return {
      self: p, players: s.players, round: s.round, rounds: ROUNDS, phase: s.phase,
      scale: s.scales[Math.min(s.round, ROUNDS - 1)],
      submitted: !!me && !!s.current[me],
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      ready: { ...s.ready },
      lastScale: last,
      lastExample: last ? s.examples[n - 1] : null,
    };
  },
  ai: p08Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const ok = (p: CharId) => s.results[p].filter((r) => r.ok).length;
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + r.ms, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 + ok(p), (p) => -time(p));
  },
};

/** 説明と練習に使う問題（本番とは別） */
export const P08_PRACTICE: Scale = { tiles: [1, 2, 3, 4, 5, 6, 7, 9], fixL: 5, fixR: 0, minUse: 2, mustL: [0], mustR: [] };
