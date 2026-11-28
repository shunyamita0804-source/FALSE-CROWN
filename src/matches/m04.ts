/**
 * M04 鉄道王国・改（v11、9 人、3 人 × 3 卓）
 * 9 都市を 16 本の区間が結ぶ地図（全卓同じ地図、同じ建設費）。各自に専用資金 12 と、秘密の任務 3 つ（出発地と目的地、距離で決まる得点）。
 * 8 巡（2026-11-28 本人承認。もとは 9 巡）。1 手は「空いている区間に線路を敷く」「資金 +3」「輸送（任務の達成）」のいずれか。先手は毎巡替わる。
 * 輸送は、出発地から目的地まで線路がつながっていれば行える。他人の線路を通ると 1 区間につき通行料 2 を持ち主へ払う（拒否できない。2026-11-28 本人承認。もとは 1）。
 * 得点：達成した任務の得点＋自分が敷いた線路 1 本につき 1 点＋残った資金 3 につき 1 点。順位は全卓を通した個人の得点で決まる。
 * 任務は、難しさの等しい組を席順に回して配る。3 巡ごとに 20 秒の交渉。開始前に 2 ピースで、任務 1 つを同じ得点の候補 2 つのどちらかと交換できる（1 回）。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROUNDS = 8;
export const START_FUNDS = 12;
export const INCOME = 3;
export const TOLL = 2;
export const AID_COST = 2;
export const TURN_MS = 30_000;
export const SETUP_MS = 40_000;
export const BREAK_MS = 20_000;
export const BREAK_EVERY = 3;

/** 9 都市（3×3 の並び）と 16 本の区間：横 6、縦 6、斜め 4 */
export const CITY_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
export const CITY_POS: [number, number][] = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
export const EDGES: [number, number][] = [
  [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8],
  [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8],
  [1, 3], [1, 5], [3, 7], [5, 7],
];

export interface Mission { from: number; to: number; points: number; done: boolean }

export interface RailLog { seat: number; kind: 'build' | 'fund' | 'transport'; edge?: number; mission?: Mission; path?: number[]; toll?: number }

export interface RailTable {
  players: CharId[];
  costs: number[];
  /** 区間の持ち主（席の番号）。空きは -1 */
  owner: number[];
  funds: number[];
  missions: Mission[][];
  built: number[];
  /** これまでに打たれた手の数 */
  turn: number;
  /** 通過した交渉の回数 */
  passed: number;
  log: RailLog[];
}

export type RailAct = { t: 'build'; edge: number } | { t: 'fund' } | { t: 'transport'; mission: number };
export type M04Move = RailAct | { t: 'aid'; mission: number } | { t: 'pick'; c: 0 | 1 } | { t: 'ready' };

export const roundOf = (t: RailTable) => Math.floor(t.turn / t.players.length);
/** いま手番の席。先手は毎巡 1 つずつずれる */
export const seatToMove = (t: RailTable) => (roundOf(t) + (t.turn % t.players.length)) % t.players.length;
export const tableDone = (t: RailTable) => t.turn >= ROUNDS * t.players.length;
const atBreak = (t: RailTable) => !tableDone(t) && t.turn % t.players.length === 0 && roundOf(t) > 0 && roundOf(t) % BREAK_EVERY === 0 && t.passed < roundOf(t) / BREAK_EVERY;

const other = (e: number, c: number) => (EDGES[e][0] === c ? EDGES[e][1] : EDGES[e][0]);
const edgesAt = (c: number) => EDGES.map((_, i) => i).filter((i) => EDGES[i][0] === c || EDGES[i][1] === c);

