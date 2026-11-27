/**
 * P09 鏡の決闘（v11、2 人）
 * 全 6 ラウンド（5×5 から 7×7 へ）。盤面に対称の軸があり、片側に形が表示される。反対側に、軸で折り返した形（鏡に映した形）を作る。
 * 形は、四角の札と、向きのある矢印の札でできている。矢印は、向きも鏡に映す。斜めの軸は後半の 2 ラウンドだけ。
 * 全員が同じ問題を同時に解く。制限 90 秒。完全に一致で 20 点 ＋ 残り時間に応じて最大 5 点。
 * 一致しない時は、合っているマスの割合 × 8 点（余分に置いたマス 1 つにつき −1、最低 0）。
 * 3 ラウンドの後に 20 秒の休憩。1 ピースで、正しい札 1 マスを示す（この競技で 1 回）。順位は合計点、完全に一致した数、かかった時間の合計の順。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 6;
export const ROUND_MS = 90_000;
export const BREAK_MS = 20_000;
export const OK_PTS = 20;
export const TIME_PTS = 5;
export const PART_PTS = 8;
export const AID_COST = 1;

/** 札：b は四角、u r d l は矢印の向き */
export type Tile = 'b' | 'u' | 'r' | 'd' | 'l';
/** 軸：v は縦（左右に映す）、h は横（上下に映す）、d は左上から右下への斜め、a は右上から左下への斜め */
export type Axis = 'v' | 'h' | 'd' | 'a';
export interface Mirror { n: number; axis: Axis; src: Record<number, Tile> }

const xy = (n: number, c: number): [number, number] => [c % n, Math.floor(c / n)];

/** マスの種類：src は形が表示される側、dst は自分が作る側、axis は軸の上 */
export function sideOf(n: number, axis: Axis, c: number): 'src' | 'dst' | 'axis' {
  const [x, y] = xy(n, c);
  const v = axis === 'v' ? x * 2 - (n - 1) : axis === 'h' ? y * 2 - (n - 1) : axis === 'd' ? x - y : x + y - (n - 1);
  return v < 0 ? 'src' : v > 0 ? 'dst' : 'axis';
}

/** 軸で折り返した先のマス */
export function mirrorCell(n: number, axis: Axis, c: number): number {
  const [x, y] = xy(n, c);
  const [a, b] = axis === 'v' ? [n - 1 - x, y] : axis === 'h' ? [x, n - 1 - y] : axis === 'd' ? [y, x] : [n - 1 - y, n - 1 - x];
  return b * n + a;
}

const DIR_MAP: Record<Axis, Record<Tile, Tile>> = {
  v: { b: 'b', u: 'u', d: 'd', l: 'r', r: 'l' },
  h: { b: 'b', u: 'd', d: 'u', l: 'l', r: 'r' },
  d: { b: 'b', u: 'l', l: 'u', d: 'r', r: 'd' },
  a: { b: 'b', u: 'r', r: 'u', d: 'l', l: 'd' },
};
export const mirrorTile = (axis: Axis, t: Tile): Tile => DIR_MAP[axis][t];

/** 正解（作る側のマス → 札） */
export function expected(m: Mirror): Record<number, Tile> {
  const out: Record<number, Tile> = {};
  for (const [c, t] of Object.entries(m.src)) out[mirrorCell(m.n, m.axis, Number(c))] = mirrorTile(m.axis, t);
  return out;
}

export interface Mark { perfect: boolean; correct: number; total: number; extra: number; points: number }

export function scoreOf(m: Mirror, grid: Record<number, Tile>, ms: number): Mark {
  const exp = expected(m);
  const total = Object.keys(exp).length;
  let correct = 0;
  let extra = 0;
  for (const [c, t] of Object.entries(exp)) if (grid[Number(c)] === t) correct++;
  for (const c of Object.keys(grid)) if (!(c in exp)) extra++;
  const perfect = correct === total && extra === 0 && Object.keys(grid).length === total;
  const points = perfect ? OK_PTS + Math.round((TIME_PTS * Math.max(0, ROUND_MS - ms)) / ROUND_MS) : Math.max(0, Math.floor((correct / total) * PART_PTS) - extra);
  return { perfect, correct, total, extra, points };
}

/** ラウンドごとの大きさ、軸、札の数、矢印の割合 */
const PLAN: { n: number; axis: Axis; cells: number; arrows: number }[] = [
  { n: 5, axis: 'v', cells: 5, arrows: 0 },
  { n: 5, axis: 'h', cells: 6, arrows: 0.35 },
  { n: 6, axis: 'v', cells: 8, arrows: 0.5 },
  { n: 6, axis: 'h', cells: 9, arrows: 0.6 },
  { n: 7, axis: 'd', cells: 9, arrows: 0.45 },
  { n: 7, axis: 'a', cells: 11, arrows: 0.55 },
];
const ARROWS: Tile[] = ['u', 'r', 'd', 'l'];

