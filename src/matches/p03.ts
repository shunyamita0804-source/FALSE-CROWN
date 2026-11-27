/**
 * P03 スピードカード（v11、4 人）
 * 3 ラウンド。各自が、全員同じ並びの山札 24 枚（1〜12 が 2 枚ずつ）を、手札 4 枚から場札 2 枚へ重ねていく。
 * 場札との差がちょうど 1 のカードだけ出せる（1 と 12 は隣り合わない）。出したら山札から 1 枚補充する。
 * どちらの場札にも出せない時だけ、予備列の次のカードで場札 1 枚を置き換えられる（1 ラウンド 8 回まで。どちらを置き換えるかは自分で選ぶ）。
 * 1 ラウンド 180 秒。出した枚数 × 2 点、24 枚すべて出すと +8。順位は合計点、置き換えの少なさ、かかった時間の順。
 * 並びは、最後まで出し切れる手順があることを確かめてから使う。ピースの補助はない。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 3;
export const DECK = 24;
export const HAND = 4;
export const MAX_REFRESH = 8;
export const ROUND_MS = 180_000;
export const BREAK_MS = 20_000;
export const CARD_POINTS = 2;
export const CLEAR_BONUS = 8;

export interface P03Layout {
  /** 山札（先頭から引く）。最初の 4 枚が最初の手札 */
  deck: number[];
  /** 最初の場札 2 枚 */
  piles: [number, number];
  /** 予備列（先頭から使う） */
  reserve: number[];
}

/** 1 手：手札の数字 v を場札 pile へ出す、または場札 pile を予備列の次のカードで置き換える */
export type P03Act = { k: 'p'; v: number; pile: 0 | 1 } | { k: 'r'; pile: 0 | 1 };

export interface P03Table {
  hand: number[];
  piles: [number, number];
  /** 山札から次に引く位置 */
  at: number;
  /** 使った置き換えの回数 */
  refreshes: number;
  played: number;
}

export const fits = (card: number, pile: number) => Math.abs(card - pile) === 1;

export function startTable(l: P03Layout): P03Table {
  return { hand: l.deck.slice(0, HAND), piles: [l.piles[0], l.piles[1]], at: HAND, refreshes: 0, played: 0 };
}

export const canPlayAny = (t: P03Table) => t.hand.some((c) => fits(c, t.piles[0]) || fits(c, t.piles[1]));
/** 置き換えができるか（どちらにも出せず、手札が残っていて、回数が残っている時だけ） */
export const canRefresh = (l: P03Layout, t: P03Table) => t.hand.length > 0 && !canPlayAny(t) && t.refreshes < Math.min(MAX_REFRESH, l.reserve.length);
/** これ以上、何もできないか */
export const stuck = (l: P03Layout, t: P03Table) => t.hand.length === 0 || (!canPlayAny(t) && !canRefresh(l, t));

/** 1 手を適用する。規則に反していれば false（盤面は変えない） */
export function applyAct(l: P03Layout, t: P03Table, a: P03Act): boolean {
  if (!a || (a.pile !== 0 && a.pile !== 1)) return false;
  if (a.k === 'p') {
    const i = t.hand.indexOf(a.v);
    if (i < 0 || !fits(a.v, t.piles[a.pile])) return false;
    t.piles[a.pile] = a.v;
    if (t.at < l.deck.length) t.hand[i] = l.deck[t.at++];
    else t.hand.splice(i, 1);
    t.played++;
    return true;
  }
  if (a.k === 'r') {
    if (!canRefresh(l, t)) return false;
    t.piles[a.pile] = l.reserve[t.refreshes++];
    return true;
  }
  return false;
}

/** 手順をはじめから再生する。途中に反則があれば null */
export function replay(l: P03Layout, acts: P03Act[]): P03Table | null {
  if (!Array.isArray(acts) || acts.length > DECK + MAX_REFRESH) return null;
  const t = startTable(l);
  for (const a of acts) if (!applyAct(l, t, a)) return null;
  return t;
}

