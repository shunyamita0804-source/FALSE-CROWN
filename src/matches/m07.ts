/**
 * M07 六角領域（v11、6 人、共通の盤面）
 * 半径 4 の六角盤（61 マス。真ん中の 1 マスは誰の物にもならない塔）。各自の開始点は 6 つの角。全員が同じ図形タイル 12 枚（1〜4 マス、回転できる）を持つ。
 * 手番に 1 枚を、自分の領域に辺で接するように、空いたマスへ置く。置けない時（置かない時）はパス。
 * 巡の手番順は、その時点の得点が低い人から（同点は巡ごとのくじ順）。
 * 置けるタイルの大きさは、第 1 巡は 1 マス、第 2 巡は 2 マスまで、第 3 巡は 3 マスまで、第 4 巡からは制限なし（先手だけが一気に中央へ届くのを防ぐ）。
 * 得点：自分のマス 1 つ 1 点、塔を囲む 6 マスはさらに +2、連結目標（自分の開始点と、隣の人との間にある自分の目印を自分の領域で結ぶ）で +5。
 * 12 巡で終わる。全員が続けてパスした時も終わる。順位は得点、一番大きい連結領域、残ったタイルの面積が小さい順。
 */
import type { CharId } from '../data/characters';
import type { Rng } from '../core/rng';
import { cellAt, hexGrid, ringOf, rot60, type HexGrid } from './hex';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const RADIUS = 4;
export const ROUNDS = 12;
export const CENTER_PTS = 2;
export const LINK_PTS = 5;
export const AID_COST = 2;
export const MOVE_MS = 40_000;
export const BREAK_MS = 20_000;
export const G: HexGrid = hexGrid(RADIUS);

/** 図形（軸座標の並び。最初のマスが基準） */
export const SHAPES: Record<string, [number, number][]> = {
  one: [[0, 0]],
  two: [[0, 0], [1, 0]],
  line3: [[0, 0], [1, 0], [2, 0]],
  bend3: [[0, 0], [1, 0], [1, 1]],
  tri3: [[0, 0], [1, 0], [0, 1]],
  line4: [[0, 0], [1, 0], [2, 0], [3, 0]],
  rhomb4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  hook4: [[0, 0], [1, 0], [2, 0], [2, 1]],
  star4: [[0, 0], [1, 0], [-1, 1], [0, -1]],
  bolt4: [[0, 0], [1, 0], [1, 1], [2, 1]],
};
/** 最初に配る 12 枚（全員同じ） */
export const START_TILES = ['one', 'one', 'two', 'two', 'two', 'line3', 'bend3', 'tri3', 'line4', 'rhomb4', 'hook4', 'star4'];
export const areaOf = (shape: string) => SHAPES[shape].length;
/** 同じ面積の別の形（交換の候補） */
export const alternatives = (shape: string) => Object.keys(SHAPES).filter((k) => k !== shape && areaOf(k) === areaOf(shape));

/** 開始点（6 つの角）と、連結目標の目印（中心から 2 マス目の輪のうち、自分と時計回りの隣の人との間にあるマス。どちらの開始点からも 3 歩） */
const CORNER: [number, number][] = [[4, 0], [0, 4], [-4, 4], [-4, 0], [0, -4], [4, -4]];
export const startCell = (seat: number) => cellAt(G, ...CORNER[seat]);
export const beaconCell = (seat: number) => { const a = CORNER[seat]; const b = CORNER[(seat + 1) % 6]; return cellAt(G, (a[0] + b[0]) / 4, (a[1] + b[1]) / 4); };
/** その巡に置けるタイルの大きさの上限（第 1 巡は 1 マス、第 2 巡は 2 マスまで…第 4 巡からは制限なし） */
export const areaCap = (round: number) => Math.min(4, round + 1);
/** 盤面の真ん中の 1 マスは「塔」で、誰の物にもならない */
export const TOWER = cellAt(G, 0, 0);
/** 塔を囲む 6 マス（加点のあるマス） */
export const isCenter = (c: number) => ringOf(G, c) === 1;

