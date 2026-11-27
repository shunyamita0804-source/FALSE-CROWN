/**
 * M02 黄金の競売（11人、20出品）
 * 資金100ずつ。出品ごとに全員が同時に秘密入札し、最高額の1人が落札する。
 * 5出品ごとに、資金と商品を双方の同意で交換できる。
 * v02 改訂：残金得点は 20 につき 1 点（最大 5 点）。同額首位の再入札は 1 回、解消しなければ流札。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { sortGroups, type AiCtx, type MatchEngine } from './types';

export const ITEMS = ['crown', 'gem', 'key', 'book', 'coin'] as const;
export type Item = (typeof ITEMS)[number];
export const ITEM_POINTS: Record<Item, number> = { crown: 8, gem: 5, key: 3, book: 4, coin: 2 };
export const START_FUNDS = 100;
export const LOTS_EACH = 4;
export const TRADE_EVERY = 5;
export const OFFERS_PER_TRADE = 2;
export const SET_CROWN_GEM = 5;
export const SET_KEY_BOOK = 6;
export const SET_COINS = 8;
export const MONEY_STEP = 20;
export const MONEY_MAX = 5;

export type Bag = Record<Item, number>;
export interface Side { money: number; items: Partial<Record<Item, number>> }
export interface Offer { from: CharId; to: CharId; give: Side; take: Side }

export type M02Move =
  | { t: 'bid'; amount: number }
  | { t: 'offer'; to: CharId; give: Side; take: Side }
  | { t: 'answer'; accept: boolean }
  | { t: 'ready' };

export interface LotResult {
  lot: number;
  item: Item;
  winner: CharId | null;
  price: number;
  bids: Record<string, number>;
  /** 同額首位で再入札になった参加者と、その再入札額 */
  rebid?: Record<string, number>;
}

export interface TradeLog extends Offer { accepted: boolean; after: number }

export interface M02State {
  players: CharId[];
  funds: Record<string, number>;
  items: Record<string, Bag>;
  lots: Item[];
  /** 現在の出品番号（0 始まり） */
  lot: number;
  stage: 'bid' | 'rebid' | 'trade' | 'done';
  bids: Record<string, number>;
  tied: CharId[];
  rebidMin: number;
  firstBids: Record<string, number>;
  history: LotResult[];
  ready: Record<string, boolean>;
  offer: Offer | null;
  offersLeft: Record<string, number>;
  trades: TradeLog[];
}

export interface M02View {
  self: CharId | 'spectator';
  players: CharId[];
  funds: Record<string, number>;
  items: Record<string, Bag>;
  /** 現在の出品（終了時は null） */
  item: Item | null;
  lot: number;
  totalLots: number;
  /** まだ出品されていない数（現在の出品を含む） */
  remaining: Bag;
  stage: M02State['stage'];
  tied: CharId[];
  rebidMin: number;
  myBid: number | null;
  history: LotResult[];
  ready: Record<string, boolean>;
  offer: Offer | null;
  offersLeft: number;
  trades: TradeLog[];
  finalScores?: Record<string, number>;
}

const emptyBag = (): Bag => ({ crown: 0, gem: 0, key: 0, book: 0, coin: 0 });

/** 商品の得点（素点＋セット）。セットは種類が重ならないので、それぞれ最大数を取ればよい */
export function itemScore(b: Bag): number {
  let v = 0;
  for (const k of ITEMS) v += b[k] * ITEM_POINTS[k];
  return v + Math.min(b.crown, b.gem) * SET_CROWN_GEM + Math.min(b.key, b.book) * SET_KEY_BOOK + Math.floor(b.coin / 3) * SET_COINS;
}

export const moneyScore = (funds: number) => Math.min(MONEY_MAX, Math.floor(funds / MONEY_STEP));
export const totalScore = (b: Bag, funds: number) => itemScore(b) + moneyScore(funds);

function finalScores(s: M02State): Record<string, number> {
  return Object.fromEntries(s.players.map((p) => [p, totalScore(s.items[p], s.funds[p])]));
}

function sideOk(side: Side, funds: number, bag: Bag): boolean {
  if (!side || !Number.isInteger(side.money) || side.money < 0 || side.money > funds) return false;
  for (const [k, n] of Object.entries(side.items ?? {})) {
    if (!ITEMS.includes(k as Item) || !Number.isInteger(n) || (n as number) < 0 || (n as number) > bag[k as Item]) return false;
  }
  return true;
}

const sideEmpty = (side: Side) => side.money === 0 && ITEMS.every((k) => !(side.items[k] ?? 0));

