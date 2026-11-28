/**
 * 市場予測（試作。仮名。docs/market.md、設計書 new_main_matches/new_main_matches_design.md の 5 章）
 *
 * 3〜12 人、全員個人。5 銘柄、6 期。各自コイン 20 枚（競技内だけ。ピースとは別）から始める。
 * 各銘柄の次の値動きは、隠された 2 つの要因（各 −2〜+2）の合計で決まる（1 期 ±4 まで）。
 * 毎期、各自に予報札 2 枚（ある銘柄の要因 1 つの本当の値）。相談の時間に、見せ合う（確か）／言う（嘘もある）で情報をやりとりし、
 * 注文の時間に、銘柄ごとに 3 個まで買う・売るを秘密に決める。全員の注文の差で約定の値段が動く（同じ物を皆で買うと高くつく）。
 * 期の終わりにその期の要因を全部公開するので、口で言った嘘は後から分かることがある。
 * 6 期の後、コイン＋持ち物×最後の値段＝資産の多い順。
 *
 * 公平：全員に同じ枚数の予報札。CPU に渡すのは本人の view だけ（他人の札、未来の要因、他人の持ち物は見えない）。
 * 主人公だけの分岐はない。会話（見せ合い・質問・伝える）の判断は、主人公にも NPC にも同じ決まりで答える。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const GOODS = ['perfume', 'tea', 'watch', 'painting', 'wine'] as const;
export type Good = (typeof GOODS)[number];
export const NG = GOODS.length;
export const PERIODS = 6;
export const FACTORS = 2;
export const START_COINS = 30;
export const MAX_ORDER = 3;
export const MOVE_CAP = 4;
export const IMPACT_CAP = 2;
export const PRICE_MIN = 1;
export const PRICE_MAX = 20;
export const CARDS_PER = 2;
export const TALK_MS = 45_000;
export const ORDER_MS = 40_000;
export const EXTRA_COST = 1;

export interface Card { good: number; k: number }
/** 見せてもらった札（確かな情報） */
export interface Shown { from: CharId; period: number; good: number; k: number; value: number }
/** 口で言われた話。value は「その銘柄に、この値の要因がある」。sign は「上げる（+1）／下げる（−1）要因がある」とだけ言われた時 */
export interface Claim { from: CharId; period: number; good: number; value?: number; sign?: 1 | -1; verdict?: 'ok' | 'lie' }
export type AskAnswer = 'true' | 'lie' | 'vague' | 'refuse';
export interface Respond {
  /** 見せ合いに応じるか。counter は「2 枚なら」（相手に 2 枚を求め、自分も 2 枚見せる） */
  swap: Partial<Record<CharId, 'yes' | 'no' | 'counter'>>;
  /** 銘柄を尋ねられた時の答え方 */
  ask: Partial<Record<CharId, AskAnswer[]>>;
  /** 見せる札の順（自分の札の番号。前から使う） */
  give: number[];
}
export type Req =
  | { kind: 'swap'; to: CharId; give: number[]; keep?: boolean }
  | { kind: 'ask'; to: CharId; good: number }
  | { kind: 'tell'; to: CharId; good: number; value: number };
export interface Offer { id: number; period: number; from: CharId; to: CharId; req: Req; status: 'open' | 'accepted' | 'refused' | 'countered' | 'expired'; answer?: Claim | null; got?: Shown[] }
export interface MkEvent { period: number; kind: 'swap' | 'ask' | 'tell' | 'refuse' | 'counter' | 'lie_found' | 'honest' | 'broken' | 'cancel' | 'keep'; a: CharId; b: CharId; good?: number }

export type MkMove =
  | { t: 'plan'; req: Req[]; respond: Respond }
  | { t: 'ready' }
  | { t: 'extra' }
  | { t: 'swap'; to: CharId; give: number[]; keep?: boolean }
  | { t: 'ask'; to: CharId; good: number }
  | { t: 'tell'; to: CharId; good: number; value: number }
  | { t: 'reply'; offer: number; accept: boolean; give?: number[]; answer?: { value?: number; sign?: 1 | -1 } | null }
  | { t: 'cancel'; to: CharId }
  | { t: 'order'; q: number[] };

export interface MkLast { period: number; exec: number[]; net: number[]; change: number[]; factors: number[][]; prices: number[] }

