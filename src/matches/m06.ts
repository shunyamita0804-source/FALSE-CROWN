/**
 * M06 クロス・カード（v11、7 人、個人戦）
 * 52 枚（1〜13 × 4 種の紋）。各自 5 枚、場に 5 枚を公開。全 6 ラウンド。
 * 各ラウンド：手番順に、手札 1 枚を場の 1 枚と交換する（パスもできる）。場に出したカードは公開になる。
 * 全員の交換が済むと、全員同時に、手札から 2 枚までを伏せて提出する。その 2 枚がラウンドの目標（同じ数字／同じ紋／連続する数字）に合えば 6 点。
 * 達成した人のうち、提出した 2 枚の数字の合計が一番大きい人には、さらに +3 点（同じ合計なら全員）。
 * 提出したカードは公開の捨て札になり、手札は山札から 5 枚まで補充する（最終ラウンドは補充しない）。
 * 最後に残った手札で、同じ数字 3 枚 +8、同じ紋 4 枚 +6（両方の時は高い方）。
 * 順位は得点、目標を達成した回数、残った手札の一番大きい数字の順。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';
import { luckPick, newLuckBook, returnToDeck, type LuckBook } from '../core/luck';

export const ROUNDS = 6;
export const HAND = 5;
export const FIELD = 5;
export const MATCH_PTS = 6;
/** 達成した人のうち、2 枚の数字の合計が一番大きい人への加点 */
export const TOP_PTS = 3;
export const TRIPLE_PTS = 8;
export const FLUSH_PTS = 6;
export const AID_COST = 2;
export const SWAP_MS = 30_000;
export const SUBMIT_MS = 30_000;
export const BREAK_MS = 20_000;

export const SUITS = ['crown', 'key', 'moon', 'star'] as const;
export type Target = 'pair' | 'suit' | 'run';
export const rankOf = (c: number) => (c % 13) + 1;
export const suitOf = (c: number) => Math.floor(c / 13);

/** 2 枚が目標に合うか */
export function meets(target: Target, a: number, b: number): boolean {
  if (a === b) return false;
  if (target === 'pair') return rankOf(a) === rankOf(b);
  if (target === 'suit') return suitOf(a) === suitOf(b);
  return Math.abs(rankOf(a) - rankOf(b)) === 1;
}

/** 手札の中で、目標に合う 2 枚の組をすべて返す */
export function matchesIn(target: Target, hand: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) if (meets(target, hand[i], hand[j])) out.push([hand[i], hand[j]]);
  return out;
}

/** 最後に残った手札の加点 */
export function finalBonus(hand: number[]): { points: number; kind: 'triple' | 'flush' | null } {
  const ranks: Record<number, number> = {};
  const suits: Record<number, number> = {};
  for (const c of hand) { ranks[rankOf(c)] = (ranks[rankOf(c)] ?? 0) + 1; suits[suitOf(c)] = (suits[suitOf(c)] ?? 0) + 1; }
  if (Object.values(ranks).some((n) => n >= 3)) return { points: TRIPLE_PTS, kind: 'triple' };
  if (Object.values(suits).some((n) => n >= 4)) return { points: FLUSH_PTS, kind: 'flush' };
  return { points: 0, kind: null };
}

export type M06Move =
  | { t: 'swap'; hand: number; field: number }
  | { t: 'pass' }
  | { t: 'aid'; card: number }
  | { t: 'submit'; cards: number[] }
  | { t: 'ready' };

export interface M06Log {
  round: number;
  who: CharId;
  kind: 'swap' | 'pass';
  /** 場から取ったカードと、場に出したカード（どちらも公開） */
  took?: number;
  gave?: number;
  /** この手の後の場 */
  field: number[];
}

export interface M06Sub { cards: number[]; ok: boolean; top: boolean }

export interface M06State {
  players: CharId[];
  round: number;
  phase: 'swap' | 'submit' | 'break' | 'done';
  /** このラウンドで手番を終えた人数 */
  turn: number;
  targets: Target[];
  deck: number[];
  discard: number[];
  field: number[];
  hands: Record<string, number[]>;
  scores: Record<string, number>;
  achieved: Record<string, number>;
  aidUsed: Record<string, boolean>;
  subs: Record<string, number[] | undefined>;
  /** ラウンドごとの提出結果（公開） */
  history: Record<string, M06Sub>[];
  bonus: Record<string, { points: number; kind: 'triple' | 'flush' | null }>;
  ready: Record<string, boolean>;
  log: M06Log[];
  rngState: number;
  /** 運の判定の記録と専用の乱数（古い保存には無い。その時は rngState から作る） */
  luck?: LuckBook;
  stage: string;
}

