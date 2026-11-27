/**
 * M01 ピース・アセンブル（v11、12 人）
 * 4 人ずつの組に分かれ、同じ問題を各自の盤面で解く。枠の空きマスを、配られたピースですべて埋める。
 * 6 ステージ、各 120 秒。完成 100 点＋速さの加点（最大 20）。未完成は埋めたマスの割合 × 40。
 * 組の全員が完成すると、その組の全員に +10。順位は個人の合計点で決まる。
 * 3 ステージ後に組替え。ステージの間に 20 秒の休憩（会話）。2 ピースで、正しい 1 片の位置を 1 回だけ見られる。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { coverage, freeCount, generate, norm, rotated, solve, STAGE_SPECS, type Cell, type Placement, type Puzzle } from './poly';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const STAGES = 6;
export const STAGE_MS = 120_000;
export const BREAK_MS = 20_000;
export const HINT_COST = 2;
export const GROUP_SIZE = 4;

export type M01Move = { t: 'solve'; placed: Placement[]; ms: number } | { t: 'hint' } | { t: 'ready' };

export interface M01Result {
  complete: boolean;
  /** 埋めたマスの数 */
  covered: number;
  ms: number;
  base: number;
  speed: number;
  /** 組の全員完成の加点 */
  team: number;
}

export interface M01State {
  players: CharId[];
  groups: CharId[][];
  stage: number;
  phase: 'solve' | 'break' | 'done';
  puzzles: Puzzle[];
  /** 生成時の敷き詰め。参加者の view には出さない（ヒントを買った人に 1 片だけ見せる） */
  solutions: Placement[][];
  /** このステージの提出（全員そろったら results へ移す） */
  current: Record<string, { placed: Placement[]; ms: number } | undefined>;
  results: Record<string, M01Result[]>;
  ready: Record<string, boolean>;
  /** ヒントを使ったステージ（-1 は未使用） */
  hintStage: Record<string, number>;
  hintPiece: Record<string, number>;
}