export interface MkState {
  players: CharId[];
  period: number;
  phase: 'talk' | 'order' | 'done';
  prices: number[];
  history: number[][];
  factors: number[][][];
  cards: Record<string, Card[][]>;
  extraUsed: Record<string, boolean>;
  coins: Record<string, number>;
  holdings: Record<string, number[]>;
  orders: Record<string, number[] | undefined>;
  ready: Record<string, boolean>;
  plans: Record<string, { req: Req[]; respond: Respond } | undefined>;
  shown: Record<string, Shown[]>;
  claims: Record<string, Claim[]>;
  offers: Offer[];
  nextOffer: number;
  /** 同じ期に同じ相手へ同じ銘柄を尋ねた時の答え（繰り返して得をしない） */
  asked: Record<string, Claim | null>;
  /** 「次の期も見せ合おう」の約束（2 人の組の鍵 → 始めた期） */
  partners: Record<string, number>;
  events: MkEvent[];
  last: MkLast | null;
  assets: Record<string, number[]>;
  traded: Record<string, number>;
  rngState: number;
}

export interface MkView {
  self: CharId | 'spectator';
  players: CharId[];
  period: number;
  periods: number;
  phase: MkState['phase'];
  prices: number[];
  history: number[][];
  coins: number;
  holdings: number[];
  /** 今の期の自分の予報札（値つき） */
  cards: (Card & { value: number })[];
  extraUsed: boolean;
  /** 今の期に見せてもらった札 */
  shown: Shown[];
  /** 今までに言われた話（過去の期は、公開された要因と照らした結果つき） */
  claims: Claim[];
  /** 自分あての、まだ返事をしていない申し出 */
  inbox: Offer[];
  /** 自分が出した申し出（今の期） */
  sent: Offer[];
  /** 公開の情報 */
  last: MkLast | null;
  assets: Record<string, number[]>;
  pastFactors: number[][][];
  /** 自分に嘘を言ったと分かっている相手 */
  liars: CharId[];
  partners: CharId[];
  ready: Record<string, boolean>;
  submitted: boolean;
  /** 自分に関わる出来事（約束を破られた、嘘が分かった、など） */
  events: MkEvent[];
  impactK: number;
}

const key2 = (a: CharId, b: CharId) => [a, b].sort().join('|');
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const impactK = (n: number) => Math.max(2, Math.ceil(n / 3));
export const assetOf = (s: MkState, p: CharId, prices = s.prices) => s.coins[p] + s.holdings[p].reduce((n, q, g) => n + q * prices[g], 0);
export const valueOf = (s: MkState, c: Card) => s.factors[s.period][c.good][c.k];

/** 状態に持たせる簡単な乱数（嘘の値や札の配り方に使う。保存しても続きから同じになる） */
function rnd(s: MkState): number {
  let x = s.rngState | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.rngState = x | 0;
  return ((x >>> 0) % 100000) / 100000;
}

/** 札を配る：15 個の要因を均等に。同じ人に同じ要因は配らない */
function deal(s: MkState, rng: Rng, period: number): void {
  const all: Card[] = [];
  for (let g = 0; g < NG; g++) for (let k = 0; k < FACTORS; k++) all.push({ good: g, k });
  let deck: Card[] = [];
  for (const p of rng.shuffle([...s.players])) {
    const mine: Card[] = [];
    for (let i = 0; i < CARDS_PER; i++) {
      if (!deck.length) deck = rng.shuffle([...all]);
      let j = deck.findIndex((c) => !mine.some((m) => m.good === c.good && m.k === c.k));
      if (j < 0) j = 0;
      mine.push(deck.splice(j, 1)[0]);
    }
    s.cards[p][period] = mine;
  }
}

function startTalk(s: MkState): void {
  s.phase = 'talk';
  s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
  s.plans = {};
  s.orders = {};
}

/** 申し出に、相手の方針（NPC は相談の始めに出した方針、主人公は返事）で答える */
function answerAsk(s: MkState, from: CharId, to: CharId, good: number, how: AskAnswer): Claim | null {
  const keyA = `${s.period}|${from}|${to}|${good}`;
  if (keyA in s.asked) return s.asked[keyA];
  const known = knownValues(s, to, good);
  let out: Claim | null = null;
  if (how === 'refuse') out = null;
  else if (how === 'vague') out = known.length ? { from: to, period: s.period, good, sign: (known.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1) } : null;
  else if (how === 'true') out = known.length ? { from: to, period: s.period, good, value: [...known].sort((a, b) => Math.abs(b) - Math.abs(a))[0] } : null;
  else {
    // 嘘：知っている値の逆か、知らなければ大きめの値をでっち上げる
    const v = known.length ? -[...known].sort((a, b) => Math.abs(b) - Math.abs(a))[0] || (rnd(s) < 0.5 ? 2 : -2) : rnd(s) < 0.5 ? 2 : -2;
    out = { from: to, period: s.period, good, value: v };
  }
  s.asked[keyA] = out;
  if (out) s.claims[from].push(out);
  s.events.push({ period: s.period, kind: out ? 'ask' : 'refuse', a: from, b: to, good });
  return out;
}