/** 図形を回して、基準のマスを at に置いた時のマスの並び。盤面の外に出るなら null */
export function cellsOf(shape: string, rot: number, at: number): number[] | null {
  const [q0, r0] = G.cells[at];
  const out: number[] = [];
  for (const [q, r] of SHAPES[shape]) {
    const [a, b] = rot60(q, r, rot);
    const c = cellAt(G, q0 + a, r0 + b);
    if (c < 0) return null;
    out.push(c);
  }
  return out;
}

/** 置けるか：全部が空きマスで、どれか 1 つが自分の領域に接している */
export function canPlace(owner: number[], seat: number, cells: number[] | null): boolean {
  if (!cells || cells.some((c) => owner[c] >= 0 || c === TOWER)) return false;
  return cells.some((c) => G.adj[c].some((n) => owner[n] === seat));
}

export interface Placement { tile: number; rot: number; at: number; cells: number[] }

/** 置ける手をすべて挙げる（同じ形、同じ置き方は 1 つにまとめる） */
export function placements(owner: number[], seat: number, tiles: string[], cap = 4): Placement[] {
  const out: Placement[] = [];
  const seenShape = new Set<string>();
  // 自分の領域の周りの空きマスだけを調べる
  const frontier = new Set<number>();
  owner.forEach((o, c) => { if (o === seat) for (const n of G.adj[c]) if (owner[n] < 0 && n !== TOWER) frontier.add(n); });
  if (!frontier.size) return out;
  tiles.forEach((shape, tile) => {
    if (seenShape.has(shape) || areaOf(shape) > cap) return;
    seenShape.add(shape);
    const seen = new Set<string>();
    for (let rot = 0; rot < 6; rot++) for (let at = 0; at < G.cells.length; at++) {
      const cells = cellsOf(shape, rot, at);
      if (!cells || !cells.some((c) => frontier.has(c)) || cells.some((c) => owner[c] >= 0 || c === TOWER)) continue;
      const key = [...cells].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tile, rot, at, cells });
    }
  });
  return out;
}

/** 自分の領域で、開始点と目印がつながっているか */
export function linked(owner: number[], seat: number): boolean {
  const a = startCell(seat);
  const b = beaconCell(seat);
  if (owner[b] !== seat) return false;
  const seen = new Set([a]);
  const q = [a];
  while (q.length) { const c = q.pop()!; if (c === b) return true; for (const n of G.adj[c]) if (owner[n] === seat && !seen.has(n)) { seen.add(n); q.push(n); } }
  return false;
}

/** 一番大きい連結領域のマス数 */
export function largestRegion(owner: number[], seat: number): number {
  const seen = new Set<number>();
  let best = 0;
  owner.forEach((o, c) => {
    if (o !== seat || seen.has(c)) return;
    let n = 0;
    const q = [c];
    seen.add(c);
    while (q.length) { const x = q.pop()!; n++; for (const y of G.adj[x]) if (owner[y] === seat && !seen.has(y)) { seen.add(y); q.push(y); } }
    best = Math.max(best, n);
  });
  return best;
}

export function scoreOf(owner: number[], seat: number): { cells: number; center: number; link: boolean; points: number } {
  let cells = 0;
  let center = 0;
  owner.forEach((o, c) => { if (o === seat) { cells++; if (isCenter(c)) center++; } });
  const link = linked(owner, seat);
  return { cells, center, link, points: cells + center * CENTER_PTS + (link ? LINK_PTS : 0) };
}

export type M07Move = { t: 'place'; tile: number; rot: number; at: number } | { t: 'pass' } | { t: 'aid'; tile: number; to: string } | { t: 'ready' };

export interface M07Log { round: number; seat: number; cells: number[] | null }

