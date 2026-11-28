/**
 * M03 ツイン・リンク（v11、10 人）
 * 2 人 1 組で 5 ラウンド。毎ラウンド相手が替わり、同じ相手とは 2 度組まない。
 * 各自に別々の盤面が 4 問ずつ出る。同じ記号の端点を、交差しない経路で結ぶ（全マスを埋める必要はない）。1 ラウンド 150 秒。
 * 1 問 20 点。組の 2 人がどちらも 3 問以上を完成させると、2 人に +15。順位は個人の合計点で決まる。
 * ラウンド前の 20 秒：組の相手の問題について、自分にだけ見えている手掛かり（ある経路が通るマス 1 つ）を教えるかどうかを決める。
 * 2 ピースで、1 本の経路の出だし 2 辺を 1 回だけ見られる。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { generateLink, linkComplete, linked, solveLink, type LinkPuzzle, type LinkSol } from './link';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 5;
export const PUZZLES = 4;
export const ROUND_MS = 150_000;
export const PREP_MS = 20_000;
export const POINTS = 20;
export const PAIR_BONUS = 15;
export const PAIR_NEED = 3;
export const AID_COST = 2;

/** ラウンドごとの 4 問の大きさと記号の数（全員同じ条件） */
export const ROUND_SPECS: [number, number][][] = [
  [[5, 4], [5, 4], [5, 5], [6, 5]],
  [[5, 4], [5, 5], [6, 5], [6, 6]],
  [[5, 5], [6, 5], [6, 6], [7, 6]],
  [[5, 5], [6, 6], [6, 6], [7, 6]],
  [[6, 5], [6, 6], [7, 6], [7, 7]],
];

export interface Clue { puzzle: number; color: number; cell: number }
export interface Aid { round: number; puzzle: number; color: number; cells: number[] }

export type M03Move =
  | { t: 'ready'; share: boolean }
  | { t: 'aid'; puzzle: number }
  | { t: 'solve'; sols: LinkSol[]; ms: number[] };

export interface M03Result {
  partner: CharId | null;
  /** 問題ごとの完成時刻（未完成は -1） */
  times: number[];
  done: number;
  points: number;
  bonus: number;
  /** 完成した問題の完成時刻のうち最も遅いもの（速さの比較用） */
  ms: number;
  /** 自分が相手へ手掛かりを教えたか、相手から教わったか */
  gave: boolean;
  got: boolean;
}

export interface M03State {
  players: CharId[];
  round: number;
  rounds: number;
  phase: 'prep' | 'solve' | 'done';
  /** ラウンドごとの組（人数が奇数の時は、相手のいない人が 1 人出る） */
  pairs: [CharId, CharId | null][][];
  puzzles: Record<string, LinkPuzzle[][]>;
  /** 生成時の解の一例。参加者の view には出さない（手掛かりと補助に必要な分だけ見せる） */
  solutions: Record<string, number[][][][]>;
  ready: Record<string, boolean>;
  share: Record<string, boolean>;
  aid: Record<string, Aid | undefined>;
  current: Record<string, { sols: LinkSol[]; ms: number[] } | undefined>;
  results: Record<string, M03Result[]>;
}

export interface M03View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: M03State['phase'];
  partner: CharId | null;
  /** 今のラウンドの自分の問題 */
  puzzles: LinkPuzzle[];
  /** 相手の問題について、自分にだけ見えている手掛かり */
  holding: Clue | null;
  /** その手掛かりが指す、相手の問題の盤面（端点の位置だけ） */
  holdingBoard: LinkPuzzle | null;
  /** 相手が教えてくれた、自分の問題の手掛かり（解く段階で分かる） */
  clue: Clue | null;
  /** このラウンドで、自分が教えると決めたか */
  sharing: boolean;
  aid: Aid | null;
  aidUsed: boolean;
  submitted: boolean;
  ready: Record<string, boolean>;
  results: Record<string, M03Result[]>;
  totals: Record<string, number>;
  /** 次のラウンドの相手（結果画面で知らせる） */
  nextPartner: CharId | null;
  /** 相手の今のラウンドの進み具合（人が見る画面だけ。CPU には渡さない） */
  mate: { times: number[] } | null;
}

