/**
 * P02 瞬間記憶（v11、4 人）
 * 8 ラウンド。4×4 から 5×5 の盤面に図柄 8〜18 個を 10〜15 秒表示して隠し、指定された 6 マスの図柄を候補 4 つから選ぶ（1 問 8 秒）。
 * 正解 2 点、全問正解 +2。2 ラウンドごとに 15 秒の休憩。ピース 1 個で、1 ラウンドだけ表示を 2 秒延ばせる（この競技で 1 回）。
 * 図柄は形（5 種）と色（4 種）の組み合わせ。色には模様も付けて、色だけに頼らず見分けられるようにする。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { cpuAnswer, emptyAnswer, grade, sample, validAnswer, type MemAnswer, type MemQ, type MemSet } from './memory';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 8;
export const QUESTIONS = 6;
export const Q_MS = 8_000;
export const PREP_MS = 15_000;
export const BREAK_MS = 15_000;
export const BOOST_MS = 2_000;
export const BOOST_COST = 1;
export const BOOST_MAX = 1;
export const SLACK_MS = 7_000;

export const SHAPES = ['circle', 'triangle', 'square', 'star', 'diamond'] as const;
export const COLORS = ['red', 'blue', 'green', 'yellow'] as const;
export const SYMBOLS: string[] = SHAPES.flatMap((s) => COLORS.map((c) => `${s}:${c}`));
export const symbolAttrs = (item: string) => item.split(':');

/** ラウンドごとの盤面の大きさ、図柄の数、表示時間 */
export const ROUND_SPECS = [
  { size: 4, n: 8, showMs: 10_000 },
  { size: 4, n: 9, showMs: 10_000 },
  { size: 4, n: 10, showMs: 11_000 },
  { size: 4, n: 12, showMs: 12_000 },
  { size: 5, n: 13, showMs: 12_000 },
  { size: 5, n: 14, showMs: 13_000 },
  { size: 5, n: 16, showMs: 14_000 },
  { size: 5, n: 18, showMs: 15_000 },
];

export type P02Move = { t: 'boost' } | { t: 'ready' } | { t: 'answers'; a: MemAnswer };

export interface P02Result {
  correct: number;
  points: number;
  okMs: number;
  ok: boolean[];
  picks: number[];
}

export interface P02State {
  players: CharId[];
  round: number;
  phase: 'prep' | 'quiz' | 'break' | 'done';
  sets: MemSet[];
  /** 決勝（M11）用に問題を差し替えた時の、ラウンドごとの仕様 */
  specs?: typeof ROUND_SPECS;
  boostUsed: Record<string, number>;
  boostOn: Record<string, boolean>;
  ready: Record<string, boolean>;
  current: Record<string, MemAnswer | undefined>;
  results: Record<string, P02Result[]>;
}

export interface P02View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: P02State['phase'];
  spec: { size: number; n: number; showMs: number };
  set: MemSet | null;
  boostOn: boolean;
  boostUsed: number;
  submitted: boolean;
  ready: Record<string, boolean>;
  totals: Record<string, number>;
  last: { round: number; set: MemSet; results: Record<string, P02Result> } | null;
}

/** 候補は、正解と形が同じもの、色が同じもの、どちらも違うものを混ぜる（見た目で消去できないようにする） */
export function makeSet(rng: Rng, spec: { size: number; n: number; showMs: number }): MemSet {
  const total = spec.size * spec.size;
  const cells: (string | null)[] = new Array(total).fill(null);
  const slots = sample(rng, cells.map((_, i) => i), spec.n);
  for (const c of slots) cells[c] = rng.pick(SYMBOLS);
  const asked = sample(rng, slots, QUESTIONS);
  const questions: MemQ[] = asked.map((cell) => {
    const item = cells[cell] as string;
    const [sh, co] = item.split(':');
    const sameShape = rng.pick(SYMBOLS.filter((x) => x !== item && x.startsWith(`${sh}:`)));
    const sameColor = rng.pick(SYMBOLS.filter((x) => x !== item && x.endsWith(`:${co}`)));
    const other = rng.pick(SYMBOLS.filter((x) => !x.startsWith(`${sh}:`) && !x.endsWith(`:${co}`)));
    return { kind: 'item', cell, options: rng.shuffle([item, sameShape, sameColor, other]) };
  });
  return { board: { w: spec.size, h: spec.size, cells }, showMs: spec.showMs, qMs: Q_MS, questions };
}