export const pointsOf = (played: number) => played * CARD_POINTS + (played >= DECK ? CLEAR_BONUS : 0);

/** 並びをすべて知っている前提で、出し切れる手順を探す（問題の検査用）。見つからなければ null */
export function solveLayout(l: P03Layout, budget = 200_000): P03Act[] | null {
  let nodes = 0;
  const dead = new Set<string>();
  const acts: P03Act[] = [];
  const rec = (t: P03Table): boolean => {
    if (t.played >= l.deck.length) return true;
    if (nodes++ > budget) return false;
    const key = `${t.at}|${[...t.hand].sort((a, b) => a - b).join(',')}|${Math.min(t.piles[0], t.piles[1])},${Math.max(t.piles[0], t.piles[1])}|${t.refreshes}`;
    if (dead.has(key)) return false;
    const opts: P03Act[] = [];
    const seen = new Set<string>();
    for (const v of t.hand) for (const pile of [0, 1] as const) {
      if (!fits(v, t.piles[pile]) || seen.has(`${v}:${t.piles[pile]}`)) continue;
      seen.add(`${v}:${t.piles[pile]}`);
      opts.push({ k: 'p', v, pile });
    }
    if (!opts.length && canRefresh(l, t)) opts.push({ k: 'r', pile: 0 }, { k: 'r', pile: 1 });
    for (const a of opts) {
      const n: P03Table = { hand: [...t.hand], piles: [t.piles[0], t.piles[1]], at: t.at, refreshes: t.refreshes, played: t.played };
      applyAct(l, n, a);
      acts.push(a);
      if (rec(n)) return true;
      acts.pop();
    }
    dead.add(key);
    return false;
  };
  return rec(startTable(l)) ? acts : null;
}

/** 1 手先だけを見て、出せるカードを出し続けた時の枚数（難しさの目安） */
export function greedyPlayed(l: P03Layout): number {
  const t = startTable(l);
  for (let guard = 0; guard < 100 && !stuck(l, t); guard++) {
    const v = t.hand.find((c) => fits(c, t.piles[0]) || fits(c, t.piles[1]));
    if (v !== undefined) applyAct(l, t, { k: 'p', v, pile: fits(v, t.piles[0]) ? 0 : 1 });
    else applyAct(l, t, { k: 'r', pile: 0 });
  }
  return t.played;
}

/** 並びを作る。出し切れる手順があり、何も考えずに出すだけでは出し切れない並びだけを使う */
export function generateLayout(rng: Rng): P03Layout {
  let fallback: P03Layout | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const deck = rng.shuffle(Array.from({ length: DECK }, (_, i) => (i % 12) + 1));
    const piles: [number, number] = [rng.int(2, 11), rng.int(2, 11)];
    if (piles[0] === piles[1]) continue;
    const reserve = Array.from({ length: MAX_REFRESH }, () => rng.int(1, 12));
    const l: P03Layout = { deck, piles, reserve };
    if (!solveLayout(l, 60_000)) continue;
    fallback ??= l;
    const g = greedyPlayed(l);
    if (g >= 8 && g < DECK) return l;
  }
  if (fallback) return fallback;
  // ここへは通常来ない。来た時は、順に出すだけで出し切れる並びを返す
  const deck = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 12, 1];
  return { deck, piles: [1, 11], reserve: Array.from({ length: MAX_REFRESH }, () => 2) };
}

export type P03Move = { t: 'run'; acts: P03Act[]; ms: number } | { t: 'ready' };

export interface P03Result {
  played: number;
  refreshes: number;
  /** 最後のカードを出した時刻（1 枚も出していなければ制限時間） */
  ms: number;
  points: number;
  cleared: boolean;
}

export interface P03State {
  players: CharId[];
  round: number;
  phase: 'solve' | 'break' | 'done';
  layouts: P03Layout[];
  current: Record<string, P03Result | undefined>;
  results: Record<string, P03Result[]>;
  ready: Record<string, boolean>;
}