export interface M06View {
  self: CharId | 'spectator';
  players: CharId[];
  round: number;
  rounds: number;
  phase: M06State['phase'];
  target: Target;
  nextTarget: Target | null;
  order: CharId[];
  toMove: CharId | null;
  field: number[];
  hand: number[];
  deckCount: number;
  /** 公開の捨て札 */
  discard: number[];
  scores: Record<string, number>;
  achieved: Record<string, number>;
  aidUsed: boolean;
  submitted: boolean;
  history: Record<string, M06Sub>[];
  bonus: M06State['bonus'];
  /** 終了後に公開される全員の手札 */
  finalHands: Record<string, number[]> | null;
  ready: Record<string, boolean>;
  log: M06Log[];
}

const orderOf = (s: M06State, round = s.round): CharId[] => s.players.map((_, i) => s.players[(i + round) % s.players.length]);

/** 状態に持たせた種から、続きの乱数を作る（補充の山札の切り直しに使う） */
function nextRand(s: M06State): number {
  s.rngState = (Math.imul(s.rngState, 1664525) + 1013904223) >>> 0;
  return s.rngState / 4294967296;
}

function draw(s: M06State): number | undefined {
  refillDeck(s);
  return s.deck.pop();
}

function refillDeck(s: M06State): void {
  if (!s.deck.length && s.discard.length) {
    // 山札が尽きたら、捨て札を切り直して山札にする（手札と場のカードは含まれない）
    const pile = s.discard.splice(0);
    for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(nextRand(s) * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
    s.deck = pile;
  }
}

/**
 * 運の判定つきで 1 枚引く。発動したら、山札の次の 1 枚を 2 つ目の候補にして、本人に有利な方を取る。
 * 評価は本人の手札（hand：このカードを加える前）と公開の目標だけ。取らなかった方は山札の無作為な位置に戻す。
 * 2 つ目の候補は今の山札からだけ出す（捨て札の切り直しは起こさない）。山札が空なら「候補なし」。
 */
function luckyDraw(s: M06State, who: CharId, hand: number[], target: Target, next: Target | null, roundsLeft: number): number | undefined {
  const first = draw(s);
  if (first === undefined) return undefined;
  const b = (s.luck ??= newLuckBook(s.rngState));
  return luckPick(b, who, first, () => s.deck.pop(), (c) => handValue([...hand, c], target, next, roundsLeft), (c) => returnToDeck(b, s.deck, c));
}

// ---- CPU ----

/** 手札の価値：今の目標に合う組があるか、次の目標、最後の加点の見込み */
/** 2 枚の合計が、達成した人の中で一番大きくなる見込み（大まかな目安） */
const topChance = (sum: number) => Math.max(0, Math.min(1, (sum - 12) / 13)) ** 2;

function handValue(hand: number[], target: Target, next: Target | null, roundsLeft: number, topW = 1): number {
  let v = 0;
  const now = matchesIn(target, hand);
  if (now.length) {
    v += MATCH_PTS + topChance(Math.max(...now.map(([a, b]) => rankOf(a) + rankOf(b)))) * TOP_PTS * topW;
    if (next) {
      // 今の組を出した後の残りで、次の目標に近いか
      let bestRest = 0;
      for (const [a, b] of now) {
        const rest = hand.filter((c) => c !== a && c !== b);
        bestRest = Math.max(bestRest, matchesIn(next, rest).length ? 2.2 : 0);
      }
      v += bestRest;
    }
  } else if (next && matchesIn(next, hand).length) v += 1.5;
  const ranks: Record<number, number> = {};
  const suits: Record<number, number> = {};
  for (const c of hand) { ranks[rankOf(c)] = (ranks[rankOf(c)] ?? 0) + 1; suits[suitOf(c)] = (suits[suitOf(c)] ?? 0) + 1; }
  const maxR = Math.max(0, ...Object.values(ranks));
  const maxS = Math.max(0, ...Object.values(suits));
  // 最後の加点は、終わりが近いほど確かになる
  const w = roundsLeft <= 0 ? 1 : roundsLeft === 1 ? 0.75 : 0.35;
  if (maxR >= 3) v += TRIPLE_PTS * w;
  else if (maxS >= 4) v += FLUSH_PTS * w;
  else v += (maxR === 2 ? 1.2 : 0) * w + (maxS === 3 ? 1.4 : 0) * w;
  return v;
}

function m06Ai(v: M06View, ctx: AiCtx): M06Move {
  if (v.phase === 'break') return { t: 'ready' };
  const st = skill(ctx.stats.strategy);
  const mem = skill(ctx.stats.memory); // 副：捨札と公開された札の記憶
  const sd = 0.5 + ctx.noise * 1.2 + (1 - st) * 1.4;
  const last = v.round >= v.rounds - 1;
  const left = v.rounds - 1 - v.round;
  if (v.phase === 'swap') {
    // 合計の大きさを競う加点を、どれだけ意識するか（読める人ほど意識する）
    const tw = 0.3 + st * 0.9;
    const base = handValue(v.hand, v.target, v.nextTarget, left, tw);
    if (!v.aidUsed && base < 2 && ctx.pieces >= AID_COST + 3 && ctx.rng.chance(0.1 + ctx.personality.risk / 500) && ctx.spend(AID_COST, 'M06 山札と交換')) {
      const junk = [...v.hand].sort((a, b) => handValue(v.hand.filter((c) => c !== a), v.target, v.nextTarget, left) - handValue(v.hand.filter((c) => c !== b), v.target, v.nextTarget, left));
      return { t: 'aid', card: junk[junk.length - 1] };
    }
    let best: M06Move = { t: 'pass' };
    let bestVal = base + ctx.rng.gauss(0, sd * 0.4);
    for (const h of v.hand) for (const f of v.field) {
      const nh = v.hand.map((c) => (c === h ? f : c));
      let val = handValue(nh, v.target, v.nextTarget, left, tw);
      // 場に出すカードが、後の人の目標の助けになるなら少し控える（読める人ほど気にする）
      const helps = v.field.filter((x) => x !== f).some((x) => meets(v.target, x, h));
      if (helps) val -= 0.5 * mem;
      val += ctx.rng.gauss(0, sd);
      if (val > bestVal + 0.3) { bestVal = val; best = { t: 'swap', hand: h, field: f }; }
    }
    return best;
  }
  // 提出：目標に合う組のうち、残りの手札の価値が一番高い物を出す。合う組が無ければ、要らないカードを捨てて引き直す
  const pairs = matchesIn(v.target, v.hand);
  if (pairs.length) {
    let best = pairs[0];
    let bestVal = -Infinity;
    for (const pr of pairs) {
      const rest = v.hand.filter((c) => c !== pr[0] && c !== pr[1]);
      const val = (last ? finalBonus(rest).points : handValue(rest, v.nextTarget ?? v.target, null, left - 1)) + topChance(rankOf(pr[0]) + rankOf(pr[1])) * TOP_PTS * (0.3 + st * 0.9) + ctx.rng.gauss(0, sd * 0.5);
      if (val > bestVal) { bestVal = val; best = pr; }
    }
    // 最終ラウンドは、出すと最後の加点（高い方）を失う時だけ出さない
    if (last && finalBonus(v.hand).points > MATCH_PTS + bestVal) return { t: 'submit', cards: [] };
    return { t: 'submit', cards: best };
  }
  if (last) return { t: 'submit', cards: [] };
  const keepVal = (c: number) => handValue(v.hand.filter((x) => x !== c), v.nextTarget ?? v.target, null, left - 1);
  const junk = [...v.hand].sort((a, b) => keepVal(b) - keepVal(a));
  const full = handValue(v.hand, v.nextTarget ?? v.target, null, left - 1);
  const drop = junk.filter((c) => keepVal(c) >= full - 0.2).slice(0, 2);
  return { t: 'submit', cards: drop };
}

export const M06: MatchEngine<M06State, M06Move, M06View> = {
  id: 'm06',
  name: 'クロス・カード',
  kind: 'main',
  minPlayers: 3,
  maxPlayers: 8,
  summary: '手札を場のカードと交換し、ラウンドごとの目標に合う 2 枚を伏せて提出する。最後に残す手札にも加点がある。',
  rules: [
    'カードは 52 枚（1〜13 の数字 × 4 種の紋）。各自 5 枚を持ち、場に 5 枚が公開されます。全 6 ラウンド。',
    '各ラウンド、手番順に 1 回ずつ、手札 1 枚を場の 1 枚と交換できます（パスもできます）。場に出したカードは全員に見えます。手番の順は毎ラウンドずれます。',
    '全員の交換が済んだら、全員同時に、手札から 2 枚までを伏せて提出します。',
    'その 2 枚がラウンドの目標に合えば 6 点。目標は「同じ数字 2 枚」「同じ紋 2 枚」「連続する数字 2 枚」のどれかで、毎ラウンド公開されます。',
    `達成した人のうち、提出した 2 枚の数字の合計が一番大きい人に、さらに +${TOP_PTS} 点（同じ合計なら全員。A は 1、J・Q・K は 11・12・13）。`,
    '提出したカードは、合っても合わなくても公開の捨て札になり、手札は山札から 5 枚まで補充します。要らないカードを捨てて引き直す使い方もできます。',
    '最終ラウンドの後は補充しません。残った手札に、同じ数字 3 枚で +8 点、同じ紋 4 枚で +6 点（両方なら高い方だけ）。',
    '自分の手札は他の人に見せられません。ラウンドの間の 20 秒は話せます。',
    `ピース ${AID_COST} 個で、手札 1 枚を山札の一番上の 1 枚と交換できます（この競技で 1 回。引いた後は戻せません）。`,
    '同点は、目標を達成した回数、残った手札の一番大きい数字の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：交換はパス、提出は「出さない」になります。',
  ],
  init(players, rng) {
    // 乱数を使う順番は導入前と同じ（山札、目標、種）。配る処理は乱数を使わない
    const deck = rng.shuffle(Array.from({ length: 52 }, (_, i) => i));
    const targets = [...rng.shuffle<Target>(['pair', 'suit', 'run']), ...rng.shuffle<Target>(['pair', 'suit', 'run'])];
    const rngState = rng.int(1, 2 ** 31 - 1);
    const luck = newLuckBook(rngState);
    const hands: Record<string, number[]> = {};
    // 山札の上から 1 枚ずつ配る（運の判定は、公開されている最初の 2 つの目標で評価する）
    for (const p of players) {
      hands[p] = [];
      for (let k = 0; k < HAND; k++) {
        const first = deck.shift()!;
        hands[p].push(luckPick(luck, p, first, () => deck.shift(), (c) => handValue([...hands[p], c], targets[0], targets[1], ROUNDS - 1), (c) => returnToDeck(luck, deck, c)));
      }
    }
    const field = deck.splice(0, FIELD);
    const zero = () => Object.fromEntries(players.map((p) => [p, 0]));
    return {
      players: [...players], round: 0, phase: 'swap', turn: 0,
      targets,
      deck, discard: [], field, hands, scores: zero(), achieved: zero(),
      aidUsed: Object.fromEntries(players.map((p) => [p, false])),
      subs: {}, history: [], bonus: {},
      ready: Object.fromEntries(players.map((p) => [p, false])),
      log: [], rngState, luck, stage: '0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'swap') return [orderOf(s)[s.turn]];
    if (s.phase === 'submit') return s.players.filter((p) => !s.subs[p]);
    return s.players.filter((p) => !s.ready[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    const head = `ラウンド ${s.round + 1} / ${ROUNDS}`;
    if (s.phase === 'swap') return { label: `${head}　交換`, time: SWAP_MS };
    if (s.phase === 'submit') return { label: `${head}　提出`, time: SUBMIT_MS };
    return { label: `${head}　結果`, time: BREAK_MS, negotiation: true };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    const hand = s.hands[p];
    if (m.t === 'aid') {
      const mine = s.phase === 'swap' ? orderOf(s)[s.turn] === p : s.phase === 'submit' && !s.subs[p];
      return mine && !s.aidUsed[p] && hand.includes(m.card) && s.deck.length + s.discard.length > 0;
    }
    if (s.phase === 'swap') {
      if (orderOf(s)[s.turn] !== p) return false;
      return m.t === 'pass' || (m.t === 'swap' && hand.includes(m.hand) && s.field.includes(m.field));
    }
    if (s.phase === 'submit') return m.t === 'submit' && !s.subs[p] && Array.isArray(m.cards) && m.cards.length <= 2 && new Set(m.cards).size === m.cards.length && m.cards.every((c) => hand.includes(c));
    return m.t === 'ready' && !s.ready[p];
  },
  defaultMove(s) {
    return s.phase === 'swap' ? { t: 'pass' } : s.phase === 'submit' ? { t: 'submit', cards: [] } : { t: 'ready' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m06: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'aid') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う
      // 今のラウンドの目標と次の目標（公開）で評価する
      const rest = s.hands[p].filter((c) => c !== m.card);
      const got = luckyDraw(s, p, rest, s.targets[s.round], s.round + 1 < ROUNDS ? s.targets[s.round + 1] : null, ROUNDS - 1 - s.round)!;
      s.hands[p] = s.hands[p].map((c) => (c === m.card ? got : c));
      s.discard.push(m.card);
      s.aidUsed[p] = true;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (!s.players.every((x) => s.ready[x])) return;
      s.round += 1;
      s.turn = 0;
      s.phase = 'swap';
      s.stage = `${s.round}-0`;
      return;
    }
    if (m.t === 'swap' || m.t === 'pass') {
      if (m.t === 'swap') {
        s.hands[p] = s.hands[p].map((c) => (c === m.hand ? m.field : c));
        s.field = s.field.map((c) => (c === m.field ? m.hand : c));
        s.log.push({ round: s.round, who: p, kind: 'swap', took: m.field, gave: m.hand, field: [...s.field] });
      } else s.log.push({ round: s.round, who: p, kind: 'pass', field: [...s.field] });
      s.turn += 1;
      s.stage = `${s.round}-${s.turn}`;
      if (s.turn >= s.players.length) {
        s.phase = 'submit';
        s.subs = {};
      }
      return;
    }
    s.subs[p] = [...m.cards];
    if (!s.players.every((x) => s.subs[x])) return;
    const target = s.targets[s.round];
    const lastRound = s.round >= ROUNDS - 1;
    const result: Record<string, M06Sub> = {};
    for (const x of orderOf(s)) {
      const cards = s.subs[x]!;
      const ok = cards.length === 2 && meets(target, cards[0], cards[1]);
      result[x] = { cards, ok, top: false };
      if (ok) { s.scores[x] += MATCH_PTS; s.achieved[x] += 1; }
      s.hands[x] = s.hands[x].filter((c) => !cards.includes(c));
      s.discard.push(...cards);
    }
    const sumOf = (x: CharId) => rankOf(result[x].cards[0]) + rankOf(result[x].cards[1]);
    const okOnes = s.players.filter((x) => result[x].ok);
    const topSum = Math.max(0, ...okOnes.map(sumOf));
    for (const x of okOnes) if (sumOf(x) === topSum) { result[x].top = true; s.scores[x] += TOP_PTS; }
    s.history.push(result);
    s.subs = {};
    if (lastRound) {
      for (const x of s.players) {
        s.bonus[x] = finalBonus(s.hands[x]);
        s.scores[x] += s.bonus[x].points;
      }
      s.phase = 'done';
      return;
    }
    // 補充は次のラウンドの目標と、その次の目標（結果の段階で公開）で評価する
    const nr = s.round + 1;
    for (const x of orderOf(s)) while (s.hands[x].length < HAND) { const c = luckyDraw(s, x, s.hands[x], s.targets[nr], nr + 1 < ROUNDS ? s.targets[nr + 1] : null, ROUNDS - 1 - nr); if (c === undefined) break; s.hands[x].push(c); }
    s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
    s.phase = 'break';
    s.stage = `${s.round}-break`;
  },
  view(s, p) {
    const r = Math.min(s.round, ROUNDS - 1);
    const me = p === 'spectator' ? null : p;
    // 結果の段階では、次のラウンドの目標を「今の目標」として見せる
    const cur = s.phase === 'break' ? Math.min(r + 1, ROUNDS - 1) : r;
    return {
      self: p, players: s.players, round: s.round, rounds: ROUNDS, phase: s.phase,
      target: s.targets[cur],
      nextTarget: cur + 1 < ROUNDS ? s.targets[cur + 1] : null,
      order: orderOf(s, s.phase === 'break' ? r + 1 : r),
      toMove: s.phase === 'swap' ? orderOf(s)[s.turn] : null,
      field: [...s.field],
      hand: me ? [...s.hands[me]] : [],
      deckCount: s.deck.length,
      discard: [...s.discard],
      scores: { ...s.scores }, achieved: { ...s.achieved },
      aidUsed: !!me && s.aidUsed[me],
      submitted: !!me && !!s.subs[me],
      history: s.history,
      bonus: s.bonus,
      finalHands: s.phase === 'done' ? Object.fromEntries(s.players.map((x) => [x, [...s.hands[x]]])) : null,
      ready: { ...s.ready },
      log: s.log,
    };
  },
  ai: m06Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return { ...s.scores };
  },
  ranking(s) {
    const top = (p: CharId) => Math.max(0, ...s.hands[p].map(rankOf));
    return sortGroups(s.players, (p) => s.scores[p] * 100 + s.achieved[p], (p) => top(p));
  },
};

export const TARGET_NAME: Record<Target, string> = { pair: '同じ数字 2 枚', suit: '同じ紋 2 枚', run: '連続する数字 2 枚' };
export const RANK_LABEL = (c: number) => { const r = rankOf(c); return r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r); };