const totalOf = (r: P02Result[]) => r.reduce((n, x) => n + x.points, 0);
export const quizMs = (set: MemSet) => set.showMs + BOOST_MS + set.questions.length * set.qMs + SLACK_MS;

function resolve(s: P02State): void {
  const set = s.sets[s.round];
  for (const p of s.players) {
    const a = s.current[p] ?? emptyAnswer(set);
    const g = grade(set, a);
    s.results[p].push({ correct: g.correct, points: g.correct * 2 + (g.correct === set.questions.length ? 2 : 0), okMs: g.okMs, ok: g.ok, picks: [...a.picks] });
  }
  s.current = {};
  s.boostOn = {};
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
  if (s.round >= ROUNDS - 1) s.phase = 'done';
  else if ((s.round + 1) % 2 === 0) s.phase = 'break';
  else {
    s.round += 1;
    s.phase = 'prep';
  }
}

/** CPU：表示を見た時の記憶を、記憶力から確率で作る。位置を忘れたマスも、形か色だけ覚えていることがある */
function p02Ai(v: P02View, ctx: AiCtx): P02Move {
  if (v.phase === 'prep') {
    // 終盤の大きい盤面で、手持ちに余裕がある時だけ延長を買う
    if (!v.boostOn && v.boostUsed < BOOST_MAX && v.round >= 4 && ctx.pieces >= BOOST_COST + 2 && ctx.rng.chance(0.2 + ctx.personality.risk / 500) && ctx.spend(BOOST_COST, 'P02 表示延長')) return { t: 'boost' };
    return { t: 'ready' };
  }
  if (v.phase !== 'quiz' || !v.set) return { t: 'ready' };
  const mem = skill(ctx.stats.memory);
  const n = v.set.board.cells.filter((c) => c != null).length;
  const sec = v.set.showMs / 1000;
  const cap = 1.7 + mem * 1.4 + sec * 0.36 + ctx.rng.gauss(0, 1.3) - ctx.noise * 0.3;
  const pLoc = Math.max(0.15, Math.min(0.95, cap / n));
  return { t: 'answers', a: cpuAnswer(v.set, { pSeen: 1, pLoc, pPart: 0.3 + mem * 0.2, attrs: symbolAttrs }, ctx.rng) };
}