/** p が今の期に確かに知っている、その銘柄の要因の値（自分の札と、見せてもらった札） */
export function knownValues(s: MkState, p: CharId, good: number): number[] {
  const seen = new Map<number, number>();
  for (const c of s.cards[p][s.period] ?? []) if (c.good === good) seen.set(c.k, s.factors[s.period][good][c.k]);
  for (const x of s.shown[p]) if (x.period === s.period && x.good === good) seen.set(x.k, x.value);
  return [...seen.values()];
}

function giveCards(s: MkState, from: CharId, idx: number[], n: number): Card[] {
  const mine = s.cards[from][s.period] ?? [];
  const order = [...idx.filter((i) => i >= 0 && i < mine.length), ...mine.map((_, i) => i)];
  return [...new Set(order)].slice(0, n).map((i) => mine[i]);
}

function show(s: MkState, from: CharId, to: CharId, cards: Card[]): Shown[] {
  const out = cards.map((c) => ({ from, period: s.period, good: c.good, k: c.k, value: valueOf(s, c) }));
  s.shown[to].push(...out);
  return out;
}

/** 見せ合いを成立させる（n 枚ずつ） */
function doSwap(s: MkState, o: Offer, n: number, giveBack: number[]): void {
  const req = o.req as Extract<Req, { kind: 'swap' }>;
  show(s, o.from, o.to, giveCards(s, o.from, req.give, n));
  o.got = show(s, o.to, o.from, giveCards(s, o.to, giveBack, n));
  o.status = 'accepted';
  s.events.push({ period: s.period, kind: 'swap', a: o.from, b: o.to });
  if (req.keep) { s.partners[key2(o.from, o.to)] = s.period; s.events.push({ period: s.period, kind: 'keep', a: o.from, b: o.to }); }
}

/** 申し出を出す。相手が方針を出していれば（NPC）その場で答える。まだなら返事待ち（主人公の返事、または相談の終わりに方針で答える） */
function place(s: MkState, from: CharId, req: Req, now = true): Offer {
  const o: Offer = { id: s.nextOffer++, period: s.period, from, to: req.to, req, status: 'open' };
  s.offers.push(o);
  if (now) answerOffer(s, o);
  return o;
}

function answerOffer(s: MkState, o: Offer): void {
  if (o.status !== 'open') return;
  const { from, req } = o;
  if (req.kind === 'tell') {
    // 伝えるだけの話は、返事が要らない。言われた側の記録に残る（本当かどうかは期の終わりに分かる）
    s.claims[req.to].push({ from, period: s.period, good: req.good, value: req.value });
    o.status = 'accepted';
    s.events.push({ period: s.period, kind: 'tell', a: from, b: req.to, good: req.good });
    return;
  }
  const plan = s.plans[o.to];
  if (!plan) return;
  if (req.kind === 'swap') {
    const r = plan.respond.swap[from] ?? 'no';
    if (r === 'yes' || (r === 'counter' && req.give.length >= 2)) doSwap(s, o, req.give.length >= 2 ? 2 : 1, plan.respond.give);
    else if (r === 'counter') { o.status = 'countered'; s.events.push({ period: s.period, kind: 'counter', a: from, b: req.to }); }
    else { o.status = 'refused'; s.events.push({ period: s.period, kind: 'refuse', a: from, b: req.to }); }
  } else if (req.kind === 'ask') {
    const how = plan.respond.ask[from]?.[req.good] ?? 'refuse';
    o.answer = answerAsk(s, from, req.to, req.good, how);
    o.status = o.answer ? 'accepted' : 'refused';
  }
}

/** 同じ期に、同じ相手へ同じ種類の申し出は 1 回だけ（断られた提案を繰り返せない。中身を変えた対案は出せる） */
export function canOffer(s: MkState, from: CharId, req: Req): boolean {
  if (from === req.to || !s.players.includes(req.to)) return false;
  return !s.offers.some((o) => o.period === s.period && o.from === from && o.to === req.to && o.req.kind === req.kind
    && (req.kind !== 'ask' || (o.req as { good: number }).good === req.good)
    && (req.kind !== 'swap' || o.status !== 'countered' || (o.req as { give: number[] }).give.length >= req.give.length)
    && (req.kind !== 'tell' || (o.req as { good: number }).good === req.good));
}