/** 重み付きの最短経路（都市が 9 つなので単純な方法で足りる）。weight が負の区間は通れない */
export function shortest(from: number, to: number, weight: (e: number) => number): { edges: number[]; total: number } | null {
  const dist = new Array<number>(CITY_NAMES.length).fill(Infinity);
  const via = new Array<number>(CITY_NAMES.length).fill(-1);
  const hops = new Array<number>(CITY_NAMES.length).fill(0);
  const done = new Array<boolean>(CITY_NAMES.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let c = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (c < 0 || dist[i] < dist[c] || (dist[i] === dist[c] && hops[i] < hops[c]))) c = i;
    if (c < 0) return null;
    if (c === to) break;
    done[c] = true;
    for (const e of edgesAt(c)) {
      const w = weight(e);
      if (w < 0) continue;
      const n = other(e, c);
      if (dist[c] + w < dist[n] || (dist[c] + w === dist[n] && hops[c] + 1 < hops[n])) {
        dist[n] = dist[c] + w;
        hops[n] = hops[c] + 1;
        via[n] = e;
      }
    }
  }
  const edges: number[] = [];
  for (let c = to; c !== from;) {
    const e = via[c];
    edges.unshift(e);
    c = other(e, c);
  }
  return { edges, total: dist[to] };
}

/** 敷かれている線路だけを通る、通行料が最も安い経路（無ければ null） */
export function routeFor(t: Pick<RailTable, 'owner'>, seat: number, from: number, to: number): { edges: number[]; toll: number } | null {
  const r = shortest(from, to, (e) => (t.owner[e] < 0 ? -1 : t.owner[e] === seat ? 0 : TOLL));
  return r ? { edges: r.edges, toll: r.total } : null;
}

/** 何も敷かれていない地図で、建設費の合計が最も安い経路の費用（任務の難しさ） */
export const baseCost = (costs: number[], from: number, to: number) => shortest(from, to, (e) => costs[e])!.total;
/** 任務の得点：いちばん安く敷いた時の建設費が 3 以下で 6 点、4〜5 で 8 点、6〜7 で 10 点、8 以上で 12 点 */
export const missionPoints = (costs: number[], from: number, to: number) => Math.max(6, Math.min(12, 6 + 2 * Math.floor((baseCost(costs, from, to) - 2) / 2)));

export const scoreOf = (t: RailTable, seat: number) => t.missions[seat].reduce((n, m) => n + (m.done ? m.points : 0), 0) + t.built[seat] + Math.floor(t.funds[seat] / 3);

export function legalAct(t: RailTable, seat: number, a: RailAct): boolean {
  if (!a || tableDone(t) || seatToMove(t) !== seat) return false;
  if (a.t === 'fund') return true;
  if (a.t === 'build') return Number.isInteger(a.edge) && a.edge >= 0 && a.edge < EDGES.length && t.owner[a.edge] < 0 && t.funds[seat] >= t.costs[a.edge];
  if (a.t === 'transport') {
    const m = t.missions[seat][a.mission];
    if (!m || m.done) return false;
    const r = routeFor(t, seat, m.from, m.to);
    return !!r && r.toll <= t.funds[seat];
  }
  return false;
}

export function applyAct(t: RailTable, seat: number, a: RailAct): boolean {
  if (!legalAct(t, seat, a)) return false;
  if (a.t === 'fund') {
    t.funds[seat] += INCOME;
    t.log.push({ seat, kind: 'fund' });
  } else if (a.t === 'build') {
    t.funds[seat] -= t.costs[a.edge];
    t.owner[a.edge] = seat;
    t.built[seat]++;
    t.log.push({ seat, kind: 'build', edge: a.edge });
  } else {
    const m = t.missions[seat][a.mission];
    const r = routeFor(t, seat, m.from, m.to)!;
    for (const e of r.edges) {
      if (t.owner[e] === seat) continue;
      t.funds[seat] -= TOLL;
      t.funds[t.owner[e]] += TOLL;
    }
    m.done = true;
    t.log.push({ seat, kind: 'transport', mission: { ...m }, path: r.edges, toll: r.toll });
  }
  t.turn++;
  return true;
}

/** 卓の分け方：3 人ずつ。割り切れない時は 2 人の卓を作る */
export function tableSizes(n: number): number[] {
  if (n <= 3) return [n];
  const tables = Math.ceil(n / 3);
  const sizes = new Array<number>(tables).fill(3);
  for (let i = 0, lack = tables * 3 - n; lack > 0; i++, lack--) sizes[tables - 1 - (i % tables)]--;
  return sizes;
}