export function makeMirror(rng: Rng, round: number): Mirror {
  const pl = PLAN[Math.min(round, PLAN.length - 1)];
  const cells = Array.from({ length: pl.n * pl.n }, (_, c) => c).filter((c) => sideOf(pl.n, pl.axis, c) === 'src');
  const pick = rng.shuffle(cells).slice(0, pl.cells);
  const src: Record<number, Tile> = {};
  for (const c of pick) src[c] = rng.next() < pl.arrows ? ARROWS[Math.floor(rng.next() * 4)] : 'b';
  // 矢印のあるラウンドは、少なくとも 2 個は矢印にする（向きを映す所が問題の中心になる）
  if (pl.arrows > 0) { let k = 0; for (const c of pick) { if (Object.values(src).filter((t) => t !== 'b').length >= 2) break; if (src[c] === 'b') { src[c] = ARROWS[(k++ + round) % 4]; } } }
  return { n: pl.n, axis: pl.axis, src };
}

export type P09Move = { t: 'answer'; grid: Record<number, Tile>; ms: number } | { t: 'aid' } | { t: 'ready' };
export interface P09Result { grid: Record<number, Tile>; perfect: boolean; correct: number; total: number; extra: number; ms: number; points: number }

export interface P09State {
  players: CharId[];
  round: number;
  phase: 'solve' | 'break' | 'done';
  mirrors: Mirror[];
  current: Record<string, { grid: Record<number, Tile>; ms: number } | undefined>;
  results: Record<string, P09Result[]>;
  aidUsed: Record<string, boolean>;
  ready: Record<string, boolean>;
}

export interface P09View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: P09State['phase'];
  mirror: Mirror;
  submitted: boolean;
  aidUsed: boolean;
  results: Record<string, P09Result[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
  lastMirror: Mirror | null;
}

const totalOf = (r: P09Result[]) => r.reduce((n, x) => n + x.points, 0);

/** 補助：今の盤面で、まだ正しくないマスを 1 つ示す（正しい札つき）。全部合っていれば null */
export function hintFor(m: Mirror, grid: Record<number, Tile>): { cell: number; tile: Tile | null } | null {
  const exp = expected(m);
  for (const [c, t] of Object.entries(exp)) if (grid[Number(c)] !== t) return { cell: Number(c), tile: t };
  for (const c of Object.keys(grid)) if (!(c in exp)) return { cell: Number(c), tile: null };
  return null;
}

/** CPU：見えている形を 1 マスずつ映す。観察の能力が低いと、位置や向きを間違える。斜めの軸と矢印は間違えやすく、時間もかかる */
function p09Ai(v: P09View, ctx: AiCtx): P09Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const ob = skill(ctx.stats.observation);
  const lg = skill(ctx.stats.logic);
  const m = v.mirror;
  const diag = m.axis === 'd' || m.axis === 'a';
  const exp = expected(m);
  const grid: Record<number, Tile> = {};
  let sec = 5 + (1 - ob) * 5;
  for (const [cs, t] of Object.entries(exp)) {
    const c = Number(cs);
    const arrow = t !== 'b';
    sec += (1.8 + (1 - ob) * 1.8 + (arrow ? 1.0 + (1 - lg) * 1.2 : 0)) * (diag ? 1.25 : 1);
    const pErr = (0.006 + (1 - ob) * 0.04 + ctx.noise * 0.02) * (diag ? 1.7 : 1) * (arrow ? 1.5 : 1);
    if (ctx.rng.next() < pErr) {
      // 間違い：矢印は向きを映し忘れる。四角は 1 マスずれる
      if (arrow) grid[c] = (Object.entries(m.src).find(([s]) => mirrorCell(m.n, m.axis, Number(s)) === c)?.[1] ?? t) === t ? ARROWS[(ARROWS.indexOf(t) + 1) % 4] : (Object.entries(m.src).find(([s]) => mirrorCell(m.n, m.axis, Number(s)) === c)![1]);
      else {
        const alt = [c - 1, c + 1, c - m.n, c + m.n].filter((x) => x >= 0 && x < m.n * m.n && sideOf(m.n, m.axis, x) === 'dst' && !(x in exp) && !(x in grid));
        if (alt.length) grid[alt[Math.floor(ctx.rng.next() * alt.length)]] = t;
      }
      continue;
    }
    grid[c] = t;
  }
  sec *= Math.max(0.65, 1 + ctx.rng.gauss(0, 0.22));
  if (sec * 1000 > ROUND_MS - 500) {
    // 時間切れ：置けた所まで
    const keep = Math.floor((Object.keys(grid).length * (ROUND_MS / 1000)) / sec);
    const part: Record<number, Tile> = {};
    Object.entries(grid).slice(0, keep).forEach(([c, t]) => { part[Number(c)] = t; });
    return { t: 'answer', grid: part, ms: ROUND_MS };
  }
  return { t: 'answer', grid, ms: Math.round(sec * 1000) };
}