export const P02: MatchEngine<P02State, P02Move, P02View> = {
  id: 'p02',
  name: '瞬間記憶',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '盤面に並んだ図柄を覚え、隠れた後に、指定されたマスの図柄を答える。',
  rules: [
    '全 8 ラウンド。全員が同じ盤面、同じ問題で同時に行います。',
    '盤面（4×4 から 5×5）に図柄が 8〜18 個、10〜15 秒だけ表示され、その後隠れます。',
    '隠れた後、指定されたマスにあった図柄を、候補 4 つから選びます。1 ラウンド 6 問、1 問の制限時間は 8 秒です。',
    '図柄は形（丸、三角、四角、星、ひし形）と色（赤、青、緑、黄）の組み合わせです。色ごとに模様も違います。',
    '正解 1 問につき 2 点、6 問すべて正解するとさらに +2 点。未回答と時間切れは 0 点です。',
    '2 ラウンドごとに 15 秒の休憩があります。',
    `ピースを ${BOOST_COST} 個支払うと、そのラウンドだけ表示時間が 2 秒延びます（この競技で 1 回だけ。条件は全員同じです）。`,
    '合計点の最下位が脱落します。同点は、正解した数、正解にかかった時間の合計が短い順で決めます。それでも同じなら共通決定戦です。',
  ],
  init(players, rng, opts) {
    // 決勝（M11）の種目として使う時は、4×4 の 10 個、5×5 の 13 個、5×5 の 16 個の 3 問
    const specs = opts?.final ? [ROUND_SPECS[2], ROUND_SPECS[4], ROUND_SPECS[6]] : ROUND_SPECS;
    return {
      players: [...players],
      round: 0,
      phase: 'prep',
      specs: opts?.final ? specs : undefined,
      sets: specs.map((sp) => makeSet(rng, sp)),
      boostUsed: Object.fromEntries(players.map((p) => [p, 0])),
      boostOn: {},
      ready: Object.fromEntries(players.map((p) => [p, false])),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'quiz') return s.players.filter((p) => !s.current[p]);
    return s.players.filter((p) => !s.ready[p]);
  },
  stage(s) {
    const head = `ラウンド ${s.round + 1} / ${ROUNDS}`;
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'prep') return { label: `${head}　準備`, time: PREP_MS };
    if (s.phase === 'quiz') return { label: `${head}　記憶と回答`, time: quizMs(s.sets[s.round]) };
    return { label: `休憩（次はラウンド ${s.round + 2}）`, time: BREAK_MS, negotiation: true };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'prep') {
      if (s.ready[p]) return false;
      if (m.t === 'boost') return !s.boostOn[p] && s.boostUsed[p] < BOOST_MAX;
      return m.t === 'ready';
    }
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    return m.t === 'answers' && !s.current[p] && validAnswer(s.sets[s.round], m.a);
  },
  defaultMove(s) {
    return s.phase === 'quiz' ? { t: 'answers', a: emptyAnswer(s.sets[s.round]) } : { t: 'ready' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p02: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'boost') {
      s.boostOn[p] = true;
      s.boostUsed[p] += 1;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (!s.players.every((x) => s.ready[x])) return;
      if (s.phase === 'prep') s.phase = 'quiz';
      else {
        s.round += 1;
        s.phase = 'prep';
        s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      }
      return;
    }
    s.current[p] = { picks: [...m.a.picks], ms: [...m.a.ms] };
    if (s.players.every((x) => s.current[x])) resolve(s);
  },
  view(s, p) {
    const r = Math.min(s.round, ROUNDS - 1);
    const me = p === 'spectator' ? null : p;
    const played = s.results[s.players[0]].length;
    const base = s.phase === 'quiz' ? s.sets[r] : null;
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: ROUNDS,
      phase: s.phase,
      spec: (s.specs ?? ROUND_SPECS)[Math.min(r, (s.specs ?? ROUND_SPECS).length - 1)],
      set: base ? { ...base, showMs: base.showMs + (me && s.boostOn[me] ? BOOST_MS : 0) } : null,
      boostOn: !!me && !!s.boostOn[me],
      boostUsed: me ? s.boostUsed[me] : BOOST_MAX,
      submitted: !!me && !!s.current[me],
      ready: { ...s.ready },
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      last: played > 0 ? { round: played - 1, set: s.sets[played - 1], results: Object.fromEntries(s.players.map((x) => [x, s.results[x][played - 1]])) } : null,
    };
  },
  ai: p02Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const ok = (p: CharId) => s.results[p].reduce((n, x) => n + x.correct, 0);
    const time = (p: CharId) => s.results[p].reduce((n, x) => n + x.okMs, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 1000 + ok(p), (p) => -time(p));
  },
};

/** 練習に使う出題セット（本番とは別） */
export const P02_PRACTICE: MemSet = {
  board: { w: 3, h: 3, cells: ['circle:red', null, 'star:blue', null, 'square:green', null, 'triangle:yellow', null, 'diamond:red'] },
  showMs: 6000,
  qMs: Q_MS,
  questions: [
    { kind: 'item', cell: 2, options: ['star:red', 'star:blue', 'circle:blue', 'square:green'] },
    { kind: 'item', cell: 6, options: ['triangle:yellow', 'triangle:green', 'diamond:yellow', 'circle:red'] },
  ],
};