function offerValid(s: { funds: Record<string, number>; items: Record<string, Bag>; players: CharId[] }, o: Offer): boolean {
  if (o.from === o.to || !s.players.includes(o.from) || !s.players.includes(o.to)) return false;
  if (!sideOk(o.give, s.funds[o.from], s.items[o.from]) || !sideOk(o.take, s.funds[o.to], s.items[o.to])) return false;
  if (sideEmpty(o.give) && sideEmpty(o.take)) return false;
  // 同じ側と反対側の両方にお金を載せない（差額だけを動かす）
  if (o.give.money > 0 && o.take.money > 0) return false;
  return true;
}

function applyOffer(s: M02State, o: Offer): void {
  s.funds[o.from] += o.take.money - o.give.money;
  s.funds[o.to] += o.give.money - o.take.money;
  for (const k of ITEMS) {
    const g = o.give.items[k] ?? 0;
    const tk = o.take.items[k] ?? 0;
    s.items[o.from][k] += tk - g;
    s.items[o.to][k] += g - tk;
  }
}

function nextLot(s: M02State): void {
  s.bids = {};
  s.tied = [];
  s.rebidMin = 0;
  s.firstBids = {};
  s.lot += 1;
  if (s.lot >= s.lots.length) {
    s.stage = 'done';
  } else if (s.lot % TRADE_EVERY === 0) {
    s.stage = 'trade';
    s.ready = {};
    s.offer = null;
    s.offersLeft = Object.fromEntries(s.players.map((p) => [p, OFFERS_PER_TRADE]));
  } else s.stage = 'bid';
}

function award(s: M02State, winner: CharId | null, price: number, bids: Record<string, number>, rebid?: Record<string, number>): void {
  const item = s.lots[s.lot];
  if (winner) {
    s.funds[winner] -= price;
    s.items[winner][item] += 1;
  }
  s.history.push({ lot: s.lot, item, winner, price: winner ? price : 0, bids, rebid });
  nextLot(s);
}

function resolveBids(s: M02State): void {
  if (s.stage === 'bid') {
    const top = Math.max(...s.players.map((p) => s.bids[p] ?? 0));
    if (top <= 0) return award(s, null, 0, { ...s.bids });
    const tops = s.players.filter((p) => (s.bids[p] ?? 0) === top);
    if (tops.length === 1) return award(s, tops[0], top, { ...s.bids });
    s.firstBids = { ...s.bids };
    s.tied = tops;
    s.rebidMin = top;
    s.bids = {};
    s.stage = 'rebid';
    return;
  }
  // 再入札：1 回だけ。同額のまま、または全員が降りたら流札
  const top = Math.max(...s.tied.map((p) => s.bids[p] ?? 0));
  const tops = s.tied.filter((p) => (s.bids[p] ?? 0) === top);
  const rebid = { ...s.bids };
  if (top > 0 && tops.length === 1) award(s, tops[0], top, s.firstBids, rebid);
  else award(s, null, 0, s.firstBids, rebid);
}

// ---------- NPC の思考（公開情報だけを使う） ----------

/** 未完成のセットが、残りの出品で完成する見込みを点数に直したもの */
function potential(b: Bag, remaining: Bag): number {
  let v = 0;
  const pair = (x: Item, y: Item, bonus: number) => {
    const d = b[x] - b[y];
    if (d > 0) v += Math.min(d, remaining[y]) * bonus * 0.3;
    if (d < 0) v += Math.min(-d, remaining[x]) * bonus * 0.3;
  };
  pair('crown', 'gem', SET_CROWN_GEM);
  pair('key', 'book', SET_KEY_BOOK);
  const r = b.coin % 3;
  if (r > 0 && remaining.coin >= 3 - r) v += SET_COINS * (r / 3) * 0.4;
  return v;
}

const worth = (b: Bag, remaining: Bag) => itemScore(b) + potential(b, remaining);

/** 1 点あたりの相場（資金）。場に残る資金と、残りの出品の価値から見積もる */
function pricePerPoint(v: M02View): number {
  const money = v.players.reduce((a, p) => a + v.funds[p], 0);
  const pts = ITEMS.reduce((a, k) => a + v.remaining[k] * ITEM_POINTS[k], 0) * 1.45;
  if (pts <= 0) return MONEY_STEP;
  return Math.max(2, Math.min(MONEY_STEP, money / pts));
}

function withItem(b: Bag, k: Item, n = 1): Bag {
  return { ...b, [k]: b[k] + n };
}

