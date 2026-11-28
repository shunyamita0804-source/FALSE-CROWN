/**
 * P05 21の攻防（v11、3 人）
 * 各自 1〜9 のカードを 1 枚ずつ持つ。場の合計は 0 から。手番に 1 枚を公開で出し、合計に足す。
 * 合計がちょうど 21 なら +4 点、21 を超えたら −3 点。どちらの場合も合計は 0 に戻る。
 * 3 セット、各セット 9 巡（全員が 9 枚を出し切る）。先手はセットごと、巡ごとに交代する。セットの最後に残った合計は捨てる。
 * 出したカードは全員に見えるので、残りの手札は全員分が分かる。パスはできない。
 * 順位は得点、21 を作った回数、超過の少なさの順。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const SETS = 3;
export const TURNS = 9;
export const GOAL = 21;
export const HIT = 4;
export const BUST = -3;
export const MOVE_MS = 25_000;
export const BREAK_MS = 20_000;

export type P05Move = { t: 'play'; card: number } | { t: 'ready' };

export interface P05Log { set: number; turn: number; who: CharId; card: number; total: number; kind: 'add' | 'hit' | 'bust' }

export interface P05State {
  players: CharId[];
  set: number;
  /** このセットで出された枚数（0〜26） */
  n: number;
  phase: 'play' | 'break' | 'done';
  hands: Record<string, number[]>;
  total: number;
  scores: Record<string, number>;
  hits: Record<string, number>;
  busts: Record<string, number>;
  ready: Record<string, boolean>;
  log: P05Log[];
  stage: string;
}

export interface P05View {
  self: CharId | 'spectator';
  players: CharId[];
  set: number;
  sets: number;
  turn: number;
  turns: number;
  phase: P05State['phase'];
  toMove: CharId | null;
  /** この巡の手番順 */
  order: CharId[];
  /** 全員の残りの手札（出したカードが公開なので、全員に分かる） */
  hands: Record<string, number[]>;
  total: number;
  scores: Record<string, number>;
  hits: Record<string, number>;
  busts: Record<string, number>;
  ready: Record<string, boolean>;
  log: P05Log[];
}

const full = () => [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 手番：巡ごとに先手が 1 人ずつずれ、セットごとにもずれる */
export function moverAt(players: CharId[], set: number, n: number): CharId {
  const k = players.length;
  const turn = Math.floor(n / k);
  return players[(set + turn + (n % k)) % k];
}

/** カードを出した結果 */
export function outcome(total: number, card: number): { total: number; delta: number; kind: P05Log['kind'] } {
  const sum = total + card;
  if (sum === GOAL) return { total: 0, delta: HIT, kind: 'hit' };
  if (sum > GOAL) return { total: 0, delta: BUST, kind: 'bust' };
  return { total: sum, delta: 0, kind: 'add' };
}

interface Node { hands: number[][]; total: number; n: number }

/** 先読み：全員が自分の得点から他の 2 人の平均を引いた値を最大にすると仮定する。返すのは各席の得点の増減 */
function search(node: Node, set: number, k: number, depth: number): number[] {
  if (depth === 0 || node.n >= TURNS * k) return new Array<number>(k).fill(0);
  const seat = (set + Math.floor(node.n / k) + (node.n % k)) % k;
  let best: number[] | null = null;
  let bestVal = -Infinity;
  const hand = node.hands[seat];
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const o = outcome(node.total, card);
    const hands = node.hands.map((h, s) => (s === seat ? h.filter((_, j) => j !== i) : h));
    const res = search({ hands, total: o.total, n: node.n + 1 }, set, k, depth - 1);
    const gain = [...res];
    gain[seat] += o.delta;
    const others = gain.reduce((a, b) => a + b, 0) - gain[seat];
    const val = gain[seat] - others / (k - 1);
    if (val > bestVal) { bestVal = val; best = gain; }
  }
  return best ?? new Array<number>(k).fill(0);
}

/**
 * CPU：出されたカード（全員に公開）から全員の残りの手札を数え、数手先まで読む。読む深さは能力で変わる。
 * 読みの外では、次の人にちょうど 21 を作らせない合計を好む。
 */
function p05Ai(v: P05View, ctx: AiCtx): P05Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const me = ctx.self;
  const k = v.players.length;
  const seatOf = (p: CharId) => v.players.indexOf(p);
  const hand = v.hands[me];
  if (hand.length === 1) return { t: 'play', card: hand[0] };
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.memory); // 副：使われた札の記憶
  const depth = Math.max(1, Math.min(5, Math.round(1 + st * 2.6 + lg * 1.2 + ctx.rng.gauss(0, 0.5))));
  const n = v.turn * k + v.order.indexOf(me);
  const hands = v.players.map((p) => [...v.hands[p]]);
  const seat = seatOf(me);
  let best = hand[0];
  let bestVal = -Infinity;
  for (const card of hand) {
    const o = outcome(v.total, card);
    const next = hands.map((h, s) => (s === seat ? h.filter((c) => c !== card) : h));
    const res = search({ hands: next, total: o.total, n: n + 1 }, v.set, k, depth - 1);
    res[seat] += o.delta;
    const others = res.reduce((a, b) => a + b, 0) - res[seat];
    // 小さいカードは終盤の超過を避けるのに使えるので、同じ評価なら大きいカードから出す
    const val = res[seat] - others / (k - 1) + card * 0.02 + ctx.rng.gauss(0, 0.35 + ctx.noise * 0.9 + (1 - st) * 0.8);
    if (val > bestVal) { bestVal = val; best = card; }
  }
  return { t: 'play', card: best };
}