interface Setup { costs: number[]; sets: Mission[][]; spare: Record<number, [number, number][]> }

/** 地図の建設費と、得点の合計が等しい任務の組を作る。交換用の候補（同じ得点の別の任務）も用意する */
export function generateSetup(rng: Rng, seats: number): Setup {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const costs = EDGES.map(() => rng.int(1, 4));
    const pairs: [number, number][] = [];
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) if (shortest(a, b, () => 1)!.total >= 2) pairs.push([a, b]);
    const byPts: Record<number, [number, number][]> = {};
    for (const p of pairs) (byPts[missionPoints(costs, p[0], p[1])] ??= []).push(p);
    // 1 組は、易しい、ふつう、難しいの 3 つ。組ごとに同じ得点の並びにする
    const levels = Object.keys(byPts).map(Number).filter((k) => byPts[k].length >= seats + 2).sort((x, y) => x - y);
    // 3 つとも達成するには手数も資金も足りない難しさにする（どれを狙うか、誰の線路を借りるかが勝負になる）：8 点、10 点、12 点を 1 つずつ
    const pick = [8, 10, 12];
    if (pick.some((pt) => !levels.includes(pt))) continue;
    const pools = pick.map((pt) => rng.shuffle([...byPts[pt]]));
    const sets: Mission[][] = Array.from({ length: seats }, (_, s) => pools.map((pool, k) => {
      const [a, b] = pool[s];
      const flip = rng.chance(0.5);
      return { from: flip ? b : a, to: flip ? a : b, points: pick[k], done: false };
    }));
    const spare: Record<number, [number, number][]> = {};
    pick.forEach((pt, k) => { spare[pt] = pools[k].slice(seats); });
    return { costs, sets, spare };
  }
  throw new Error('m04: 任務の組を作れませんでした');
}

export interface M04State {
  players: CharId[];
  phase: 'setup' | 'play' | 'break' | 'done';
  tables: RailTable[];
  /** 交換用の候補（得点 → 都市の組） */
  spare: Record<number, [number, number][]>;
  ready: Record<string, boolean>;
  /** 補助の状況：使った任務の番号と、提示された候補 2 つ。選び終えると picked が入る */
  aid: Record<string, { mission: number; cands: Mission[]; picked: boolean } | undefined>;
  /** 手が打たれるたびに変わる値（画面が手番ごとの制限時間を数え直すために使う） */
  stage: string;
  moves: number;
}

export interface M04View {
  self: CharId | 'spectator';
  players: CharId[];
  phase: M04State['phase'];
  /** 自分の卓（観戦の時は 1 卓目） */
  table: {
    players: CharId[];
    costs: number[];
    owner: number[];
    funds: number[];
    built: number[];
    /** 各席の、達成済みの任務（公開）。未達成の任務は本人にしか見えない */
    doneMissions: Mission[][];
    round: number;
    toMove: number;
    turnsLeft: number;
    log: RailLog[];
  };
  seat: number;
  missions: Mission[];
  aid: { mission: number; cands: Mission[]; picked: boolean } | null;
  ready: Record<string, boolean>;
  /** 全卓の公開得点（達成した任務、線路、資金から計算できる分） */
  totals: Record<string, number>;
  rounds: number;
}

const findSeat = (s: M04State, p: CharId): { t: RailTable; seat: number } | null => {
  for (const t of s.tables) {
    const seat = t.players.indexOf(p);
    if (seat >= 0) return { t, seat };
  }
  return null;
};

function advance(s: M04State): void {
  s.moves++;
  s.stage = String(s.moves);
  if (s.phase !== 'play') return;
  if (s.tables.every(tableDone)) {
    s.phase = 'done';
    return;
  }
  if (s.tables.every((t) => tableDone(t) || atBreak(t))) {
    s.phase = 'break';
    s.ready = Object.fromEntries(s.players.map((p) => [p, false]));
  }
}