function afterTrade(b: Bag, gain: Partial<Record<Item, number>>, lose: Partial<Record<Item, number>>): Bag {
  const out = { ...b };
  for (const k of ITEMS) out[k] += (gain[k] ?? 0) - (lose[k] ?? 0);
  return out;
}

function bidAi(v: M02View, ctx: AiCtx): M02Move {
  const me = ctx.self;
  const item = v.item!;
  const funds = v.funds[me];
  if (funds <= 0) return { t: 'bid', amount: 0 };
  const mine = v.items[me];
  // この出品を除いた「今後」の見込みで価値を測る
  const rest = { ...v.remaining, [item]: Math.max(0, v.remaining[item] - 1) };
  const value = worth(withItem(mine, item), rest) - worth(mine, rest);
  const pp = pricePerPoint(v);
  const risk = ctx.personality.risk / 100;
  const greed = ctx.personality.greed / 100;
  const progress = v.lot / v.totalLots;
  // 序盤は資金を残し、終盤ほど使い切る
  const cap = funds * Math.min(1, 0.32 + 0.68 * progress + (risk - 0.5) * 0.04 + ctx.rng.gauss(0, 0.06));
  // 同盟相手の方がこの品を必要としていれば、競り合いを控える
  let yieldTo = 1;
  for (const a of ctx.allies) {
    if (!v.players.includes(a)) continue;
    const av = worth(withItem(v.items[a], item), rest) - worth(v.items[a], rest);
    if (av > value + 2 && ctx.personality.loyalty > 45) yieldTo = 0.6;
  }
  if (v.stage === 'rebid') {
    const limit = Math.min(funds, value * pp * (1.0 + risk * 0.25) * yieldTo + ctx.rng.gauss(0, 2 * ctx.noise));
    if (limit < v.rebidMin) return { t: 'bid', amount: 0 };
    return { t: 'bid', amount: Math.max(v.rebidMin, Math.min(Math.floor(limit), v.rebidMin + ctx.rng.int(1, 6))) };
  }
  // 終盤ほど資金の使い道が減るので、1 点に払ってよい額が上がる（残金は 20 で 1 点）
  const wp = pp + (MONEY_STEP - pp) * progress ** 3;
  const limit = Math.min(cap, value * wp * (1.05 + (risk - 0.5) * 0.1 + (greed - 0.5) * 0.06) * yieldTo);
  // 他の参加者が出せそうな額を、公開されている資金と持ち物から見積もる
  let rival = 0;
  for (const q of v.players) {
    if (q === me) continue;
    const qv = worth(withItem(v.items[q], item), rest) - worth(v.items[q], rest);
    rival = Math.max(rival, Math.min(v.funds[q], qv * pp * 0.85));
  }
  rival += ctx.rng.gauss(0, 3.5 * ctx.noise);
  const target = rival + 1 + ctx.rng.int(0, 3);
  let bid = Math.round(limit >= target ? Math.max(target, limit * 0.7) : limit * (0.88 + ctx.rng.gauss(0, 0.05 * ctx.noise)));
  if (bid < 3) bid = 0;
  return { t: 'bid', amount: Math.max(0, Math.min(funds, bid)) };
}

/** 交換後の損得（点数換算）。fv は資金 1 あたりの点数 */
function tradeGain(v: M02View, who: CharId, o: Offer, fv: number): number {
  const isFrom = who === o.from;
  const gain = isFrom ? o.take : o.give;
  const lose = isFrom ? o.give : o.take;
  const b = v.items[who];
  return worth(afterTrade(b, gain.items, lose.items), v.remaining) - worth(b, v.remaining) + (gain.money - lose.money) * fv;
}