/** 総当たりの組み合わせ（円卓法）。先頭から rounds 回ぶんを使う。同じ相手とは 2 度組まない */
export function schedule(players: CharId[], rounds: number): [CharId, CharId | null][][] {
  const list: (CharId | null)[] = [...players];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out: [CharId, CharId | null][][] = [];
  for (let r = 0; r < rounds; r++) {
    const round: [CharId, CharId | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) round.push([a, b]);
      else if (a || b) round.push([(a ?? b) as CharId, null]);
    }
    out.push(round);
    list.splice(1, 0, list.pop()!);
  }
  return out;
}

const partnerOf = (s: M03State, r: number, p: CharId): CharId | null => {
  for (const [a, b] of s.pairs[r] ?? []) {
    if (a === p) return b;
    if (b === p) return a;
  }
  return null;
};

/** 手掛かり：その人の最後の問題で、いちばん長い経路（生成時の解）が通る真ん中のマス */
function clueFor(s: M03State, r: number, p: CharId): Clue {
  const puzzle = PUZZLES - 1;
  const sol = s.solutions[p][r][puzzle];
  let color = 0;
  sol.forEach((path, i) => { if (path.length > sol[color].length) color = i; });
  return { puzzle, color, cell: sol[color][Math.floor(sol[color].length / 2)] };
}

const total = (r: M03Result[]) => r.reduce((n, x) => n + x.points + x.bonus, 0);

export function gradeRound(puzzles: LinkPuzzle[], c: { sols: LinkSol[]; ms: number[] } | undefined): { times: number[]; done: number; ms: number } {
  const times = puzzles.map((p, i) => (c && linkComplete(p, c.sols[i]) && c.ms[i] >= 0 ? Math.min(ROUND_MS, c.ms[i]) : -1));
  const ok = times.filter((t) => t >= 0);
  return { times, done: ok.length, ms: ok.length ? Math.max(...ok) : ROUND_MS };
}

function resolve(s: M03State): void {
  const r = s.round;
  const res: Record<string, M03Result> = {};
  for (const p of s.players) {
    const g = gradeRound(s.puzzles[p][r], s.current[p]);
    const partner = partnerOf(s, r, p);
    res[p] = { partner, ...g, points: g.done * POINTS, bonus: 0, gave: !!partner && !!s.share[p], got: !!partner && !!s.share[partner] };
  }
  for (const [a, b] of s.pairs[r]) {
    // 相手のいない人（奇数の時）は、自分が 3 問以上なら加点
    if (res[a].done >= PAIR_NEED && (!b || res[b].done >= PAIR_NEED)) {
      res[a].bonus = PAIR_BONUS;
      if (b) res[b].bonus = PAIR_BONUS;
    }
  }
  for (const p of s.players) s.results[p].push(res[p]);
  s.current = {};
  s.share = {};
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
  if (r >= s.rounds - 1) s.phase = 'done';
  else {
    s.round += 1;
    s.phase = 'prep';
  }
}

/**
 * CPU：端点の位置だけを見て経路を探す。所要時間は、読む時間、線を引く時間、探索の量から決めた仮の時間（計算にかかった時間ではない）。
 * 手掛かりを教えるかどうかは、組の相手との関係と性格で決める。
 */