function resolveTalk(s: MkState): void {
  // NPC 同士（と主人公への申し出）を出す。主人公あての申し出で返事のない物は、断られた扱い（約束破りにはしない）
  // 方針どうしの申し出は、全員がそろってから同時に答える（先に方針を出した人が得をしない）
  for (const o of s.offers) if (o.period === s.period && o.status === 'open') answerOffer(s, o);
  for (const o of s.offers) if (o.period === s.period && o.status === 'open') o.status = 'expired';
  // 見せ合いの約束：この期に、約束の相手と見せ合わなかった時。申し出を断った方が破った側
  for (const [k, since] of Object.entries(s.partners)) {
    if (since >= s.period) continue;
    const [a, b] = k.split('|') as CharId[];
    if (!s.players.includes(a) || !s.players.includes(b)) continue;
    const done = s.offers.some((o) => o.period === s.period && o.req.kind === 'swap' && o.status === 'accepted' && key2(o.from, o.to) === k);
    if (done) { s.partners[k] = s.period; continue; }
    const asked = s.offers.find((o) => o.period === s.period && o.req.kind === 'swap' && key2(o.from, o.to) === k);
    const breaker = asked ? asked.to : null;
    delete s.partners[k];
    if (breaker) s.events.push({ period: s.period, kind: 'broken', a: breaker, b: breaker === a ? b : a });
    else s.events.push({ period: s.period, kind: 'cancel', a, b });
  }
  s.phase = 'order';
  s.orders = {};
}

function resolveOrders(s: MkState): void {
  const n = s.players.length;
  const K = impactK(n);
  const net = GOODS.map((_, g) => s.players.reduce((a, p) => a + (s.orders[p]?.[g] ?? 0), 0));
  const exec = GOODS.map((_, g) => clamp(s.prices[g] + clamp(Math.round(net[g] / K), -IMPACT_CAP, IMPACT_CAP), PRICE_MIN, PRICE_MAX));
  for (const p of s.players) {
    const q = s.orders[p] ?? GOODS.map(() => 0);
    q.forEach((x, g) => {
      if (!x) return;
      s.coins[p] -= x * exec[g];
      s.holdings[p][g] += x;
      s.traded[p] += Math.abs(x);
    });
  }
  const f = s.factors[s.period];
  const change = GOODS.map((_, g) => clamp(f[g].reduce((a, b) => a + b, 0), -MOVE_CAP, MOVE_CAP));
  const prices = GOODS.map((_, g) => clamp(s.prices[g] + change[g], PRICE_MIN, PRICE_MAX));
  s.last = { period: s.period, exec, net, change: prices.map((x, g) => x - s.prices[g]), factors: f.map((x) => [...x]), prices };
  s.prices = prices;
  s.history.push([...prices]);
  for (const p of s.players) s.assets[p].push(assetOf(s, p));
  // 期の要因が公開されたので、言われた話と照らす（言われた本人には分かる）
  for (const p of s.players) for (const c of s.claims[p]) {
    if (c.period !== s.period || c.verdict) continue;
    const ok = c.value !== undefined ? f[c.good].includes(c.value) : f[c.good].some((v) => Math.sign(v) === c.sign);
    c.verdict = ok ? 'ok' : 'lie';
    s.events.push({ period: s.period, kind: ok ? 'honest' : 'lie_found', a: c.from, b: p, good: c.good });
  }
  if (s.period >= PERIODS - 1) { s.phase = 'done'; return; }
  s.period += 1;
  startTalk(s);
}

/** p が買える量の上限の確認（約定が最も高くなった時でも払える） */
export function affordable(s: Pick<MkState, 'prices'>, coins: number, holdings: number[], q: number[]): boolean {
  let cost = 0;
  for (let g = 0; g < NG; g++) {
    if (!Number.isInteger(q[g]) || Math.abs(q[g]) > MAX_ORDER) return false;
    if (q[g] < 0 && -q[g] > holdings[g]) return false;
    if (q[g] > 0) cost += q[g] * Math.min(PRICE_MAX, s.prices[g] + IMPACT_CAP);
    if (q[g] < 0) cost += q[g] * Math.max(PRICE_MIN, s.prices[g] - IMPACT_CAP);
  }
  return cost <= coins;
}

// ---------------------------------------------------------------- CPU

/** 本人の view から、銘柄ごとの値動きの見込み */
export function estimate(v: MkView, ctx: AiCtx, opts: { useInfo?: boolean } = {}): number[] {
  const useInfo = opts.useInfo !== false;
  return GOODS.map((_, g) => {
    const exact = new Map<number, number>();
    for (const c of v.cards) if (c.good === g) exact.set(c.k, c.value);
    if (useInfo) for (const x of v.shown) if (x.good === g) exact.set(x.k, x.value);
    let e = [...exact.values()].reduce((a, b) => a + b, 0);
    if (useInfo) {
      const unknown = FACTORS - exact.size;
      const cs = v.claims.filter((c) => c.period === v.period && c.good === g && !v.liars.includes(c.from));
      let used = 0;
      for (const c of cs) {
        if (used >= unknown) break;
        if (ctx.rng.chance(ctx.memoryLoss)) continue;
        const r = ctx.relation(c.from);
        const w = clamp(0.25 + (r.trust - 40) / 100 - r.hostility / 200 + (v.partners.includes(c.from) ? 0.2 : 0), 0, 0.85);
        e += w * (c.value ?? (c.sign ?? 0) * 1.2);
        used++;
      }
    }
    return e;
  });
}

