/**
 * S06 ミニジグソー（サブゲーム、1〜2 人）
 * 1 枚の絵を 3×3 か 4×4 のタイルに分けて、ばらばらに並べる。タイルを入れ替えて元の絵に戻す。
 * 入れ替え方は問題ごとに決まっている（隣どうしだけ、または好きな 2 枚）。2 人の時は同じ並びから始め、早く完成した方が勝ち。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const S06_IMAGES = 6;
export const limitOf = (n: number) => (n === 3 ? 120_000 : 180_000);

export type S06Mode = 'adj' | 'any';
export type S06Move = { t: 'solve'; swaps: [number, number][]; ms: number } | { t: 'giveup' };

export interface S06State {
  players: CharId[];
  n: number;
  mode: S06Mode;
  image: number;
  /** perm[位置] = そこにあるタイルの番号（番号 = 正しい位置） */
  perm: number[];
  /** 完成までの時間（ミリ秒）。null は未完成のまま終了 */
  results: (number | null | undefined)[];
  swapCount: number[];
  phase: 'play' | 'done';
  stage: string;
}

export interface S06View {
  self: CharId | 'spectator';
  me: number;
  players: CharId[];
  n: number;
  mode: S06Mode;
  image: number;
  perm: number[];
  limit: number;
  submitted: boolean;
  results: (number | null | undefined)[];
  phase: S06State['phase'];
}

export const adjacent = (n: number, a: number, b: number) => {
  const dx = Math.abs((a % n) - (b % n));
  const dy = Math.abs(Math.floor(a / n) - Math.floor(b / n));
  return dx + dy === 1;
};

/** 入れ替えの列を当てはめた結果（決まりに合わない入れ替えがあれば null） */
export function applySwaps(n: number, mode: S06Mode, perm: number[], swaps: [number, number][]): number[] | null {
  const p = [...perm];
  for (const sw of swaps) {
    if (!Array.isArray(sw) || sw.length !== 2) return null;
    const [a, b] = sw;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= p.length || b >= p.length) return null;
    if (mode === 'adj' && !adjacent(n, a, b)) return null;
    [p[a], p[b]] = [p[b], p[a]];
  }
  return p;
}

export const solved = (perm: number[]) => perm.every((v, i) => v === i);

/** 完成までの入れ替えの列（必ず見つかる。最短とは限らない） */
export function solve(n: number, mode: S06Mode, perm: number[]): [number, number][] {
  const p = [...perm];
  const out: [number, number][] = [];
  const sw = (a: number, b: number) => { [p[a], p[b]] = [p[b], p[a]]; out.push([a, b]); };
  for (let pos = 0; pos < p.length; pos++) {
    let at = p.indexOf(pos);
    if (at === pos) continue;
    if (mode === 'any') { sw(at, pos); continue; }
    // 隣どうしだけ：先に横へ、次に上へ動かす（すでに置いたタイルは通らない）
    const tx = pos % n;
    while (at % n !== tx) { const nx = at + (at % n < tx ? 1 : -1); sw(at, nx); at = nx; }
    while (at !== pos) { sw(at, at - n); at -= n; }
  }
  return out;
}

function ai(v: S06View, ctx: AiCtx): S06Move {
  const swaps = solve(v.n, v.mode, v.perm);
  const ob = skill(ctx.stats.observation);
  const lg = skill(ctx.stats.logic);
  // 絵を見比べて 1 枚ずつ場所を決める時間。観察が高いほど速い
  const per = (v.mode === 'adj' ? 2.6 : 5.2) - ob * 1.2 - lg * 0.5;
  const sec = 6 + swaps.length * per * (1 + Math.abs(ctx.rng.gauss(0, 0.18 + ctx.noise * 0.3)));
  const ms = Math.round(sec * 1000);
  if (ms >= v.limit) return { t: 'giveup' };
  return { t: 'solve', swaps, ms };
}

export const S06: MatchEngine<S06State, S06Move, S06View> = {
  id: 's06',
  name: 'ミニジグソー',
  kind: 'sub',
  minPlayers: 1,
  maxPlayers: 2,
  summary: 'ばらばらのタイルを入れ替えて、元の絵に戻す。2 人の時は早く完成した方が勝ち。',
  rules: [
    '1 枚の絵を 3×3 か 4×4 のタイルに分けて、ばらばらに並べます。',
    'タイルを 2 枚選ぶと、場所が入れ替わります。元の絵に戻せば完成です。',
    '入れ替え方は問題ごとに決まっています。「隣どうしだけ」か「好きな 2 枚」のどちらかで、画面に出ます。',
    '2 人で遊ぶ時は、同じ並びから同時に始めます。早く完成した方が勝ちです。',
    '制限時間は 3×3 が 2 分、4×4 が 3 分。時間切れは未完成です。',
  ],
  init(players, rng: Rng, opts) {
    const n = Number(opts?.n ?? (rng.chance(0.5) ? 3 : 4));
    const mode = (opts?.mode as S06Mode | undefined) ?? (rng.chance(0.5) ? 'adj' : 'any');
    const image = Number(opts?.image ?? rng.int(0, S06_IMAGES - 1));
    let perm = Array.from({ length: n * n }, (_, i) => i);
    // 正しい場所に残るタイルが 2 枚以下になるまで混ぜる
    for (let i = 0; i < 50; i++) {
      perm = rng.shuffle(perm);
      if (perm.filter((v, k) => v === k).length <= 2 && !solved(perm)) break;
    }
    if (solved(perm)) [perm[0], perm[1]] = [perm[1], perm[0]];
    return { players: [...players], n, mode, image, perm, results: players.map(() => undefined), swapCount: players.map(() => 0), phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : s.players.filter((_, i) => s.results[i] === undefined);
  },
  stage(s) {
    return s.phase === 'done' ? { label: '終了' } : { label: `${s.n}×${s.n}`, time: limitOf(s.n) };
  },
  validate(s, p, m) {
    const i = s.players.indexOf(p);
    if (!m || i < 0 || s.phase !== 'play' || s.results[i] !== undefined) return false;
    if (m.t === 'giveup') return true;
    if (m.t !== 'solve' || !Array.isArray(m.swaps) || m.swaps.length > 600 || typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0 || m.ms > limitOf(s.n) + 1000) return false;
    const r = applySwaps(s.n, s.mode, s.perm, m.swaps);
    return !!r && solved(r);
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('s06: illegal move');
    const i = s.players.indexOf(p);
    if (m.t === 'solve') { s.results[i] = Math.min(limitOf(s.n), Math.round(m.ms)); s.swapCount[i] = m.swaps.length; } else s.results[i] = null;
    if (s.results.every((r) => r !== undefined)) s.phase = 'done';
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    const mine = me < 0 || s.results[me] !== undefined;
    return { self: p, me, players: s.players, n: s.n, mode: s.mode, image: s.image, perm: [...s.perm], limit: limitOf(s.n), submitted: me >= 0 && s.results[me] !== undefined, results: mine ? [...s.results] : s.results.map((r, i) => (i === me ? r : undefined)), phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, typeof s.results[i] === 'number' ? Math.round((limitOf(s.n) - (s.results[i] as number)) / 1000) + 1 : 0]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => { const r = s.results[s.players.indexOf(p)]; return typeof r === 'number' ? limitOf(s.n) + 1 - r : 0; });
  },
};