function m03Ai(v: M03View, ctx: AiCtx): M03Move {
  if (v.phase === 'prep') {
    if (!v.partner) return { t: 'ready', share: false };
    const r = ctx.relation(v.partner);
    let pr = 0.4 + (r.trust - 40) / 90 + (ctx.personality.loyalty - 50) / 180 + (ctx.allies.includes(v.partner) ? 0.35 : 0) - r.hostility / 80;
    // 2 人とも 3 問以上で加点なので、教える方が自分の得にもなる
    pr += 0.15;
    return { t: 'ready', share: ctx.rng.chance(Math.max(0.05, Math.min(0.97, pr))) };
  }
  if (v.phase !== 'solve') return { t: 'ready', share: false };
  const logic = skill(ctx.stats.logic);
  const obs = skill(ctx.stats.observation);
  if (!v.aidUsed && v.round >= 2 && ctx.pieces >= AID_COST + 2 && ctx.rng.chance(0.1 + ctx.personality.risk / 600) && ctx.spend(AID_COST, 'M03 補助')) return { t: 'aid', puzzle: PUZZLES - 1 };
  const rate = (45 + logic * 28 + obs * 18) / Math.max(0.7, 0.55 + ctx.noise * 0.5);
  const perCell = 0.85 + (1 - logic) * 0.35 + (1 - obs) * 0.2;
  let clock = 0;
  const sols: LinkSol[] = [];
  const ms: number[] = [];
  for (let i = 0; i < v.puzzles.length; i++) {
    const p = v.puzzles[i];
    const fixed: Record<number, number[]> = v.aid && v.aid.puzzle === i ? { [v.aid.color]: v.aid.cells } : {};
    const res = solveLink(p, 6000, fixed);
    const helped = (v.clue && v.clue.puzzle === i) || (v.aid && v.aid.puzzle === i);
    const cells = res.solved ? res.sol.reduce((n, path) => n + path.length, 0) : p.size * p.size;
    const read = 6 + (1 - obs) * 5 + p.size * 0.9;
    const jitter = Math.max(0.6, 1 + ctx.rng.gauss(0, 0.24));
    // 引き直し：盤面が大きいほど、途中で詰まってやり直すことが増える
    const redo = 1 + Math.max(0, ctx.rng.gauss(0.22 + (1 - logic) * 0.3, 0.2)) * (p.size - 4) * 0.5;
    const sec = (read + cells * perCell * redo + res.nodes / rate) * jitter * (helped ? 0.85 : 1);
    clock += sec * 1000;
    if (res.solved && clock <= ROUND_MS - 300) {
      sols.push(res.sol);
      ms.push(Math.round(clock));
    } else {
      sols.push([]);
      ms.push(-1);
      if (clock > ROUND_MS) clock = ROUND_MS + 1;
    }
  }
  return { t: 'solve', sols, ms };
}