const validGrid = (m: Mirror, g: unknown): g is Record<number, Tile> => {
  if (!g || typeof g !== 'object') return false;
  for (const [c, t] of Object.entries(g as Record<string, unknown>)) {
    const k = Number(c);
    if (!Number.isInteger(k) || k < 0 || k >= m.n * m.n || sideOf(m.n, m.axis, k) !== 'dst') return false;
    if (t !== 'b' && t !== 'u' && t !== 'r' && t !== 'd' && t !== 'l') return false;
  }
  return true;
};

export const P09: MatchEngine<P09State, P09Move, P09View> = {
  id: 'p09',
  name: '鏡の決闘',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '軸の片側に表示された形を、反対側に鏡に映した形で作る。矢印は向きも映す。',
  rules: [
    `全 ${ROUNDS} ラウンド（5×5 から 7×7 へ大きくなります）。全員が同じ問題を同時に解きます。`,
    '盤面に対称の軸（金色の線）があります。片側に表示された形を、軸で折り返した形（鏡に映した形）で、反対側に作ります。',
    '札は、四角と矢印の 2 種類。矢印は、向きも鏡に映します（縦の軸なら、右向きは左向きになります）。',
    '札を選んでからマスをタップすると置けます。置いた矢印をタップすると、向きが右回りに回ります。消しゴムで消せます。',
    '軸は、縦、横、後半の 2 ラウンドは斜めです。',
    `制限時間は 90 秒。完全に一致で ${OK_PTS} 点、残り時間に応じて最大 ${TIME_PTS} 点。一致しない時は、合っているマスの割合 × ${PART_PTS} 点（余分に置いたマス 1 つにつき −1、最低 0）。`,
    '3 ラウンドの後に 20 秒の休憩があり、話せます。',
    `ピース ${AID_COST} 個で、正しい札 1 マスを示します（この競技で 1 回）。`,
    '合計点の低い人が脱落します。同点は、完全に一致した数、かかった時間の合計の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点の盤面で採点します。',
  ],
  init(players, rng) {
    return {
      players: [...players], round: 0, phase: 'solve',
      mirrors: Array.from({ length: ROUNDS }, (_, r) => makeMirror(rng, r)),
      current: {}, results: Object.fromEntries(players.map((p) => [p, []])),
      aidUsed: Object.fromEntries(players.map((p) => [p, false])), ready: Object.fromEntries(players.map((p) => [p, false])),
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
    if (s.current[p]) return false;
    if (m.t === 'aid') return !s.aidUsed[p];
    if (m.t !== 'answer' || !validGrid(s.mirrors[s.round], m.grid)) return false;
    return typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= ROUND_MS + 1000;
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'answer', grid: {}, ms: ROUND_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p09: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'aid') { s.aidUsed[p] = true; return; }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) s.phase = 'solve';
      return;
    }
    s.current[p] = { grid: { ...m.grid }, ms: Math.min(ROUND_MS, m.ms) };
    if (!s.players.every((x) => s.current[x])) return;
    const mir = s.mirrors[s.round];
    for (const x of s.players) {
      const cur = s.current[x]!;
      const mk = scoreOf(mir, cur.grid, cur.ms);
      s.results[x].push({ grid: cur.grid, perfect: mk.perfect, correct: mk.correct, total: mk.total, extra: mk.extra, ms: mk.perfect ? cur.ms : ROUND_MS, points: mk.points });
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
    return {
      self: p, players: s.players, round: s.round, rounds: ROUNDS, phase: s.phase,
      mirror: s.mirrors[Math.min(s.round, ROUNDS - 1)],
      submitted: !!me && !!s.current[me], aidUsed: !!me && s.aidUsed[me],
      results: s.results, totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      ready: { ...s.ready }, lastMirror: n > 0 ? s.mirrors[n - 1] : null,
    };
  },
  ai: p09Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const ok = (p: CharId) => s.results[p].filter((r) => r.perfect).length;
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + r.ms, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 + ok(p), (p) => -time(p));
  },
};

/** 説明と練習に使う問題（本番とは別） */
export const P09_PRACTICE: Mirror = { n: 5, axis: 'v', src: { 0: 'b', 6: 'r', 11: 'b', 16: 'b' } };