function orderAi(v: MkView, ctx: AiCtx, useInfo = true): number[] {
  const logic = skill(ctx.stats.logic);
  const strat = skill(ctx.stats.strategy);
  const est = estimate(v, ctx, { useInfo }).map((e) => e + ctx.rng.gauss(0, 0.35 + ctx.noise * 0.6));
  const risk = ctx.personality.risk / 100;
  // 同じ物を皆が買うと高くつく。人数が多いほど、知っている人も多いと見て少し控える
  const crowd = 0.3 + (1 - strat) * 0.3 + (v.players.length / 12) * 0.3;
  const q = GOODS.map(() => 0);
  const last = v.period >= PERIODS - 1;
  let coins = v.coins;
  const order = GOODS.map((_, g) => g).sort((a, b) => est[b] - est[a]);
  for (const g of order) {
    const e = est[g];
    if (e <= -0.8 && v.holdings[g] > 0) q[g] = -Math.min(v.holdings[g], MAX_ORDER, Math.max(1, Math.round(-e)));
    else if (e >= crowd + 0.5 - risk * 0.4) {
      const want = clamp(Math.round((e - crowd * 0.5) * (0.6 + risk * 0.5 + logic * 0.3)), 1, MAX_ORDER);
      const unit = Math.min(PRICE_MAX, v.prices[g] + IMPACT_CAP);
      const can = Math.floor(coins / unit);
      q[g] = Math.max(0, Math.min(want, can));
      coins -= q[g] * unit;
    }
  }
  if (last) for (let g = 0; g < NG; g++) if (est[g] < -0.3 && v.holdings[g] > 0 && q[g] >= 0) q[g] = -Math.min(v.holdings[g], MAX_ORDER);
  return q;
}