export interface M07State {
  players: CharId[];
  /** 参加者ごとの席（0〜5。開始点の角の番号で、盤面の持ち主の番号にも使う） */
  seats: number[];
  owner: number[];
  tiles: Record<string, string[]>;
  round: number;
  turn: number;
  /** この巡の手番順 */
  order: CharId[];
  /** 同点の時の順を決めるくじ（巡ごと。参加者の番号 → 順番） */
  lots: number[][];
  phase: 'play' | 'break' | 'done';
  /** 続けてパスした人数 */
  passes: number;
  aidUsed: Record<string, boolean>;
  ready: Record<string, boolean>;
  log: M07Log[];
  stage: string;
}

export interface M07View {
  self: CharId | 'spectator';
  players: CharId[];
  seats: number[];
  seat: number;
  owner: number[];
  /** 全員の残りのタイル（置いた形は公開なので、全員に分かる） */
  tiles: Record<string, string[]>;
  round: number;
  rounds: number;
  /** この巡に置けるタイルの大きさの上限 */
  cap: number;
  phase: M07State['phase'];
  order: CharId[];
  toMove: CharId | null;
  scores: Record<string, { cells: number; center: number; link: boolean; points: number }>;
  aidUsed: boolean;
  ready: Record<string, boolean>;
  log: M07Log[];
}

const orderOf = (s: M07State): CharId[] => s.order;

/** 巡の手番順：その時点の得点が低い人から。同点は、巡ごとに引き直すくじの順で決める（先手の有利が同じ席に偏らない） */
function makeOrder(s: { players: CharId[]; seats: number[]; owner: number[]; lots: number[][] }, round: number): CharId[] {
  const pts = s.players.map((_, i) => scoreOf(s.owner, s.seats[i]).points);
  const lot = s.lots[Math.min(round, s.lots.length - 1)];
  return s.players.map((_, i) => i).sort((a, b) => pts[a] - pts[b] || lot[a] - lot[b]).map((i) => s.players[i]);
}
const seatOf = (s: { players: CharId[] }, p: CharId) => s.players.indexOf(p);

/** 目印までの、空きマスを通る最短の残り距離（自分のマスは 0 歩）。届かないなら 99 */
function linkDist(owner: number[], seat: number): number {
  const b = beaconCell(seat);
  if (owner[b] >= 0 && owner[b] !== seat) return 99;
  const dist = new Array<number>(owner.length).fill(99);
  const dq: number[] = [];
  owner.forEach((o, c) => { if (o === seat) { dist[c] = 0; dq.push(c); } });
  // 0-1 幅優先（自分のマスは 0 歩、空きマスは 1 歩）
  while (dq.length) {
    const c = dq.shift()!;
    for (const n of G.adj[c]) {
      if ((owner[n] >= 0 && owner[n] !== seat) || n === TOWER) continue;
      const w = owner[n] === seat ? 0 : 1;
      if (dist[c] + w < dist[n]) { dist[n] = dist[c] + w; if (w === 0) dq.unshift(n); else dq.push(n); }
    }
  }
  return dist[b];
}

const mobility = (owner: number[], seat: number) => { const f = new Set<number>(); owner.forEach((o, c) => { if (o === seat) for (const n of G.adj[c]) if (owner[n] < 0 && n !== TOWER) f.add(n); }); return f.size; };

/**
 * CPU：置ける手をすべて挙げ、増えるマス、中央、目印までの近さ、次に置ける余地、相手の進路をふさぐ効果で選ぶ。
 * 大きいタイルは、置ける場所が残っているうちに使う。
 */
