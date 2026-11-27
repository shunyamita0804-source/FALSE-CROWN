/**
 * H05 時の牢獄（裏ゲーム、1 人、挑戦は 1 回だけ）
 * 3 つの仕掛けを続けて解く：数の列、3×3 のスライド板、記号の並べ替え。合わせて 5 分。間違えても、時間のあるかぎり入れ直せる。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { H05_ORDER, H05_SEQ } from '../story/hiddendata';
import { sortGroups, type MatchEngine } from './types';

export const H05_MS = 300_000;
export const H05_PUZZLES = 3;
const GOAL = [1, 2, 3, 4, 5, 6, 7, 8, 0];

export type H05Move = { t: 'num'; v: number } | { t: 'slide'; pos: number } | { t: 'order'; seq: string[] } | { t: 'giveup' };
export interface H05State { players: CharId[]; idx: number; slide: number[]; slideMoves: number; misses: number; phase: 'play' | 'done'; stage: string }
export interface H05View {
  self: CharId | 'spectator';
  idx: number;
  seq: { prompt: string; seq: number[] };
  slide: number[];
  slideMoves: number;
  order: { glyphs: string[]; clues: string[] };
  misses: number;
  phase: H05State['phase'];
}

/** 空きマス（0）と隣り合う位置 */
export function slidable(tiles: number[]): number[] {
  const b = tiles.indexOf(0);
  const bx = b % 3;
  const by = Math.floor(b / 3);
  return tiles.map((_, i) => i).filter((i) => Math.abs((i % 3) - bx) + Math.abs(Math.floor(i / 3) - by) === 1);
}
export const slideTo = (tiles: number[], pos: number): number[] => { const t = [...tiles]; const b = t.indexOf(0); [t[b], t[pos]] = [t[pos], t[b]]; return t; };
export const slideSolved = (tiles: number[]) => tiles.every((v, i) => v === GOAL[i]);

/** 完成の形から、決まりどおりの動かし方で崩して作る（必ず解ける） */
export function makeSlide(rng: Rng, steps = 16): number[] {
  let t = [...GOAL];
  let prev = -1;
  for (let i = 0; i < steps; i++) {
    const b = t.indexOf(0);
    const opts = slidable(t).filter((p) => p !== prev);
    const pos = opts[rng.int(0, opts.length - 1)];
    t = slideTo(t, pos);
    prev = b;
  }
  if (slideSolved(t)) t = slideTo(t, slidable(t)[0]);
  return t;
}

/** スライド板の、いちばん短い動かし方 */
export function solveSlide(tiles: number[]): number[] {
  const key = (t: number[]) => t.join('');
  const seen = new Map<string, { prev: string; pos: number } | null>([[key(tiles), null]]);
  const queue = [tiles];
  while (queue.length) {
    const cur = queue.shift()!;
    if (slideSolved(cur)) {
      const out: number[] = [];
      let k = key(cur);
      for (let e = seen.get(k); e; e = seen.get(k)) { out.unshift(e.pos); k = e.prev; }
      return out;
    }
    for (const pos of slidable(cur)) {
      const nx = slideTo(cur, pos);
      if (seen.has(key(nx))) continue;
      seen.set(key(nx), { prev: key(cur), pos });
      queue.push(nx);
    }
  }
  return [];
}

/** 並べ替えの条件を満たすか（B は A のすぐ後、D は先頭、C は B より後） */
export function orderOk(seq: string[]): boolean {
  if (seq.length !== 4 || new Set(seq).size !== 4 || !seq.every((g) => H05_ORDER.glyphs.includes(g))) return false;
  const at = (g: string) => seq.indexOf(g);
  return at('B') === at('A') + 1 && at('D') === 0 && at('C') > at('B');
}

function ai(v: H05View): H05Move {
  if (v.idx === 0) return { t: 'num', v: H05_SEQ.answer };
  if (v.idx === 1) { const sol = solveSlide(v.slide); return sol.length ? { t: 'slide', pos: sol[0] } : { t: 'giveup' }; }
  return { t: 'order', seq: H05_ORDER.answer };
}

export const H05: MatchEngine<H05State, H05Move, H05View> = {
  id: 'h05',
  name: '時の牢獄',
  kind: 'hidden',
  minPlayers: 1,
  maxPlayers: 1,
  summary: '数の列、スライド板、記号の並べ替え。3 つの仕掛けを 5 分で続けて解く。',
  rules: [
    '3 つの仕掛けを、続けて解きます。合わせて 5 分です。',
    '1 つ目：数の列の、次の数を入れます。',
    '2 つ目：3×3 のスライド板。空きマスの隣の板をタップすると、空きマスへ動きます。1 から 8 を順に並べます。',
    '3 つ目：4 つの記号を、条件に合う順に並べます。',
    '間違えても、時間のあるかぎり入れ直せます。',
    'この仕掛けに挑めるのは 1 回だけです。時間切れは失敗で、やり直せません。',
  ],
  init(players, rng: Rng) {
    return { players: [...players], idx: 0, slide: makeSlide(rng), slideMoves: 0, misses: 0, phase: 'play', stage: '0' };
  },
  pending(s) {
    return s.phase === 'done' ? [] : [...s.players];
  },
  stage(s) {
    // 3 つの仕掛けで時間を通しで数えるので、段階の名前は変えない
    return s.phase === 'done' ? { label: '終了' } : { label: '3 つの仕掛け', time: H05_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase !== 'play' || !s.players.includes(p)) return false;
    if (m.t === 'giveup') return true;
    if (s.idx === 0) return m.t === 'num' && Number.isInteger(m.v) && m.v >= 0 && m.v < 1000;
    if (s.idx === 1) return m.t === 'slide' && slidable(s.slide).includes(m.pos);
    return m.t === 'order' && Array.isArray(m.seq) && m.seq.length === 4;
  },
  defaultMove() {
    return { t: 'giveup' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error('h05: illegal move');
    if (m.t === 'giveup') { s.phase = 'done'; return; }
    let ok = false;
    if (m.t === 'num') ok = m.v === H05_SEQ.answer;
    else if (m.t === 'slide') { s.slide = slideTo(s.slide, m.pos); s.slideMoves += 1; ok = slideSolved(s.slide); if (!ok) return; } else ok = orderOk(m.seq);
    if (!ok) { s.misses += 1; return; }
    s.idx += 1;
    if (s.idx >= H05_PUZZLES) s.phase = 'done';
  },
  view(s, p) {
    return { self: p, idx: s.idx, seq: { prompt: H05_SEQ.prompt, seq: H05_SEQ.seq }, slide: [...s.slide], slideMoves: s.slideMoves, order: { glyphs: H05_ORDER.glyphs, clues: H05_ORDER.clues }, misses: s.misses, phase: s.phase };
  },
  ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, s.idx]));
  },
  ranking(s) {
    return sortGroups(s.players, () => s.idx);
  },
};