/** 任務 1 つを達成するための、いちばん安い計画（敷く区間、費用、通行料） */
export function planFor(v: M04View['table'], seat: number, m: Mission): { builds: number[]; cost: number; toll: number } {
  const r = shortest(m.from, m.to, (e) => (v.owner[e] < 0 ? v.costs[e] + 0.01 : v.owner[e] === seat ? 0 : TOLL))!;
  const builds = r.edges.filter((e) => v.owner[e] < 0);
  return { builds, cost: builds.reduce((n, e) => n + v.costs[e], 0), toll: r.edges.filter((e) => v.owner[e] >= 0 && v.owner[e] !== seat).length * TOLL };
}

/**
 * CPU：見えている地図と自分の任務だけで、達成までの手数と費用を見積もる。
 * 残りの手数で間に合う任務のうち、1 手あたりの得が大きいものを進める。間に合う任務が無ければ資金を貯める。
 */
function m04Ai(v: M04View, ctx: AiCtx): M04Move {
  if (v.phase === 'break') return { t: 'ready' };
  const strat = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.logic); // 副：経路の計算
  if (v.phase === 'setup') {
    if (v.aid && !v.aid.picked) {
      const c = v.aid.cands.map((m) => baseCost(v.table.costs, m.from, m.to));
      return { t: 'pick', c: c[0] <= c[1] ? 0 : 1 };
    }
    if (!v.aid && ctx.pieces >= AID_COST + 2 && ctx.rng.chance(0.08 + strat * 0.1)) {
      // 得点のわりに費用が高い任務を替える
      let worst = 0;
      const ratio = (m: Mission) => baseCost(v.table.costs, m.from, m.to) / m.points;
      v.missions.forEach((m, i) => { if (ratio(m) > ratio(v.missions[worst])) worst = i; });
      if (ctx.spend(AID_COST, 'M04 任務の交換')) return { t: 'aid', mission: worst };
    }
    return { t: 'ready' };
  }
  const tb = v.table;
  const funds = tb.funds[v.seat];
  // 読み違い：能力が低いほど、任務に関係の薄い区間を敷いてしまうことがある
  if (ctx.rng.chance(Math.max(0.02, 0.2 - strat * 0.16 + ctx.noise * 0.04))) {
    const mine = new Set(v.missions.filter((m) => !m.done).flatMap((m) => [m.from, m.to]));
    const near = EDGES.map((_, e) => e).filter((e) => tb.owner[e] < 0 && tb.costs[e] <= funds && (mine.has(EDGES[e][0]) || mine.has(EDGES[e][1])));
    if (near.length) return { t: 'build', edge: ctx.rng.pick(near) };
  }
  let best: { act: RailAct; rate: number } | null = null;
  v.missions.forEach((m, i) => {
    if (m.done) return;
    const p = planFor(tb, v.seat, m);
    const need = p.cost + p.toll;
    const wait = Math.ceil(Math.max(0, need - funds) / INCOME);
    const turns = p.builds.length + 1 + wait;
    if (turns > tb.turnsLeft) return;
    // 得：任務の得点＋敷いた線路の点−使う資金の点（資金 3 で 1 点）。待つ手は資金が増えるので損にならない
    const gain = m.points + p.builds.length - need / 3 + wait;
    const rate = gain / turns + ctx.rng.gauss(0, 0.25 + (1 - strat) * 0.38 + (1 - lg) * 0.15 + ctx.noise * 0.2);
    let act: RailAct;
    if (!p.builds.length) act = funds >= p.toll ? { t: 'transport', mission: i } : { t: 'fund' };
    else {
      const affordable = p.builds.filter((e) => tb.costs[e] <= funds);
      act = affordable.length ? { t: 'build', edge: affordable[0] } : { t: 'fund' };
    }
    if (!best || rate > best.rate) best = { act, rate };
  });
  const chosen = best as { act: RailAct; rate: number } | null;
  // 資金を貯めるだけの手は、1 手で 1 点ぶん
  if (!chosen || chosen.rate < 1) return { t: 'fund' };
  // 様子見：欲の強い人ほど、序盤は自分では敷かず、他の人が敷いた線路を借りようとする（待ちすぎると間に合わなくなる）
  if (chosen.act.t === 'build' && tb.round < 4 && ctx.rng.chance(Math.max(0, Math.min(0.55, (ctx.personality.greed - 35) / 90)))) return { t: 'fund' };
  return chosen.act;
}