function m07Ai(v: M07View, ctx: AiCtx): M07Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const seat = v.seat;
  const tiles = v.tiles[ctx.self];
  const all = placements(v.owner, seat, tiles, v.cap);
  if (!all.length) return { t: 'pass' };
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.observation); // 副：他者の進路と封鎖に気づく（観察）
  const before = linkDist(v.owner, seat);
  const wasLinked = linked(v.owner, seat);
  const others = v.seats.filter((i) => i !== seat);
  const oppBefore = others.map((i) => mobility(v.owner, i));
  const sd = 0.5 + ctx.noise * 1.3 + (1 - st) * 1.6;
  let best = all[0];
  let bestVal = -Infinity;
  for (const pl of all) {
    const owner = [...v.owner];
    for (const c of pl.cells) owner[c] = seat;
    let val = pl.cells.length + pl.cells.filter(isCenter).length * CENTER_PTS;
    if (!wasLinked) {
      const after = linkDist(owner, seat);
      if (linked(owner, seat)) val += LINK_PTS;
      else if (before < 99) val += (before - Math.min(after, before)) * (0.9 + st * 0.6) - (after >= 99 ? 2 : 0);
    }
    // 他の人の目印を取って連結を止める（読める人ほど狙う）
    for (const i of others) if (pl.cells.includes(beaconCell(i)) && !linked(v.owner, i)) val += 1.2 + lg * 2.2;
    val += (mobility(owner, seat) - mobility(v.owner, seat)) * 0.35;
    // 相手の余地を減らす効果（読める人ほど重く見る）
    val += others.reduce((n, i, k) => n + (oppBefore[k] - mobility(owner, i)), 0) * 0.22 * (0.4 + lg);
    val += ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = pl; }
  }
  return { t: 'place', tile: best.tile, rot: best.rot, at: best.at };
}