/** 相談の方針：誰に何を持ちかけ、誰に何を答えるか（本人の view と関係だけで決める） */
function planAi(v: MkView, ctx: AiCtx): { req: Req[]; respond: Respond } {
  const me = ctx.self;
  const P = ctx.personality;
  const others = v.players.filter((p) => p !== me);
  const myAsset = v.assets[me]?.at(-1) ?? START_COINS;
  const rival = (p: CharId) => (v.assets[p]?.at(-1) ?? START_COINS) >= myAsset;
  const rv = (p: CharId) => ctx.relation(p);
  // 見せる札：小さい値の札から（大事な情報は手元に残す）。約束の相手には大きい札から
  // 欲の深い人は小さい札から、気前のよい人（忠誠と道徳が高い）は大きい札から見せる
  const generous = (P.loyalty + P.morality) / 2 - P.greed >= 30;
  const give = v.cards.map((c, i) => ({ i, a: Math.abs(c.value) + ctx.rng.gauss(0, 0.6) })).sort((a, b) => (generous ? b.a - a.a : a.a - b.a)).map((x) => x.i);
  const respond: Respond = { swap: {}, ask: {}, give };
  const share = (P.loyalty - 50) / 120 + (P.morality - 50) / 160 - (P.ambition - 50) / 220 - (P.greed - 50) / 260;
  for (const p of others) {
    const r = rv(p);
    const liar = v.liars.includes(p);
    // 作戦時間に協力を約束した相手も、見せ合いの相手として扱う
    const partner = v.partners.includes(p) || ctx.allies.includes(p);
    let pr = 0.56 + share + (r.trust - 45) / 90 + (r.like - 40) / 160 - r.hostility / 70 + (partner ? 0.4 : 0) - (liar ? 0.7 : 0) + ctx.rng.gauss(0, 0.12);
    // 期が進むほど、手の内を見せる損が大きい（残りの期が少ない時は、見せて得る物も少ない）
    if (v.period >= PERIODS - 1) pr -= 0.1;
    respond.swap[p] = pr > 0.5 ? 'yes' : pr > 0.25 && P.greed >= 55 ? 'counter' : 'no';
    respond.ask[p] = GOODS.map(() => {
      const honest = 0.35 + (P.morality - 50) / 90 + (r.trust - 45) / 120 - r.hostility / 90 - (liar ? 0.4 : 0);
      const lie = (100 - P.morality) / 100 * (skill(ctx.stats.acting) * 0.8) * (rival(p) ? 1 : 0.4) * (P.ambition / 100);
      const x = ctx.rng.next();
      if (x < lie * 0.6) return 'lie';
      if (x < lie * 0.6 + Math.max(0, honest)) return 'true';
      return x < 0.85 ? 'vague' : 'refuse';
    });
  }
  // 持ちかける：見せ合い 1 件（交渉の上手な人は 2 件）。約束の相手を優先
  const req: Req[] = [];
  const cands = others.filter((p) => !v.liars.includes(p)).map((p) => ({ p, s: rv(p).trust * 0.6 + rv(p).like * 0.3 - rv(p).hostility + (v.partners.includes(p) ? 60 : ctx.allies.includes(p) ? 40 : 0) + ctx.rng.gauss(0, 14) })).sort((a, b) => b.s - a.s);
  const nSwap = 1 + (ctx.stats.negotiation >= 7 ? 1 : 0) + (v.players.length >= 8 && ctx.rng.chance(0.5) ? 1 : 0);
  const wantInfo = 0.7 + skill(ctx.stats.strategy) * 0.25 - (P.ambition - 50) / 300;
  for (const c of cands.slice(0, nSwap)) {
    if (!v.partners.includes(c.p) && !ctx.rng.chance(wantInfo)) continue;
    const keep = v.partners.includes(c.p) || (P.loyalty >= 60 && ctx.rng.chance(0.4));
    req.push({ kind: 'swap', to: c.p, give: v.partners.includes(c.p) ? [...give].reverse() : give, keep });
  }
  // 尋ねる：自分の情報がいちばん薄い銘柄を、信頼できる 1 人に
  const est = estimate(v, ctx);
  const thin = GOODS.map((_, g) => g).sort((a, b) => Math.abs(est[a]) - Math.abs(est[b]))[0];
  const askTo = cands.find((c) => !req.some((r) => r.to === c.p));
  if (askTo && ctx.rng.chance(0.55)) req.push({ kind: 'ask', to: askTo.p, good: thin });
  // 言う：道徳が低く演技のうまい人は、上位の相手に「下がる銘柄が上がる」と吹き込むことがある
  const lieP = (100 - P.morality) / 100 * skill(ctx.stats.acting) * (P.ambition / 100) * 0.6;
  const bad = v.cards.filter((c) => c.value <= -1).sort((a, b) => a.value - b.value)[0];
  const top = others.filter((p) => rival(p) && !req.some((r) => r.to === p)).sort((a, b) => (v.assets[b]?.at(-1) ?? 0) - (v.assets[a]?.at(-1) ?? 0))[0];
  if (bad && top && ctx.rng.chance(lieP)) req.push({ kind: 'tell', to: top, good: bad.good, value: 2 });
  // 善意で教える：道徳と忠誠の高い人は、親しい相手に本当の大きい札を伝える
  const good = v.cards.filter((c) => Math.abs(c.value) >= 2)[0];
  const friend = cands.find((c) => !req.some((r) => r.to === c.p) && rv(c.p).like >= 55);
  if (good && friend && P.morality >= 75 && P.loyalty >= 75 && ctx.rng.chance(0.3)) req.push({ kind: 'tell', to: friend.p, good: good.good, value: good.value });
  return { req, respond };
}

function mkAi(v: MkView, ctx: AiCtx): MkMove {
  if (v.phase === 'talk') {
    // ピース 1 個で予報札を 1 枚足す（任意。残りのピースに余裕がある時だけ）
    if (!v.extraUsed && v.period >= 1 && v.period <= 3 && ctx.pieces >= EXTRA_COST + 3 && ctx.rng.chance(0.1 + ctx.personality.risk / 700) && ctx.spend(EXTRA_COST, '市場予測 予報札')) return { t: 'extra' };
    return { t: 'plan', ...planAi(v, ctx) };
  }
  if (v.phase === 'order') return { t: 'order', q: orderAi(v, ctx, !(ctx as AiCtx & { _noInfo?: boolean })._noInfo) };
  return { t: 'ready' };
}

function viewOf(s: MkState, p: CharId | 'spectator'): MkView {
  const me = p === 'spectator' ? null : p;
  const per = Math.min(s.period, PERIODS - 1);
  const evs = me ? s.events.filter((e) => e.a === me || e.b === me) : [];
  return {
    self: p,
    players: s.players,
    period: s.period,
    periods: PERIODS,
    phase: s.phase,
    prices: [...s.prices],
    history: s.history.map((x) => [...x]),
    coins: me ? s.coins[me] : 0,
    holdings: me ? [...s.holdings[me]] : GOODS.map(() => 0),
    cards: me && s.phase !== 'done' ? (s.cards[me][per] ?? []).map((c) => ({ ...c, value: s.factors[per][c.good][c.k] })) : [],
    extraUsed: me ? !!s.extraUsed[me] : true,
    shown: me ? s.shown[me].filter((x) => x.period === per) : [],
    claims: me ? s.claims[me].map((c) => ({ ...c })) : [],
    inbox: me ? s.offers.filter((o) => o.to === me && o.status === 'open' && o.period === s.period) : [],
    sent: me ? s.offers.filter((o) => o.from === me && o.period === s.period) : [],
    last: s.last,
    assets: Object.fromEntries(s.players.map((x) => [x, [...s.assets[x]]])),
    pastFactors: s.factors.slice(0, s.phase === 'done' ? PERIODS : s.period).map((f) => f.map((x) => [...x])),
    liars: me ? [...new Set(s.claims[me].filter((c) => c.verdict === 'lie').map((c) => c.from))] : [],
    partners: me ? Object.keys(s.partners).filter((k) => k.split('|').includes(me)).map((k) => k.split('|').find((x) => x !== me) as CharId) : [],
    ready: { ...s.ready },
    submitted: me ? (s.phase === 'order' ? !!s.orders[me] : !!s.ready[me]) : true,
    events: evs,
    impactK: impactK(s.players.length),
  };
}

