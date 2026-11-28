/**
 * P04 消えた図形（v11、3 人）
 * 10 ラウンド。5×5 の盤面に、形と向きのある図柄が並ぶ。8 秒見た後、少しだけ変わった盤面に切り替わる。
 * 変わったマス（3〜5 個。数は公開）を選ぶ。制限 25 秒。変化は「入れ替え」「回転」「追加」「消去」の 4 種類。
 * 当たったマス 1 つ 3 点、間違って選んだマス 1 つ −1 点（そのラウンドの最低は 0 点）、すべて当てて間違いなしなら +3 点。
 * 順位は合計点、当てたマスの総数、当てたラウンドの解答時間の合計の順。2 ラウンドごとに 15 秒の休憩。
 * 1 ピースで、最初の表示を 3 秒延ばせる（この競技で 1 回）。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 10;
export const SIZE = 5;
export const SHOW_MS = 8_000;
export const ANSWER_MS = 25_000;
export const PREP_MS = 15_000;
export const BOOST_MS = 3_000;
export const BOOST_COST = 1;
export const HIT = 3;
export const MISS = 1;
export const PERFECT = 3;

export const SHAPES = ['arrow', 'drop', 'half', 'el', 'tee'] as const;
/** 図柄：形と向き（0〜3、時計回りに 90 度ずつ）。空のマスは null */
export type Fig = string | null;
export const fig = (shape: string, rot: number): string => `${shape}:${rot}`;

/** ラウンドごとの図柄の数と、変わるマスの数 */
export const ROUND_SPECS: { n: number; k: number }[] = [
  { n: 8, k: 3 }, { n: 8, k: 3 }, { n: 9, k: 3 }, { n: 9, k: 4 }, { n: 10, k: 4 },
  { n: 10, k: 4 }, { n: 11, k: 4 }, { n: 11, k: 5 }, { n: 12, k: 5 }, { n: 12, k: 5 },
];

export interface DiffSet {
  a: Fig[];
  b: Fig[];
  /** 変わったマスの数（公開） */
  k: number;
}

export const changedCells = (set: DiffSet): number[] => set.a.map((_, i) => i).filter((i) => set.a[i] !== set.b[i]);

/** 変化を作る。入れ替え（2 マス）、回転、追加、消去を組み合わせて、変わったマスがちょうど k 個になるようにする */
export function makeSet(rng: Rng, spec: { n: number; k: number }): DiffSet {
  const total = SIZE * SIZE;
  for (let attempt = 0; attempt < 200; attempt++) {
    const a: Fig[] = new Array<Fig>(total).fill(null);
    for (const c of rng.shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, spec.n)) a[c] = fig(rng.pick([...SHAPES]), rng.int(0, 3));
    const b = [...a];
    const touched = new Set<number>();
    const free = (want: 'item' | 'empty') => rng.shuffle(Array.from({ length: total }, (_, i) => i).filter((i) => !touched.has(i) && (want === 'item' ? a[i] !== null : a[i] === null)));
    const kinds = new Set<string>();
    for (let guard = 0; guard < 60 && touched.size < spec.k; guard++) {
      const left = spec.k - touched.size;
      const op = rng.pick(left >= 2 ? ['swap', 'rot', 'add', 'del'] : ['rot', 'add', 'del']);
      if (op === 'swap') {
        const items = free('item');
        const x = items[0];
        const y = items.find((i) => i !== x && a[i] !== a[x]);
        if (x === undefined || y === undefined) continue;
        b[x] = a[y];
        b[y] = a[x];
        touched.add(x).add(y);
      } else if (op === 'rot') {
        const x = free('item')[0];
        if (x === undefined) continue;
        const [shape, rot] = a[x]!.split(':');
        b[x] = fig(shape, (Number(rot) + rng.int(1, 3)) % 4);
        touched.add(x);
      } else if (op === 'add') {
        const x = free('empty')[0];
        if (x === undefined) continue;
        b[x] = fig(rng.pick([...SHAPES]), rng.int(0, 3));
        touched.add(x);
      } else {
        const x = free('item')[0];
        if (x === undefined) continue;
        b[x] = null;
        touched.add(x);
      }
      kinds.add(op);
    }
    const set: DiffSet = { a, b, k: spec.k };
    // 1 種類の変化だけの問題は単調なので使わない
    if (changedCells(set).length === spec.k && kinds.size >= 2) return set;
  }
  throw new Error('p04: 問題を作れませんでした');
}

export function scoreAnswer(set: DiffSet, cells: number[]): { hits: number; misses: number; points: number; perfect: boolean } {
  const changed = new Set(changedCells(set));
  const picked = [...new Set(cells)];
  const hits = picked.filter((c) => changed.has(c)).length;
  const misses = picked.length - hits;
  const perfect = hits === changed.size && misses === 0;
  return { hits, misses, points: Math.max(0, hits * HIT - misses * MISS) + (perfect ? PERFECT : 0), perfect };
}