export interface M01View {
  self: CharId | 'spectator';
  players: CharId[];
  groups: CharId[][];
  myGroup: CharId[];
  stage: number;
  stages: number;
  phase: M01State['phase'];
  /** 今のステージの問題（全員同じ） */
  puzzle: Puzzle;
  /** 自分が買ったヒント（このステージで有効なものだけ） */
  hint: Placement | null;
  hintUsed: boolean;
  submitted: boolean;
  /** 確定したステージの結果 */
  results: Record<string, M01Result[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
  /** 同じ組の人の今のステージの進み具合（観戦と本人の画面表示用。完成した時刻に画面へ出す） */
  mates: { id: CharId; ms: number; complete: boolean }[];
}

function makeGroups(players: CharId[]): CharId[][] {
  const n = Math.max(1, Math.ceil(players.length / GROUP_SIZE));
  const groups: CharId[][] = Array.from({ length: n }, () => []);
  players.forEach((p, i) => groups[i % n].push(p));
  return groups;
}

/** 組替え：同じ相手とできるだけ重ならないよう、元の組の k 番目の人を (元の組 + k) 番目の組へ送る */
function regroup(groups: CharId[][]): CharId[][] {
  const n = groups.length;
  const out: CharId[][] = Array.from({ length: n }, () => []);
  groups.forEach((g, i) => g.forEach((p, k) => out[(i + k) % n].push(p)));
  // 人数の偏りをならす
  for (let guard = 0; guard < 20; guard++) {
    const big = out.reduce((a, b) => (b.length > a.length ? b : a));
    const small = out.reduce((a, b) => (b.length < a.length ? b : a));
    if (big.length - small.length <= 1) break;
    small.push(big.pop()!);
  }
  return out;
}

export function scoreOf(puzzle: Puzzle, placed: Placement[], ms: number): Omit<M01Result, 'team'> {
  const cov = Math.max(0, coverage(puzzle, placed));
  const free = freeCount(puzzle);
  const complete = cov === free;
  const t = Math.max(0, Math.min(STAGE_MS, ms));
  return {
    complete,
    covered: cov,
    ms: t,
    base: complete ? 100 : Math.floor((cov / free) * 40),
    speed: complete ? Math.floor(((STAGE_MS - t) / STAGE_MS) * 20) : 0,
  };
}

const total = (r: M01Result[]) => r.reduce((n, x) => n + x.base + x.speed + x.team, 0);

function resolveStage(s: M01State): void {
  const puzzle = s.puzzles[s.stage];
  const res: Record<string, M01Result> = {};
  for (const p of s.players) {
    const c = s.current[p] ?? { placed: [], ms: STAGE_MS };
    res[p] = { ...scoreOf(puzzle, c.placed, c.ms), team: 0 };
  }
  for (const g of s.groups) {
    if (g.length >= 2 && g.every((p) => res[p].complete)) for (const p of g) res[p].team = 10;
  }
  for (const p of s.players) s.results[p].push(res[p]);
  s.current = {};
  if (s.stage >= STAGES - 1) {
    s.phase = 'done';
    return;
  }
  s.phase = 'break';
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
}

function nextStage(s: M01State): void {
  s.stage += 1;
  s.phase = 'solve';
  if (s.stage === Math.floor(STAGES / 2)) s.groups = regroup(s.groups);
}

/**
 * CPU：見えている盤面とピースだけでバックトラックする。能力（論理）で探索の速さが変わる。
 * 提出する時間は実際の計算時間ではなく、能力から決めた仮の所要時間。
 */
function m01Ai(v: M01View, ctx: AiCtx): M01Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const logic = skill(ctx.stats.logic);
  const strat = skill(ctx.stats.strategy);
  const pieces = v.puzzle.pieces.length;
  // 1 秒あたりに試せる配置の数と、1 片を置くのにかかる時間
  const rate = (5 + logic * 4.5 + strat * 1.5) / Math.max(0.6, ctx.noise * 0.55 + 0.45);
  const read = 5 + (1 - logic) * 3.5;
  const perPiece = 2.6 + (1 - logic) * 1.1;
  const jitter = 1 + ctx.rng.gauss(0, 0.2);
  const budget = Math.max(1, Math.floor((STAGE_MS / 1000 - read - pieces * perPiece) * rate * Math.max(0.6, jitter)));
  const fixed = v.hint ? [v.hint] : [];
  const r = solve(v.puzzle, budget, ctx.rng, fixed);
  if (r.solved) {
    const sec = (read + pieces * perPiece + r.nodes / rate) * Math.max(0.7, jitter);
    return { t: 'solve', placed: r.placed, ms: Math.round(Math.min(STAGE_MS - 500, Math.max(8000, sec * 1000))) };
  }
  // 解けそうにない：手持ちに余裕があれば、1 回だけヒントを買う（主人公と同じ価格）
  if (!v.hintUsed && ctx.pieces >= HINT_COST + 1 && ctx.rng.chance(0.25 + ctx.personality.risk / 250) && ctx.spend(HINT_COST, 'M01 ヒント')) return { t: 'hint' };
  return { t: 'solve', placed: r.best, ms: STAGE_MS };
}