function tradeAi(v: M02View, ctx: AiCtx): M02Move {
  const me = ctx.self;
  const fv = Math.max(1 / MONEY_STEP, 1 / pricePerPoint(v));
  if (v.offer && v.offer.to === me) {
    const r = ctx.relation(v.offer.from);
    const need = 0.3 + r.hostility / 100 - r.trust / 250 + ctx.rng.gauss(0, 0.35 * ctx.noise);
    return { t: 'answer', accept: tradeGain(v, me, v.offer, fv) > need };
  }
  if (v.offersLeft <= 0) return { t: 'ready' };
  let best: { o: Offer; g: number } | null = null;
  const consider = (o: Offer) => {
    if (!offerValid(v, o)) return;
    const mineG = tradeGain(v, me, o, fv);
    const theirG = tradeGain(v, o.to, o, fv);
    if (mineG < 0.6 || theirG < 0.4) return;
    const r = ctx.relation(o.to);
    const g = mineG + (r.like - r.hostility) / 100 + ctx.rng.gauss(0, 0.4 * ctx.noise);
    if (!best || g > best.g) best = { o, g };
  };
  for (const q of v.players) {
    if (q === me) continue;
    for (const a of ITEMS) {
      // 品と品の交換
      if (v.items[me][a] > 0) {
        for (const b of ITEMS) if (b !== a && v.items[q][b] > 0) consider({ from: me, to: q, give: { money: 0, items: { [a]: 1 } }, take: { money: 0, items: { [b]: 1 } } });
        // 売る：双方が得をする値段の中間
        const lossMe = worth(v.items[me], v.remaining) - worth(withItem(v.items[me], a, -1), v.remaining);
        const gainQ = worth(withItem(v.items[q], a), v.remaining) - worth(v.items[q], v.remaining);
        if (gainQ > lossMe + 0.8) {
          const price = Math.min(v.funds[q], Math.round((lossMe + gainQ) / 2 / fv));
          if (price > 0) consider({ from: me, to: q, give: { money: 0, items: { [a]: 1 } }, take: { money: price, items: {} } });
        }
      }
      // 買う
      if (v.items[q][a] > 0) {
        const lossQ = worth(v.items[q], v.remaining) - worth(withItem(v.items[q], a, -1), v.remaining);
        const gainMe = worth(withItem(v.items[me], a), v.remaining) - worth(v.items[me], v.remaining);
        if (gainMe > lossQ + 0.8) {
          const price = Math.min(v.funds[me], Math.round((lossQ + gainMe) / 2 / fv));
          if (price > 0) consider({ from: me, to: q, give: { money: price, items: {} }, take: { money: 0, items: { [a]: 1 } } });
        }
      }
    }
  }
  const pick = best as { o: Offer; g: number } | null;
  if (!pick) return { t: 'ready' };
  return { t: 'offer', to: pick.o.to, give: pick.o.give, take: pick.o.take };
}

function m02Ai(v: M02View, ctx: AiCtx): M02Move {
  if (v.stage === 'trade') return tradeAi(v, ctx);
  return bidAi(v, ctx);
}