export const M04: MatchEngine<M04State, M04Move, M04View> = {
  id: 'm04',
  name: '鉄道王国・改',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 12,
  summary: '線路を敷いて、秘密の任務（出発地から目的地への輸送）を達成する。3 人 1 卓で、順位は全卓を通した個人の得点。',
  rules: [
    '3 人 1 卓で行います。どの卓も同じ地図（9 都市、16 区間、建設費 1〜4）です。順位は、全卓を通した個人の得点で決まります。',
    '各自に専用の資金 12 と、秘密の任務 3 つが配られます。任務は「出発地から目的地へ運ぶ」で、遠いほど高得点（6〜12 点）です。任務の難しさは全員同じになるよう配ります。',
    `全 ${ROUNDS} 巡。先手は毎巡替わります。自分の番には、次の 3 つから 1 つを行います。`,
    '線路を敷く：空いている区間を選び、建設費を払います。その区間はあなたの線路になります。',
    '資金を得る：資金が 3 増えます。',
    `輸送する：任務の出発地から目的地まで線路がつながっていれば、その任務を達成できます。他の人の線路を通る時は、1 区間につき通行料 ${TOLL} を持ち主に払います（持ち主は断れません）。通行料が最も安い道を自動で通ります。`,
    '得点：達成した任務の得点＋自分が敷いた線路 1 本につき 1 点＋残った資金 3 につき 1 点。',
    '3 巡ごとに 20 秒の交渉時間があります。同じ卓の人と、線路の協力や取引を話せます。',
    `開始前に 1 回だけ、ピース ${AID_COST} 個で、任務 1 つを同じ得点の候補 2 つのどちらかと交換できます（条件は全員同じです）。`,
    '同点の時は、達成した任務の数、残った資金の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：「資金を得る」になります。',
  ],
  init(players, rng) {
    const order = rng.shuffle([...players]);
    const sizes = tableSizes(order.length);
    const seats = Math.max(...sizes);
    const setup = generateSetup(rng, seats);
    const tables: RailTable[] = [];
    let at = 0;
    sizes.forEach((n, ti) => {
      const ps = order.slice(at, at + n);
      at += n;
      tables.push({
        players: ps,
        costs: [...setup.costs],
        owner: EDGES.map(() => -1),
        funds: ps.map(() => START_FUNDS),
        // 任務の組は、卓ごとに席を 1 つずつずらして配る
        missions: ps.map((_, si) => setup.sets[(si + ti) % seats].map((m) => ({ ...m }))),
        built: ps.map(() => 0),
        turn: 0,
        passed: 0,
        log: [],
      });
    });
    return { players: [...players], phase: 'setup', tables, spare: setup.spare, ready: Object.fromEntries(players.map((p) => [p, false])), aid: {}, stage: '0', moves: 0 };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'setup' || s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return s.tables.filter((t) => !tableDone(t) && !atBreak(t)).map((t) => t.players[seatToMove(t)]);
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'setup') return { label: '任務の確認', time: SETUP_MS };
    const round = Math.min(ROUNDS, Math.min(...s.tables.map(roundOf)) + 1);
    if (s.phase === 'break') return { label: `交渉（次は第 ${round} 巡）`, time: BREAK_MS, negotiation: true };
    return { label: `第 ${round} 巡 / ${ROUNDS}`, time: TURN_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done') return false;
    const at = findSeat(s, p);
    if (!at) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (s.phase === 'setup') {
      if (s.ready[p]) return false;
      const a = s.aid[p];
      if (m.t === 'aid') return !a && Number.isInteger(m.mission) && m.mission >= 0 && m.mission < at.t.missions[at.seat].length;
      if (m.t === 'pick') return !!a && !a.picked && (m.c === 0 || m.c === 1);
      return m.t === 'ready' && (!a || a.picked);
    }
    if (m.t !== 'build' && m.t !== 'fund' && m.t !== 'transport') return false;
    return !atBreak(at.t) && legalAct(at.t, at.seat, m);
  },
  defaultMove(s, p) {
    if (s.phase === 'setup') {
      const a = s.aid[p];
      return a && !a.picked ? { t: 'pick', c: 0 } : { t: 'ready' };
    }
    return s.phase === 'break' ? { t: 'ready' } : { t: 'fund' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m04: illegal move ${JSON.stringify(m)}`);
    const at = findSeat(s, p)!;
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) {
        if (s.phase === 'break') for (const t of s.tables) if (atBreak(t)) t.passed++;
        s.phase = 'play';
      }
    } else if (m.t === 'aid') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う。候補は、同じ得点で、同じ卓の誰の任務とも重ならない 2 つ
      const cur = at.t.missions[at.seat][m.mission];
      const taken = new Set(at.t.missions.flat().map((x) => [x.from, x.to].sort().join('-')));
      const pool = (s.spare[cur.points] ?? []).filter(([a, b]) => !taken.has([a, b].sort().join('-')));
      const cands = pool.slice(0, 2).map(([a, b]) => ({ from: a, to: b, points: cur.points, done: false }));
      while (cands.length < 2) cands.push({ ...cur });
      s.aid[p] = { mission: m.mission, cands, picked: false };
    } else if (m.t === 'pick') {
      const a = s.aid[p]!;
      at.t.missions[at.seat][a.mission] = { ...a.cands[m.c] };
      a.picked = true;
    } else applyAct(at.t, at.seat, m);
    advance(s);
  },
  view(s, p) {
    const at = (p !== 'spectator' && findSeat(s, p)) || { t: s.tables[0], seat: -1 };
    const t = at.t;
    const n = t.players.length;
    const myTurnsLeft = at.seat < 0 ? 0 : Array.from({ length: ROUNDS * n - t.turn }, (_, k) => t.turn + k).filter((k) => (Math.floor(k / n) + (k % n)) % n === at.seat).length;
    const totals: Record<string, number> = {};
    for (const tb of s.tables) tb.players.forEach((x, i) => { totals[x] = scoreOf(tb, i); });
    const a = p !== 'spectator' ? s.aid[p] : undefined;
    return {
      self: p,
      players: s.players,
      phase: s.phase,
      table: {
        players: t.players,
        costs: t.costs,
        owner: [...t.owner],
        funds: [...t.funds],
        built: [...t.built],
        doneMissions: t.missions.map((ms) => ms.filter((m) => m.done)),
        round: Math.min(ROUNDS - 1, roundOf(t)),
        toMove: tableDone(t) ? -1 : seatToMove(t),
        turnsLeft: myTurnsLeft,
        log: t.log.slice(-6),
      },
      seat: at.seat,
      missions: at.seat < 0 ? [] : t.missions[at.seat].map((m) => ({ ...m })),
      aid: a ? { mission: a.mission, cands: a.cands, picked: a.picked } : null,
      ready: { ...s.ready },
      totals,
      rounds: ROUNDS,
    };
  },
  ai: m04Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    const out: Partial<Record<CharId, number>> = {};
    for (const t of s.tables) t.players.forEach((p, i) => { out[p] = scoreOf(t, i); });
    return out;
  },
  ranking(s) {
    const info = (p: CharId) => {
      const at = findSeat(s, p)!;
      return { score: scoreOf(at.t, at.seat), done: at.t.missions[at.seat].filter((m) => m.done).length, funds: at.t.funds[at.seat], built: at.t.built[at.seat] };
    };
    return sortGroups(s.players, (p) => info(p).score * 100 + info(p).done, (p) => info(p).funds * 20 + info(p).built);
  },
  allyValue(s, a, b) {
    const x = findSeat(s, a);
    return x && x.t.players.includes(b) ? 2 : 0.3;
  },
};

/** 説明と練習に使う卓（1 人。本番の地図とは建設費が違う） */
export function practiceTable(): RailTable {
  const costs = [1, 2, 2, 3, 2, 2, 2, 3, 1, 2, 3, 2, 2, 3, 3, 2];
  return { players: ['hero'], costs, owner: EDGES.map(() => -1), funds: [6], missions: [[{ from: 0, to: 4, points: 6, done: false }]], built: [0], turn: 0, passed: 0, log: [] };
}