export type P04Move = { t: 'boost' } | { t: 'ready' } | { t: 'answer'; cells: number[]; ms: number };

export interface P04Result { cells: number[]; hits: number; misses: number; points: number; perfect: boolean; ms: number }

export interface P04State {
  players: CharId[];
  round: number;
  phase: 'prep' | 'quiz' | 'done';
  sets: DiffSet[];
  ready: Record<string, boolean>;
  /** 表示延長：使ったラウンド（未使用は -1） */
  boost: Record<string, number>;
  current: Record<string, P04Result | undefined>;
  results: Record<string, P04Result[]>;
}

export interface P04View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: P04State['phase'];
  spec: { n: number; k: number };
  /** 解いている間だけ渡す。画面は a を表示時間だけ見せてから b に切り替える。CPU は a を「覚えられた分」しか使わない */
  set: DiffSet | null;
  showMs: number;
  boostUsed: boolean;
  boosted: boolean;
  submitted: boolean;
  ready: Record<string, boolean>;
  results: Record<string, P04Result[]>;
  totals: Record<string, number>;
  /** 直前のラウンドの問題（終わった後は公開） */
  last: { round: number; set: DiffSet } | null;
  /** 休憩（雑談できる）の段階か */
  isBreak: boolean;
}

const totalOf = (r: P04Result[]) => r.reduce((n, x) => n + x.points, 0);
const showMsOf = (s: P04State, p: CharId | 'spectator') => SHOW_MS + (p !== 'spectator' && s.boost[p] === s.round ? BOOST_MS : 0);
export const quizMs = SHOW_MS + BOOST_MS + ANSWER_MS;

/**
 * CPU：最初の盤面を、能力（記憶）と図柄の数に応じた割合でしか覚えていない。覚えているマスの変化だけに気づく。
 * 向きは位置や形より忘れやすい。気づけなかった分は、当たる見込みが損を上回る時だけ勘で選ぶ。
 */
function p04Ai(v: P04View, ctx: AiCtx): P04Move {
  if (v.phase !== 'quiz' || !v.set) {
    if (v.phase === 'prep' && !v.boostUsed && v.round >= 6 && ctx.pieces >= BOOST_COST + 2 && ctx.rng.chance(0.12) && ctx.spend(BOOST_COST, 'P04 表示延長')) return { t: 'boost' };
    return { t: 'ready' };
  }
  const mem = skill(ctx.stats.memory);
  const obs = skill(ctx.stats.observation);
  const set = v.set;
  const n = set.a.filter((x) => x !== null).length;
  const time = v.showMs / SHOW_MS;
  // 覚えていられる図柄の数（表示時間が延びると増える）
  const capacity = (3.6 + mem * 1.9 + obs * 2.7) * (0.75 + 0.25 * time) * Math.max(0.6, 1 - ctx.memoryLoss * 0.5);
  const pItem = Math.max(0.15, Math.min(0.97, capacity / n));
  const pRot = pItem * (0.62 + obs * 0.25);
  const pEmpty = Math.max(0.2, Math.min(0.97, pItem * 0.9 + 0.08));
  const changed = changedCells(set);
  const picked: number[] = [];
  const known = new Set<number>();
  for (let c = 0; c < set.a.length; c++) {
    const was = set.a[c];
    const now = set.b[c];
    let noticed: boolean;
    if (was === null) noticed = ctx.rng.chance(pEmpty);
    else if (now !== null && was.split(':')[0] === now.split(':')[0]) noticed = ctx.rng.chance(pRot);
    else noticed = ctx.rng.chance(pItem);
    if (noticed) {
      known.add(c);
      if (was !== now) picked.push(c);
    }
  }
  // 勘：分からないマスの中に、残りの変化がある。当たる見込みが 4 分の 1 を超える時だけ選ぶ（当たり +3、外れ −1）
  const unknown = ctx.rng.shuffle(Array.from({ length: set.a.length }, (_, i) => i).filter((i) => !known.has(i)));
  let left = set.k - picked.length;
  while (left > 0 && unknown.length && left / unknown.length > 0.25 + (50 - ctx.personality.risk) / 400) {
    picked.push(unknown.shift()!);
    left--;
  }
  void changed;
  const sec = 5 + set.k * 1.6 + (1 - obs) * 5 + Math.max(0, ctx.rng.gauss(2, 2));
  return { t: 'answer', cells: picked.slice(0, set.k), ms: Math.round(Math.min(ANSWER_MS - 300, sec * 1000)) };
}