export const M07: MatchEngine<M07State, M07Move, M07View> = {
  id: 'm07',
  name: '六角領域',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 6,
  summary: '六角形の盤面に図形タイルを置いて領域を広げる。中央のマスと、開始点から目印までの連結に加点がある。',
  rules: [
    '盤面は六角形 61 マス。真ん中の 1 マスは塔で、誰も置けません。各自の開始点は盤面の角です。全員が同じ図形タイル 12 枚（1〜4 マス）を持ちます。',
    '手番に 1 枚を置きます。空いたマスだけに置け、少なくとも 1 マスが自分の領域と辺で接していなければなりません。タイルは回せます。',
    '置けるタイルの大きさは、第 1 巡は 1 マス、第 2 巡は 2 マスまで、第 3 巡は 3 マスまで。第 4 巡からは制限がありません。',
    '置ける場所が無い時、または置きたくない時はパスできます。',
    '各巡の手番順は、その時点の得点が低い人からです（同点の時は、巡ごとのくじ順）。',
    '得点：自分のマス 1 つにつき 1 点。塔を囲む 6 マスは、さらに 1 つにつき +2 点。',
    '連結目標：自分の開始点と、自分の目印（自分の色の輪。隣の人との間にあります）を、自分の領域でつなぐと +5 点。目印のマスを他の人に取られると達成できません。',
    '全 12 巡。全員が続けてパスした時は、その時点で終わります。得点は終了時の盤面で数えます。',
    '3 巡ごとに 20 秒の交渉があります。不可侵や進路の約束ができますが、守るかどうかは本人次第です。',
    `ピース ${AID_COST} 個で、タイル 1 枚を同じ面積の別の形に替えられます（この競技で 1 回）。`,
    '同点は、一番大きい連結領域のマス数、残ったタイルの面積が小さい順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：パスになります。',
  ],
  init(players, rng: Rng) {
    const owner = new Array<number>(G.cells.length).fill(-1);
    // 人数が少ない時は、開始点が等間隔になるように席を割り当てる
    const seats = players.length === 6 ? [0, 1, 2, 3, 4, 5] : players.length === 3 ? [0, 2, 4] : players.length === 2 ? [0, 3] : players.length === 4 ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
    const s: M07State = {
      players: [...players], owner,
      tiles: Object.fromEntries(players.map((p) => [p, [...START_TILES]])),
      round: 0, turn: 0, order: [...players], phase: 'play', passes: 0,
      aidUsed: Object.fromEntries(players.map((p) => [p, false])),
      ready: Object.fromEntries(players.map((p) => [p, false])),
      log: [], stage: '0-0', seats,
      lots: Array.from({ length: ROUNDS + 1 }, () => { const o = rng.shuffle(players.map((_, i) => i)); const lot: number[] = []; o.forEach((i, k) => { lot[i] = k; }); return lot; }),
    };
    players.forEach((_, i) => { owner[startCell(seats[i])] = seats[i]; });
    s.order = makeOrder(s, 0);
    return s;
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    return [orderOf(s)[s.turn]];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `交渉（次は第 ${s.round + 1} 巡）`, time: BREAK_MS, negotiation: true };
    return { label: `第 ${s.round + 1} 巡 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (orderOf(s)[s.turn] !== p) return false;
    const tiles = s.tiles[p];
    const seat = s.seats[seatOf(s, p)];
    if (m.t === 'pass') return true;
    if (m.t === 'aid') return !s.aidUsed[p] && Number.isInteger(m.tile) && m.tile >= 0 && m.tile < tiles.length && alternatives(tiles[m.tile]).includes(m.to);
    if (m.t !== 'place' || !Number.isInteger(m.tile) || m.tile < 0 || m.tile >= tiles.length || !Number.isInteger(m.rot) || m.rot < 0 || m.rot > 5 || !Number.isInteger(m.at) || m.at < 0 || m.at >= G.cells.length) return false;
    return areaOf(tiles[m.tile]) <= areaCap(s.round) && canPlace(s.owner, seat, cellsOf(tiles[m.tile], m.rot, m.at));
  },
  defaultMove(s) {
    return s.phase === 'break' ? { t: 'ready' } : { t: 'pass' };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m07: illegal move ${JSON.stringify(m)}`);
    const seat = s.seats[seatOf(s, p)];
    if (m.t === 'aid') {
      // 代金の支払いは呼び出し側（画面と CPU）が同じ価格で行う
      s.tiles[p][m.tile] = m.to;
      s.aidUsed[p] = true;
      return;
    }
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `${s.round}-0`; }
      return;
    }
    if (m.t === 'place') {
      const cells = cellsOf(s.tiles[p][m.tile], m.rot, m.at)!;
      for (const c of cells) s.owner[c] = seat;
      s.tiles[p].splice(m.tile, 1);
      s.log.push({ round: s.round, seat, cells });
      s.passes = 0;
    } else {
      s.log.push({ round: s.round, seat, cells: null });
      s.passes += 1;
    }
    s.turn += 1;
    s.stage = `${s.round}-${s.turn}`;
    if (s.passes >= s.players.length) { s.phase = 'done'; return; }
    if (s.turn < s.players.length) return;
    s.turn = 0;
    s.round += 1;
    s.order = makeOrder(s, s.round);
    s.stage = `${s.round}-0`;
    if (s.round >= ROUNDS || s.owner.every((o, c) => o >= 0 || c === TOWER)) { s.phase = 'done'; return; }
    if (s.round % 3 === 0) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      s.stage = `${s.round}-break`;
    }
  },
  view(s, p) {
    const seats = s.seats;
    const me = p === 'spectator' ? null : p;
    return {
      self: p, players: s.players,
      seat: me ? seats[seatOf(s, me)] : -1,
      owner: [...s.owner],
      tiles: Object.fromEntries(s.players.map((x) => [x, [...s.tiles[x]]])),
      round: s.round, rounds: ROUNDS, cap: areaCap(s.round), phase: s.phase,
      order: [...s.order],
      toMove: s.phase === 'play' ? orderOf(s)[s.turn] : null,
      scores: Object.fromEntries(s.players.map((x, i) => [x, scoreOf(s.owner, seats[i])])),
      aidUsed: !!me && s.aidUsed[me],
      ready: { ...s.ready },
      log: s.log,
      seats,
    };
  },
  ai: m07Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    const seats = s.seats;
    return Object.fromEntries(s.players.map((p, i) => [p, scoreOf(s.owner, seats[i]).points]));
  },
  ranking(s) {
    const seats = s.seats;
    const seat = (p: CharId) => seats[seatOf(s, p)];
    const rest = (p: CharId) => s.tiles[p].reduce((n, t) => n + areaOf(t), 0);
    return sortGroups(s.players, (p) => scoreOf(s.owner, seat(p)).points * 100 + largestRegion(s.owner, seat(p)), (p) => -rest(p));
  },
};