export const MK: MatchEngine<MkState, MkMove, MkView> = {
  id: 'mk',
  name: '市場予測（試作）',
  kind: 'main',
  minPlayers: 3,
  maxPlayers: 12,
  summary: '予報を集めて、5 つの銘柄の値動きを読み、売り買いで資産を増やす。情報は見せ合えば確か、口で聞いた話は嘘かもしれない。',
  rules: [
    `全 ${PERIODS} 期。各自コイン ${START_COINS} 枚から始めます（この競技の中だけのコインです。ピースとは別）。`,
    `銘柄は 5 つ。各銘柄の値動きは、隠された ${FACTORS} つの要因（各 −2〜+2）の合計で決まります。1 期に動くのは ±${MOVE_CAP} まで、値段は ${PRICE_MIN}〜${PRICE_MAX}。`,
    `毎期、各自に予報札 ${CARDS_PER} 枚が配られます。1 枚で、ある銘柄の要因 1 つの本当の値が分かります。配る枚数は全員同じです。`,
    `相談の時間（${TALK_MS / 1000} 秒）：見せ合い（札を本当に見せる。確か）、質問と伝える（口で言う。嘘もある）ができます。同じ期に同じ相手へ同じ申し出は 1 回だけです。`,
    `注文の時間（${ORDER_MS / 1000} 秒）：銘柄ごとに ${MAX_ORDER} 個まで、買う・売るを秘密に決めます。持っていない物は売れません。`,
    `全員の買いと売りの差で約定の値段が動きます（${impactK(12)}〜${impactK(3)} 個の差ごとに 1、最大 ±${IMPACT_CAP}）。同じ物を皆で買うと高く買うことになります。買った人も売った人も、その期の約定の値段で取引します。`,
    '期の終わりに、その期の要因 2 つがすべて公開されます。口で言われた話が要因と合わなければ、嘘だったと分かります。',
    `ピース ${EXTRA_COST} 個で、その期の予報札を 1 枚足せます（この競技で 1 回だけ。条件は全員同じ）。`,
    `${PERIODS} 期の後、コイン＋持ち物×最後の値段＝資産の多い順。同点は、コインの多い方、取引の数が少ない方の順。それでも同じなら共通決定戦です。`,
    '時間切れの場合：相談はそこで終わり（返事をしていない申し出は断った扱い）、注文は「何もしない」になります。',
  ],
  init(players, rng) {
    const prices = GOODS.map(() => rng.int(6, 9));
    const factors = Array.from({ length: PERIODS }, () => GOODS.map(() => Array.from({ length: FACTORS }, () => rng.int(-2, 2))));
    const s: MkState = {
      players: [...players],
      period: 0,
      phase: 'talk',
      prices,
      history: [[...prices]],
      factors,
      cards: Object.fromEntries(players.map((p) => [p, []])),
      extraUsed: {},
      coins: Object.fromEntries(players.map((p) => [p, START_COINS])),
      holdings: Object.fromEntries(players.map((p) => [p, GOODS.map(() => 0)])),
      orders: {},
      ready: {},
      plans: {},
      shown: Object.fromEntries(players.map((p) => [p, []])),
      claims: Object.fromEntries(players.map((p) => [p, []])),
      offers: [],
      nextOffer: 1,
      asked: {},
      partners: {},
      events: [],
      last: null,
      assets: Object.fromEntries(players.map((p) => [p, [START_COINS]])),
      traded: Object.fromEntries(players.map((p) => [p, 0])),
      rngState: rng.int(1, 2 ** 30),
    };
    for (let t = 0; t < PERIODS; t++) deal(s, rng, t);
    startTalk(s);
    return s;
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'talk') return s.players.filter((p) => !s.ready[p]);
    return s.players.filter((p) => !s.orders[p]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    const head = `第 ${s.period + 1} 期 / ${PERIODS}`;
    return s.phase === 'talk' ? { label: `${head}　相談`, time: TALK_MS } : { label: `${head}　注文`, time: ORDER_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'talk') {
      if (s.ready[p]) return false;
      switch (m.t) {
        case 'ready': return true;
        case 'plan': return Array.isArray(m.req) && !!m.respond && typeof m.respond === 'object';
        case 'extra': return !s.extraUsed[p];
        case 'swap': return Array.isArray(m.give) && m.give.length >= 1 && m.give.length <= 2 && m.give.every((i) => Number.isInteger(i) && i >= 0 && i < (s.cards[p][s.period]?.length ?? 0)) && canOffer(s, p, { kind: 'swap', to: m.to, give: m.give });
        case 'ask': return Number.isInteger(m.good) && m.good >= 0 && m.good < NG && canOffer(s, p, { kind: 'ask', to: m.to, good: m.good });
        case 'tell': return Number.isInteger(m.good) && m.good >= 0 && m.good < NG && Number.isInteger(m.value) && Math.abs(m.value) <= 2 && canOffer(s, p, { kind: 'tell', to: m.to, good: m.good, value: m.value });
        case 'reply': { const o = s.offers.find((x) => x.id === m.offer); return !!o && o.to === p && o.status === 'open' && o.period === s.period; }
        case 'cancel': return key2(p, m.to) in s.partners;
        default: return false;
      }
    }
    if (m.t !== 'order' || !Array.isArray(m.q) || m.q.length !== NG || s.orders[p]) return false;
    return affordable(s, s.coins[p], s.holdings[p], m.q);
  },
  defaultMove(s) {
    return s.phase === 'order' ? { t: 'order', q: GOODS.map(() => 0) } : { t: 'ready' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`mk: illegal move ${JSON.stringify(m).slice(0, 100)}`);
    if (m.t === 'order') {
      s.orders[p] = [...m.q];
      if (s.players.every((x) => s.orders[x])) resolveOrders(s);
      return;
    }
    switch (m.t) {
      case 'plan':
        s.plans[p] = { req: [], respond: m.respond };
        // 申し出は返事待ちとして出す（主人公あては画面に届く。NPC あては相談の終わりに相手の方針で答える）
        for (const r of m.req) if (r && s.players.includes(r.to) && r.to !== p && canOffer(s, p, r)) place(s, p, r, r.kind === 'tell');
        s.ready[p] = true;
        break;
      case 'ready':
        s.ready[p] = true;
        break;
      case 'extra': {
        // 代金は呼び出し側（画面と CPU）が同じ価格で払う。ここでは 1 回だけという制限を守る
        s.extraUsed[p] = true;
        const mine = s.cards[p][s.period];
        const free: Card[] = [];
        for (let g = 0; g < NG; g++) for (let k = 0; k < FACTORS; k++) if (!mine.some((c) => c.good === g && c.k === k)) free.push({ good: g, k });
        mine.push(free[Math.floor(rnd(s) * free.length)]);
        return;
      }
      case 'swap': place(s, p, { kind: 'swap', to: m.to, give: m.give, keep: m.keep }); return;
      case 'ask': place(s, p, { kind: 'ask', to: m.to, good: m.good }); return;
      case 'tell': place(s, p, { kind: 'tell', to: m.to, good: m.good, value: m.value }); return;
      case 'cancel':
        delete s.partners[key2(p, m.to)];
        s.events.push({ period: s.period, kind: 'cancel', a: p, b: m.to });
        return;
      case 'reply': {
        const o = s.offers.find((x) => x.id === m.offer)!;
        if (!m.accept) { o.status = 'refused'; s.events.push({ period: s.period, kind: 'refuse', a: o.from, b: p }); return; }
        if (o.req.kind === 'swap') doSwap(s, o, o.req.give.length >= 2 ? 2 : 1, m.give ?? []);
        else if (o.req.kind === 'ask') {
          const a = m.answer;
          const c: Claim | null = a && (a.value !== undefined || a.sign) ? { from: p, period: s.period, good: o.req.good, value: a.value, sign: a.value === undefined ? a.sign : undefined } : null;
          if (c) s.claims[o.from].push(c);
          s.asked[`${s.period}|${o.from}|${p}|${o.req.good}`] = c;
          o.answer = c;
          o.status = c ? 'accepted' : 'refused';
          s.events.push({ period: s.period, kind: c ? 'ask' : 'refuse', a: o.from, b: p, good: o.req.good });
        } else o.status = 'accepted';
        return;
      }
    }
    if (s.players.every((x) => s.ready[x])) resolveTalk(s);
  },
  view: viewOf,
  ai: mkAi,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p) => [p, assetOf(s, p)]));
  },
  ranking(s) {
    return sortGroups(s.players, (p) => assetOf(s, p) * 1000 + s.coins[p], (p) => -s.traded[p]);
  },
};