export const M01: MatchEngine<M01State, M01Move, M01View> = {
  id: 'm01',
  name: 'ピース・アセンブル',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 12,
  summary: '枠の空きマスを、配られたピースですべて埋める。速く正確に完成させるほど高得点。',
  rules: [
    '4 人ずつの組に分かれます。全員に同じ問題が出され、各自の盤面で解きます。',
    '枠の空いているマスを、配られたピースですべて埋めると完成です。ピースは 90 度ずつ回せます。裏返しはできません。',
    'ピース同士を重ねること、枠の外や黒いマス（穴）の上に置くことはできません。',
    '全 6 ステージ、1 ステージ 120 秒。盤面は 4×4 から 6×6 へ大きくなります。',
    '完成すると 100 点。さらに、残り時間に応じて最大 20 点が加わります。',
    '完成できなかった時は、埋めたマスの割合 × 40 点（切り捨て）です。',
    '同じ組の全員が完成すると、その組の全員に +10 点。順位は個人の合計点で決まります。',
    '3 ステージが終わると組替えがあります。ステージの間には 20 秒の休憩があり、同じ組の人と話せます。',
    `ピースを ${HINT_COST} 個支払うと、正しい 1 片の位置を見られます（この競技で 1 回だけ。置くのは自分です）。`,
    '合計点が同じ時は、完成した数、完成にかかった時間の合計の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点で置いてあるピースで採点します。',
  ],
  init(players, rng: Rng, opts) {
    const order = rng.shuffle([...players]);
    // 決勝（M11）の種目として使う時は、4×4、5×5、6×6 の 3 問
    const specs = opts?.final ? [STAGE_SPECS[0], STAGE_SPECS[2], STAGE_SPECS[5]] : STAGE_SPECS.slice(0, STAGES);
    const gens = specs.map((sp) => generate(rng, sp));
    return {
      players: [...players],
      groups: makeGroups(order),
      stage: 0,
      phase: 'solve',
      puzzles: gens.map((g) => g.puzzle),
      solutions: gens.map((g) => g.solution),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
      ready: {},
      hintStage: Object.fromEntries(players.map((p) => [p, -1])),
      hintPiece: {},
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.current[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `休憩（次はステージ ${s.stage + 2}）`, time: BREAK_MS, negotiation: true };
    return { label: `ステージ ${s.stage + 1} / ${STAGES}`, time: STAGE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.current[p]) return false;
    if (m.t === 'hint') return s.hintStage[p] < 0;
    if (m.t !== 'solve') return false;
    if (typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0 || m.ms > STAGE_MS + 1000) return false;
    return coverage(s.puzzles[s.stage], m.placed) >= 0;
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'solve', placed: [], ms: STAGE_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m01: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) nextStage(s);
      return;
    }
    if (m.t === 'hint') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う。ここでは 1 回だけという制限を守る
      s.hintStage[p] = s.stage;
      const sol = s.solutions[s.stage];
      // いちばん大きい片を見せる（どの片かは全員同じ規則）
      const pick = sol.reduce((a, b) => (s.puzzles[s.stage].pieces[b.piece].length > s.puzzles[s.stage].pieces[a.piece].length ? b : a));
      s.hintPiece[p] = pick.piece;
      return;
    }
    s.current[p] = { placed: m.placed.map((x) => ({ piece: x.piece, rot: ((x.rot % 4) + 4) % 4, x: x.x, y: x.y })), ms: Math.min(STAGE_MS, m.ms) };
    if (s.players.every((x) => s.current[x])) resolveStage(s);
  },
  view(s, p) {
    const idx = Math.min(s.stage, STAGES - 1);
    const myGroup = s.groups.find((g) => g.includes(p as CharId)) ?? s.groups[0];
    const hintOn = p !== 'spectator' && s.hintStage[p] === s.stage && s.phase === 'solve';
    const puzzle = s.puzzles[idx];
    // 進み具合を見せるのは人が見る画面だけ。CPU には渡さない（判断にも使っていない）
    const showMates = p === 'hero' || p === 'spectator';
    return {
      self: p,
      players: s.players,
      groups: s.groups,
      myGroup,
      stage: s.stage,
      stages: STAGES,
      phase: s.phase,
      puzzle,
      hint: hintOn ? s.solutions[idx].find((x) => x.piece === s.hintPiece[p]) ?? null : null,
      hintUsed: p === 'spectator' ? true : s.hintStage[p] >= 0,
      submitted: p !== 'spectator' && !!s.current[p],
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, total(s.results[x])])),
      ready: { ...s.ready },
      mates: showMates && s.phase === 'solve' ? myGroup.filter((x) => x !== p && s.current[x]).map((x) => ({ id: x, ms: s.current[x]!.ms, complete: scoreOf(puzzle, s.current[x]!.placed, s.current[x]!.ms).complete })) : [],
    };
  },
  ai: m01Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, total(s.results[p])]));
  },
  ranking(s) {
    const done = (p: CharId) => s.results[p].filter((r) => r.complete).length;
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + (r.complete ? r.ms : STAGE_MS), 0);
    // 合計点 → 完成数 → 完成時間の合計（短い方が上）
    return sortGroups(s.players, (p) => total(s.results[p]) * 100 + done(p), (p) => -time(p));
  },
  allyValue() {
    return 1;
  },
};

// ---- 説明と練習に使う盤面（本番の問題とは別） ----

export const L4: Cell[] = [[0, 0], [0, 1], [0, 2], [1, 2]];
export const SQ: Cell[] = [[0, 0], [1, 0], [0, 1], [1, 1]];
const J4: Cell[] = [[1, 0], [1, 1], [1, 2], [0, 2]];

export const M01_DEMO: Puzzle = { w: 4, h: 3, holes: new Array<boolean>(12).fill(false), pieces: [rotated(L4, 1), SQ, rotated(J4, 3)] };
export const M01_PRACTICE: Puzzle = {
  w: 4, h: 4,
  holes: [false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false],
  // 解の一例：T を上段、L を左下、小さい L を右、S を下段（別の置き方でも、全部埋まれば正解）
  pieces: [rotated([[0, 0], [1, 0], [2, 0], [1, 1]], 2), rotated(L4, 1), rotated(norm([[2, 1], [3, 1], [3, 2]]), 1), norm([[1, 2], [2, 2], [2, 3], [3, 3]])],
};