export interface P03View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: P03State['phase'];
  /**
   * 今のラウンドの並び。画面と CPU は、見えている物（手札、場札、予備列の次の 1 枚、残り枚数）だけを使う。
   * 山札の先は、引くまで表示しない（CPU の先読みも、引く前のカードは「分からない物」として扱う）。
   */
  layout: P03Layout;
  submitted: boolean;
  results: Record<string, P03Result[]>;
  totals: Record<string, number>;
  ready: Record<string, boolean>;
}

const totalOf = (r: P03Result[]) => r.reduce((n, x) => n + x.points, 0);

function resolve(s: P03State): void {
  for (const p of s.players) s.results[p].push(s.current[p]!);
  s.current = {};
  if (s.round >= ROUNDS - 1) {
    s.phase = 'done';
    return;
  }
  s.phase = 'break';
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
}

/** 見えているカードだけで、depth 手先までに出せる最大の枚数（引いたカードは分からないので数えない） */
function lookahead(hand: number[], piles: [number, number], depth: number): number {
  if (depth <= 0) return 0;
  let best = 0;
  for (let i = 0; i < hand.length; i++) {
    for (const pile of [0, 1] as const) {
      if (!fits(hand[i], piles[pile])) continue;
      const rest = hand.filter((_, k) => k !== i);
      const np: [number, number] = pile === 0 ? [hand[i], piles[1]] : [piles[0], hand[i]];
      best = Math.max(best, 1 + lookahead(rest, np, depth - 1));
      if (best >= depth) return best;
    }
  }
  return best;
}

/**
 * CPU：手札、場札、予備列の次の 1 枚だけを見て、2〜4 手先まで読む（深さは能力しだい）。
 * 山札の先は読まない。1 手ごとの所要時間は、読みの深さと能力から決めた仮の時間（計算にかかった時間ではない）。
 */
function p03Ai(v: P03View, ctx: AiCtx): P03Move {
  if (v.phase !== 'solve') return { t: 'ready' };
  const l = v.layout;
  const logic = skill(ctx.stats.logic);
  const obs = skill(ctx.stats.observation);
  const depth = logic > 0.7 ? 4 : logic > 0.4 ? 3 : 2;
  const slip = Math.max(0.01, 0.1 - logic * 0.07 + ctx.noise * 0.03);
  const perAct = 2.6 + (1 - obs) * 1.6 + depth * 0.35;
  const t = startTable(l);
  const acts: P03Act[] = [];
  let clock = 3000 + (1 - obs) * 2000;
  let last = ROUND_MS;
  for (let guard = 0; guard < 100 && !stuck(l, t); guard++) {
    const opts: { a: P03Act; score: number }[] = [];
    if (canPlayAny(t)) {
      for (let i = 0; i < t.hand.length; i++) for (const pile of [0, 1] as const) {
        if (!fits(t.hand[i], t.piles[pile])) continue;
        const rest = t.hand.filter((_, k) => k !== i);
        const np: [number, number] = pile === 0 ? [t.hand[i], t.piles[1]] : [t.piles[0], t.hand[i]];
        // 端の数字（1 と 12）は出せる相手が 1 種類しかないので、場に置くと次が続きにくい
        const edge = t.hand[i] === 1 || t.hand[i] === 12 ? -0.25 : 0;
        opts.push({ a: { k: 'p', v: t.hand[i], pile }, score: 1 + lookahead(rest, np, depth - 1) + edge + ctx.rng.gauss(0, 0.12) });
      }
    } else {
      const next = l.reserve[t.refreshes];
      for (const pile of [0, 1] as const) {
        const np: [number, number] = pile === 0 ? [next, t.piles[1]] : [t.piles[0], next];
        opts.push({ a: { k: 'r', pile }, score: lookahead(t.hand, np, depth) + ctx.rng.gauss(0, 0.12) });
      }
    }
    opts.sort((x, y) => y.score - x.score);
    const pick = ctx.rng.chance(slip) ? ctx.rng.pick(opts) : opts[0];
    clock += perAct * 1000 * Math.max(0.5, 1 + ctx.rng.gauss(0, 0.25)) * (pick.a.k === 'r' ? 1.5 : 1);
    if (clock > ROUND_MS - 300) break;
    applyAct(l, t, pick.a);
    acts.push(pick.a);
    if (pick.a.k === 'p') last = Math.round(clock);
  }
  return { t: 'run', acts, ms: last };
}