export const P04: MatchEngine<P04State, P04Move, P04View> = {
  id: 'p04',
  name: '消えた図形',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '盤面を覚え、切り替わった後に変わったマスを選ぶ。形、向き、位置を見比べる。',
  rules: [
    '全 10 ラウンド。5×5 の盤面に、形と向きのある図柄が並びます。全員が同じ問題を同時に解きます。',
    '盤面は 8 秒だけ表示され、その後、少しだけ変わった盤面に切り替わります。',
    '変わったマスを選びます（3〜5 個。数は毎回表示されます）。制限時間は 25 秒です。',
    '変化は 4 種類：2 つの図柄の入れ替え、向きの回転、図柄の追加、図柄の消去。入れ替えは 2 マスが変わります。',
    '当たったマス 1 つにつき 3 点。間違って選んだマス 1 つにつき −1 点（そのラウンドの最低は 0 点）。すべて当てて間違いが無ければ +3 点。',
    '2 ラウンドごとに 15 秒の休憩があります。',
    `ピース ${BOOST_COST} 個で、最初の表示を 3 秒延ばせます（この競技で 1 回だけ。条件は全員同じです）。`,
    '合計点の最下位が脱落します。同点は、当てたマスの総数、当てたラウンドの解答時間の合計の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点で選んでいたマスで採点します。',
  ],
  init(players, rng) {
    return {
      players: [...players],
      round: 0,
      phase: 'prep',
      sets: ROUND_SPECS.map((spec) => makeSet(rng, spec)),
      ready: Object.fromEntries(players.map((p) => [p, false])),
      boost: Object.fromEntries(players.map((p) => [p, -1])),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'prep') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    const head = `ラウンド ${s.round + 1} / ${ROUNDS}`;
    if (s.phase === 'prep') return s.round > 0 && s.round % 2 === 0 ? { label: `休憩（次は${head}）`, time: PREP_MS, negotiation: true } : { label: `${head}　準備`, time: PREP_MS };
    return { label: head, time: quizMs };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'prep') {
      if (s.ready[p]) return false;
      return m.t === 'ready' || (m.t === 'boost' && s.boost[p] < 0);
    }
    if (s.current[p] || m.t !== 'answer') return false;
    if (!Array.isArray(m.cells) || m.cells.length > s.sets[s.round].k || new Set(m.cells).size !== m.cells.length) return false;
    if (m.cells.some((c) => !Number.isInteger(c) || c < 0 || c >= SIZE * SIZE)) return false;
    return typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= quizMs + 1000;
  },
  defaultMove(s) {
    return s.phase === 'prep' ? { t: 'ready' } : { t: 'answer', cells: [], ms: ANSWER_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p04: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'boost') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う
      s.boost[p] = s.round;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) s.phase = 'quiz';
      return;
    }
    const sc = scoreAnswer(s.sets[s.round], m.cells);
    s.current[p] = { cells: [...m.cells], ...sc, ms: Math.min(ANSWER_MS, m.ms) };
    if (!s.players.every((x) => s.current[x])) return;
    for (const x of s.players) s.results[x].push(s.current[x]!);
    s.current = {};
    if (s.round >= ROUNDS - 1) {
      s.phase = 'done';
      return;
    }
    s.round += 1;
    s.phase = 'prep';
    s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
  },
  view(s, p) {
    const r = Math.min(s.round, ROUNDS - 1);
    const n = s.results[s.players[0]].length;
    const me = p === 'spectator' ? null : p;
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: ROUNDS,
      phase: s.phase,
      spec: ROUND_SPECS[r],
      set: s.phase === 'quiz' ? s.sets[r] : null,
      showMs: showMsOf(s, p),
      boostUsed: !!me && s.boost[me] >= 0,
      boosted: !!me && s.boost[me] === s.round,
      submitted: !!me && !!s.current[me],
      ready: { ...s.ready },
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      last: n > 0 ? { round: n - 1, set: s.sets[n - 1] } : null,
      isBreak: s.phase === 'prep' && s.round > 0 && s.round % 2 === 0,
    };
  },
  ai: p04Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const hits = (p: CharId) => s.results[p].reduce((n, r) => n + r.hits, 0);
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + (r.hits > 0 ? r.ms : ANSWER_MS), 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 + hits(p), (p) => -time(p));
  },
};

/** 説明と練習に使う問題（本番とは別。変わったマスは 3 つ：回転 1、消去 1、追加 1） */
export const P04_PRACTICE: DiffSet = (() => {
  const a: Fig[] = new Array<Fig>(SIZE * SIZE).fill(null);
  const put: [number, string][] = [[1, 'arrow:0'], [5, 'half:1'], [8, 'el:2'], [12, 'tee:0'], [16, 'drop:3'], [19, 'arrow:1'], [22, 'el:0']];
  for (const [c, f] of put) a[c] = f;
  const b = [...a];
  b[1] = 'arrow:1';
  b[16] = null;
  b[14] = 'half:0';
  return { a, b, k: 3 };
})();