export const M03: MatchEngine<M03State, M03Move, M03View> = {
  id: 'm03',
  name: 'ツイン・リンク',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 12,
  summary: '同じ記号の端点を、交差しない経路で結ぶ。2 人 1 組で、毎ラウンド相手が替わる。',
  rules: [
    '2 人 1 組で行います。全 5 ラウンドで、毎ラウンド相手が替わります。同じ相手とは 2 度組みません。',
    '各自に別々の盤面が 4 問ずつ出ます（5×5 から 7×7。大きさと記号の数は全員同じ条件です）。1 ラウンド 150 秒。',
    '同じ記号の端点 2 つを、縦と横につながる 1 本の経路で結びます。経路どうしは交差できず、同じマスも通れません。他の記号の端点も通れません。',
    'すべての記号を結ぶと、その問題は完成です。全マスを埋める必要はありません。結び方が何通りかある時は、どれでも正解です。',
    '1 問完成で 20 点。組の 2 人がどちらも 3 問以上を完成させると、2 人に +15 点。順位は個人の合計点で決まります。',
    'ラウンド前の 20 秒：組の相手の 4 問目について、「ある経路が通るマス 1 つ」があなたにだけ見えています。教えるかどうかを決めます。教わった手掛かりは、解く時に盤面へ表示されます。',
    '解いている間は、自分の盤面だけが見えます。会話はできません。',
    `ピースを ${AID_COST} 個支払うと、いま開いている問題の 1 本の経路の、出だし 2 辺が表示されます（この競技で 1 回だけ。条件は全員同じです）。`,
    '合計点が同じ時は、完成した問題の数、完成にかかった時間の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：その時点で完成している問題だけが得点になります。',
  ],
  init(players, rng: Rng) {
    const order = rng.shuffle([...players]);
    const rounds = Math.min(ROUNDS, Math.max(1, order.length % 2 ? order.length : order.length - 1));
    const puzzles: Record<string, LinkPuzzle[][]> = {};
    const solutions: Record<string, number[][][][]> = {};
    for (const p of players) {
      const gens = ROUND_SPECS.slice(0, rounds).map((specs) => specs.map(([size, colors]) => generateLink(rng, size, colors)));
      puzzles[p] = gens.map((g) => g.map((x) => x.puzzle));
      solutions[p] = gens.map((g) => g.map((x) => x.solution));
    }
    return {
      players: [...players],
      round: 0,
      rounds,
      phase: 'prep',
      pairs: schedule(order, rounds),
      puzzles,
      solutions,
      ready: Object.fromEntries(players.map((p) => [p, false])),
      share: {},
      aid: {},
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
    const head = `ラウンド ${s.round + 1} / ${s.rounds}`;
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'prep') return { label: `${head}　準備`, time: PREP_MS, negotiation: true };
    return { label: head, time: ROUND_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'prep') return m.t === 'ready' && !s.ready[p] && typeof m.share === 'boolean';
    if (s.current[p]) return false;
    if (m.t === 'aid') return !s.aid[p] && Number.isInteger(m.puzzle) && m.puzzle >= 0 && m.puzzle < PUZZLES;
    if (m.t !== 'solve' || !Array.isArray(m.sols) || !Array.isArray(m.ms) || m.sols.length !== PUZZLES || m.ms.length !== PUZZLES) return false;
    const puzzles = s.puzzles[p][s.round];
    return puzzles.every((pz, i) => linked(pz, m.sols[i]) >= 0 && typeof m.ms[i] === 'number' && Number.isFinite(m.ms[i]) && m.ms[i] >= -1 && m.ms[i] <= ROUND_MS + 1000);
  },
  defaultMove(s) {
    return s.phase === 'prep' ? { t: 'ready', share: false } : { t: 'solve', sols: Array.from({ length: PUZZLES }, () => []), ms: new Array<number>(PUZZLES).fill(-1) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m03: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      s.share[p] = m.share && !!partnerOf(s, s.round, p);
      if (s.players.every((x) => s.ready[x])) s.phase = 'solve';
      return;
    }
    if (m.t === 'aid') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う。ここでは 1 回だけという制限を守る。
      // 見せるのは、その問題でいちばん長い経路の出だし 2 辺（どの経路かは全員同じ規則）
      const sol = s.solutions[p][s.round][m.puzzle];
      let color = 0;
      sol.forEach((path, i) => { if (path.length > sol[color].length) color = i; });
      s.aid[p] = { round: s.round, puzzle: m.puzzle, color, cells: sol[color].slice(0, 3) };
      return;
    }
    s.current[p] = { sols: m.sols.map((sol) => (sol ?? []).map((path) => (path ? [...path] : null))), ms: [...m.ms] };
    if (s.players.every((x) => s.current[x])) resolve(s);
  },
  view(s, p) {
    const r = Math.min(s.round, s.rounds - 1);
    const me = p === 'spectator' ? null : p;
    const partner = me ? partnerOf(s, r, me) : null;
    const solving = s.phase === 'solve';
    const aid = me ? s.aid[me] : undefined;
    const human = p === 'hero' || p === 'spectator';
    const mateCur = partner && solving ? s.current[partner] : undefined;
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: s.rounds,
      phase: s.phase,
      partner,
      puzzles: me ? s.puzzles[me][r] : [],
      holding: me && partner && s.phase !== 'done' ? clueFor(s, r, partner) : null,
      holdingBoard: me && partner && s.phase !== 'done' ? s.puzzles[partner][r][PUZZLES - 1] : null,
      clue: me && partner && solving && s.share[partner] ? clueFor(s, r, me) : null,
      sharing: !!me && !!s.share[me],
      aid: aid && aid.round === s.round && solving ? aid : null,
      aidUsed: me ? !!s.aid[me] : true,
      submitted: !!me && !!s.current[me],
      ready: { ...s.ready },
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, total(s.results[x])])),
      nextPartner: me && s.phase === 'prep' ? partner : null,
      mate: human && partner && mateCur ? { times: gradeRound(s.puzzles[partner][r], mateCur).times } : null,
    };
  },
  ai: m03Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, total(s.results[p])]));
  },
  ranking(s) {
    const done = (p: CharId) => s.results[p].reduce((n, r) => n + r.done, 0);
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + r.times.reduce((a, t) => a + (t >= 0 ? t : ROUND_MS), 0), 0);
    return sortGroups(s.players, (p) => total(s.results[p]) * 100 + done(p), (p) => -time(p));
  },
  allyValue() {
    return 1;
  },
};

/** 説明と練習に使う盤面（本番の問題とは別） */
export const M03_DEMO: LinkPuzzle = { size: 4, ends: [[0, 12], [1, 7], [5, 14]] };
export const M03_PRACTICE: LinkPuzzle = { size: 5, ends: [[0, 21], [1, 9], [6, 18], [16, 24]] };