export const M02: MatchEngine<M02State, M02Move, M02View> = {
  id: 'm02',
  name: '黄金の競売',
  kind: 'main',
  minPlayers: 3,
  maxPlayers: 12,
  summary: '資金100で20品を競り落とし、品物とセットの得点を競う。',
  rules: [
    '全員が資金100を持ちます。王冠、宝石、鍵、書物、硬貨が4つずつ、合計20品が1つずつ出品されます。出品の順番は事前に分かりません。',
    '出品ごとに全員が同時に入札額を決めます（他の人の額は見えません）。最高額の1人がその額を支払って落札します。0は見送りです。全員が0なら流札です。',
    '最高額が同じ人が複数いた場合は、その人たちだけで1回だけ再入札します。再入札は前回の最高額以上か、0（降りる）です。それでも1人に決まらなければ流札です。',
    '入札額は、落札が決まった後に全員分が公開されます。資金と持ち物は常に公開です。',
    '5品ごと（5、10、15品目の後）に交換の時間があります。資金と品物を、相手が同意すれば交換できます。提案は1回の交換時間につき2回までです。',
    '得点：王冠8、宝石5、鍵3、書物4、硬貨2。セット：王冠と宝石の組で+5、鍵と書物の組で+6、硬貨3枚で+8（1つの品を2つのセットには使えません）。',
    '残った資金は20につき1点（最大5点）です。',
    '合計点の上位が生活棟、下位が監獄棟です。同点は残った資金が多い方が上位、それも同じなら共通決定戦です。',
    '時間切れの場合：入札は0（見送り）、交換の提案への返事は「断る」、交換時間は「終了」になります。',
  ],
  init(players, rng) {
    const lots: Item[] = [];
    for (const k of ITEMS) for (let i = 0; i < LOTS_EACH; i++) lots.push(k);
    rng.shuffle(lots);
    return {
      players: [...players],
      funds: Object.fromEntries(players.map((p) => [p, START_FUNDS])),
      items: Object.fromEntries(players.map((p) => [p, emptyBag()])),
      lots,
      lot: 0,
      stage: 'bid',
      bids: {},
      tied: [],
      rebidMin: 0,
      firstBids: {},
      history: [],
      ready: {},
      offer: null,
      offersLeft: {},
      trades: [],
    };
  },
  pending(s) {
    if (s.stage === 'done') return [];
    if (s.stage === 'bid') return s.players.filter((p) => s.bids[p] === undefined);
    if (s.stage === 'rebid') return s.tied.filter((p) => s.bids[p] === undefined);
    if (s.offer) return [s.offer.to];
    return s.players.filter((p) => !s.ready[p]);
  },
  stage(s) {
    if (s.stage === 'done') return { label: '終了' };
    if (s.stage === 'trade') return { label: `交換の時間（${s.lot} 品終了）`, time: 90_000 };
    if (s.stage === 'rebid') return { label: `${s.lot + 1} / ${s.lots.length} 品目 再入札`, time: 20_000 };
    return { label: `${s.lot + 1} / ${s.lots.length} 品目 入札`, time: 30_000 };
  },
  validate(s, p, m) {
    if (!m || !s.players.includes(p)) return false;
    if (s.stage === 'bid') return m.t === 'bid' && s.bids[p] === undefined && Number.isInteger(m.amount) && m.amount >= 0 && m.amount <= s.funds[p];
    if (s.stage === 'rebid') return m.t === 'bid' && s.tied.includes(p) && s.bids[p] === undefined && Number.isInteger(m.amount) && m.amount <= s.funds[p] && (m.amount === 0 || m.amount >= s.rebidMin);
    if (s.stage !== 'trade') return false;
    if (s.offer) return m.t === 'answer' && p === s.offer.to && typeof m.accept === 'boolean';
    if (s.ready[p]) return false;
    if (m.t === 'ready') return true;
    if (m.t === 'offer') return (s.offersLeft[p] ?? 0) > 0 && offerValid(s, { from: p, to: m.to, give: m.give, take: m.take });
    return false;
  },
  defaultMove(s) {
    if (s.stage === 'trade') return s.offer ? { t: 'answer', accept: false } : { t: 'ready' };
    return { t: 'bid', amount: 0 };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m02: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'bid') {
      s.bids[p] = m.amount;
      if (this.pending(s).length === 0) resolveBids(s);
      return;
    }
    if (m.t === 'offer') {
      s.offersLeft[p] -= 1;
      s.offer = { from: p, to: m.to, give: { money: m.give.money, items: { ...m.give.items } }, take: { money: m.take.money, items: { ...m.take.items } } };
      return;
    }
    if (m.t === 'answer') {
      const o = s.offer!;
      // 同意の時点でもう一度、双方が渡せる状態かを確かめる
      const ok = m.accept && offerValid(s, o);
      if (ok) applyOffer(s, o);
      s.trades.push({ ...o, accepted: ok, after: s.lot });
      s.offer = null;
      return;
    }
    s.ready[p] = true;
    if (s.players.every((q) => s.ready[q])) s.stage = 'bid';
  },
  view(s, p) {
    const remaining = emptyBag();
    for (let i = s.lot; i < s.lots.length; i++) remaining[s.lots[i]] += 1;
    return {
      self: p,
      players: s.players,
      funds: { ...s.funds },
      items: Object.fromEntries(s.players.map((q) => [q, { ...s.items[q] }])),
      item: s.stage === 'done' ? null : s.stage === 'trade' ? null : s.lots[s.lot],
      lot: s.lot,
      totalLots: s.lots.length,
      remaining,
      stage: s.stage,
      tied: [...s.tied],
      rebidMin: s.rebidMin,
      myBid: p !== 'spectator' && s.bids[p] !== undefined ? s.bids[p] : null,
      history: s.history,
      ready: { ...s.ready },
      offer: s.offer,
      offersLeft: p === 'spectator' ? 0 : s.offersLeft[p] ?? 0,
      trades: s.trades,
      finalScores: s.stage === 'done' ? finalScores(s) : undefined,
    };
  },
  ai: m02Ai,
  done(s) {
    return s.stage === 'done';
  },
  scores(s) {
    return finalScores(s);
  },
  ranking(s) {
    const sc = finalScores(s);
    return sortGroups(s.players, (p) => sc[p], (p) => s.funds[p]);
  },
  allyValue(s, a, b) {
    // 持ち物が補い合う相手ほど、交換の相手として価値がある
    const x = s.items[a];
    const y = s.items[b];
    let v = 1;
    if ((x.crown > x.gem && y.gem > y.crown) || (x.gem > x.crown && y.crown > y.gem)) v += 1;
    if ((x.key > x.book && y.book > y.key) || (x.book > x.key && y.key > y.book)) v += 1;
    return v;
  },
};

export type { Rng };