export const P05: MatchEngine<P05State, P05Move, P05View> = {
  id: 'p05',
  name: '21の攻防',
  kind: 'prison',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '1〜9 のカードを 1 枚ずつ出して合計を足す。ちょうど 21 で得点、超えると失点。全員の残りの手札を読む。',
  rules: [
    '各自、1〜9 のカードを 1 枚ずつ持ちます。場の合計は 0 から始まります。',
    '手番に 1 枚を出し、合計に足します。出したカードは全員に見えます。パスはできません。',
    `合計がちょうど ${GOAL} になると +${HIT} 点。${GOAL} を超えると ${BUST} 点。どちらの場合も、合計は 0 に戻ります。`,
    '全 3 セット。1 セットは 9 巡で、全員が 9 枚を出し切ります。セットの最後に残った合計は捨てます。次のセットは、また 1〜9 の 9 枚から始めます。',
    '先手は、巡ごと、セットごとに交代します。',
    '全員の残りの手札は、いつでも見られます。次の人にちょうど 21 を作られない合計を残すのが要点です。',
    'セットの間に 20 秒の休憩があり、話せます。ピースで買える補助はありません。',
    '合計点の最下位が脱落します。同点は、21 を作った回数、超過の少なさの順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：手札の一番小さいカードが自動で出ます。',
  ],
  init(players) {
    const zero = () => Object.fromEntries(players.map((p) => [p, 0]));
    return {
      players: [...players], set: 0, n: 0, phase: 'play',
      hands: Object.fromEntries(players.map((p) => [p, full()])),
      total: 0, scores: zero(), hits: zero(), busts: zero(),
      ready: Object.fromEntries(players.map((p) => [p, false])),
      log: [], stage: '0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return [moverAt(s.players, s.set, s.n)];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `休憩（次はセット ${s.set + 1}）`, time: BREAK_MS, negotiation: true };
    return { label: `セット ${s.set + 1} / ${SETS}　${Math.floor(s.n / s.players.length) + 1} 巡目`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    return m.t === 'play' && moverAt(s.players, s.set, s.n) === p && s.hands[p].includes(m.card);
  },
  defaultMove(s, p) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'play', card: Math.min(...s.hands[p]) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`p05: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) {
        s.phase = 'play';
        s.stage = `${s.set}-0`;
      }
      return;
    }
    const o = outcome(s.total, m.card);
    s.hands[p] = s.hands[p].filter((c) => c !== m.card);
    s.log.push({ set: s.set, turn: Math.floor(s.n / s.players.length), who: p, card: m.card, total: s.total + m.card, kind: o.kind });
    s.total = o.total;
    s.scores[p] += o.delta;
    if (o.kind === 'hit') s.hits[p] += 1;
    if (o.kind === 'bust') s.busts[p] += 1;
    s.n += 1;
    // 手番が替わるたびに段階を進める（持ち時間を数え直す）
    s.stage = `${s.set}-${s.n}`;
    if (s.n < TURNS * s.players.length) return;
    if (s.set >= SETS - 1) {
      s.phase = 'done';
      return;
    }
    s.set += 1;
    s.n = 0;
    s.total = 0;
    s.hands = Object.fromEntries(s.players.map((x) => [x, full()]));
    s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
    s.phase = 'break';
    s.stage = `${s.set}-break`;
  },
  view(s, p) {
    const k = s.players.length;
    const turn = Math.floor(s.n / k);
    return {
      self: p, players: s.players, set: s.set, sets: SETS, turn, turns: TURNS, phase: s.phase,
      toMove: s.phase === 'play' ? moverAt(s.players, s.set, s.n) : null,
      order: Array.from({ length: k }, (_, i) => s.players[(s.set + turn + i) % k]),
      hands: Object.fromEntries(s.players.map((x) => [x, [...s.hands[x]]])),
      total: s.total, scores: { ...s.scores }, hits: { ...s.hits }, busts: { ...s.busts }, ready: { ...s.ready }, log: s.log,
    };
  },
  ai: p05Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return { ...s.scores };
  },
  ranking(s) {
    return sortGroups(s.players, (p) => s.scores[p] * 100 + s.hits[p], (p) => -s.busts[p]);
  },
};