export const P03: MatchEngine<P03State, P03Move, P03View> = {
  id: 'p03',
  name: 'スピードカード',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '手札のカードを、数字が 1 つ違いの場札へ重ねていく。全員が同じ並びで、どこまで出し切れるかを競う。',
  rules: [
    '全 3 ラウンド。各自が自分の山札 24 枚（1〜12 が 2 枚ずつ）を使います。山札の並び、場札、予備列は全員同じです。',
    '手札は 4 枚。場札は 2 枚。場札の数字とちょうど 1 違いのカードだけ、その場札に重ねられます（1 と 12 は隣り合いません）。',
    'カードを出すと、山札から 1 枚が手札に入ります。山札の次のカードは、引くまで分かりません。',
    'どちらの場札にも出せない時だけ、予備列の次のカードで、場札のどちらか 1 枚を置き換えられます（1 ラウンド 8 回まで）。次の予備のカードは見えています。',
    '1 ラウンド 180 秒。出したカード 1 枚につき 2 点、24 枚すべて出すと +8 点です。',
    '出せるカードが無く、置き換えも使い切ると、そのラウンドは終わりです。時間切れの時は、そこまでに出した枚数が得点になります。',
    'ラウンドの間に 20 秒の休憩があります。この競技にピースの補助はありません。',
    '合計点の最下位が脱落します。同点は、置き換えの回数が少ない方、出すのにかかった時間が短い方の順で決めます。それでも同じなら共通決定戦です。',
  ],
  init(players, rng) {
    return {
      players: [...players],
      round: 0,
      phase: 'solve',
      layouts: Array.from({ length: ROUNDS }, () => generateLayout(rng)),
      current: {},
      results: Object.fromEntries(players.map((p) => [p, []])),
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
    return { label: `ラウンド ${s.round + 1} / ${ROUNDS}`, time: ROUND_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.current[p] || m.t !== 'run') return false;
    if (typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0 || m.ms > ROUND_MS + 1000) return false;
    return replay(s.layouts[s.round], m.acts) !== null;
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'run', acts: [], ms: ROUND_MS };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p03: illegal move ${JSON.stringify(m).slice(0, 80)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) {
        s.phase = 'solve';
        s.round += 1;
      }
      return;
    }
    const t = replay(s.layouts[s.round], m.acts)!;
    s.current[p] = { played: t.played, refreshes: t.refreshes, ms: t.played ? Math.min(ROUND_MS, m.ms) : ROUND_MS, points: pointsOf(t.played), cleared: t.played >= DECK };
    if (s.players.every((x) => s.current[x])) resolve(s);
  },
  view(s, p) {
    return {
      self: p,
      players: s.players,
      round: s.round,
      rounds: ROUNDS,
      phase: s.phase,
      layout: s.layouts[Math.min(s.round, ROUNDS - 1)],
      submitted: p !== 'spectator' && !!s.current[p],
      results: s.results,
      totals: Object.fromEntries(s.players.map((x) => [x, totalOf(s.results[x])])),
      ready: { ...s.ready },
    };
  },
  ai: p03Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, totalOf(s.results[p])]));
  },
  ranking(s) {
    const refreshes = (p: CharId) => s.results[p].reduce((n, r) => n + r.refreshes, 0);
    const time = (p: CharId) => s.results[p].reduce((n, r) => n + r.ms, 0);
    return sortGroups(s.players, (p) => totalOf(s.results[p]) * 100 - refreshes(p), (p) => -time(p));
  },
};

/** 説明と練習に使う並び（本番とは別。12 枚で、置き換えは 2 回まで） */
export const P03_PRACTICE: P03Layout = { deck: [5, 9, 3, 7, 6, 8, 4, 10, 2, 11, 1, 12], piles: [4, 8], reserve: [6, 3] };
