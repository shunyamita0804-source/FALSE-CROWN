/**
 * M10 トライアングル（v11、3 人、三角形の盤面）
 * 正三角形に並んだ 15 個の点（5 段）。3 つの頂点に各自の旗、その隣の 2 点に兵 2 個を置く。内側の 3 点に宝石が 1 個ずつある。
 * 手番に、兵 1 個を隣の点へ 1 歩動かす。敵の兵がいる隣の点へ動くと、その兵を取る（1 点）。旗は動かせず、旗の点には入れない。
 * 宝石のある点へ動くと、その宝石を持つ（兵 1 個が持てるのは 1 個）。自分の旗の隣で、1 手を使って納める（4 点）。
 * 取られた兵が持っていた宝石は、その点に落ちる。納めた宝石は、元の点が空いた時に置き直す（宝石 1 個につき 3 回まで）。
 * 最初の 3 巡は、敵の兵を取れない（先手が一回りするまで。先に 2 回続けて動ける人が有利になるのを防ぐ）。
 * 全 12 巡。先手は巡ごとに交代する。終了時に、持ったままの宝石 1 個につき 1 点、自分の旗の隣にいる兵 1 個につき 1 点。
 * 兵が全滅しても、旗と得点は残る。順位は得点、納めた数、残った兵の数の順。3 巡ごとに 20 秒の交渉がある。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const ROWS = 5;
export const NODES = 15;
export const ROUNDS = 12;
export const DELIVER_PTS = 4;
export const CAP_PTS = 1;
export const HOLD_PTS = 1;
export const HOME_PTS = 1;
export const GEM_USES = 3;
/** 最初の何巡かは、敵の兵を取れない */
export const PEACE = 3;
export const MOVE_MS = 30_000;
export const BREAK_MS = 20_000;

/** 点の番号 → 段と列 */
export const rc = (n: number): [number, number] => { let r = 0; while ((r + 1) * (r + 2) / 2 <= n) r++; return [r, n - (r * (r + 1)) / 2]; };
const idx = (r: number, c: number) => (r * (r + 1)) / 2 + c;
/** 隣の点 */
export const ADJ: number[][] = Array.from({ length: NODES }, (_, n) => {
  const [r, c] = rc(n);
  const out: number[] = [];
  const add = (a: number, b: number) => { if (a >= 0 && a < ROWS && b >= 0 && b <= a) out.push(idx(a, b)); };
  add(r, c - 1); add(r, c + 1); add(r - 1, c - 1); add(r - 1, c); add(r + 1, c); add(r + 1, c + 1);
  return out;
});
/** 旗の点（席 0、1、2） */
export const FLAGS = [0, 10, 14];
/** 旗の隣の 2 点（最初に兵を置く点、納める時に立つ点） */
export const HOME: number[][] = FLAGS.map((f) => ADJ[f]);
/** 宝石の元の点（内側の 3 点。番号 0、1、2 の宝石） */
export const GEM_NODES = [4, 7, 8];

export interface Soldier { seat: number; pos: number; gem: number }
export interface Board {
  soldiers: Soldier[];
  /** 点に落ちている宝石 */
  ground: { node: number; id: number }[];
  /** 置き直しを待っている宝石 */
  waiting: number[];
  /** 宝石ごとの、納められた回数 */
  delivered: number[];
}

export const startBoard = (seats: number[]): Board => ({
  soldiers: seats.flatMap((s) => HOME[s].map((pos) => ({ seat: s, pos, gem: -1 }))),
  ground: GEM_NODES.map((node, id) => ({ node, id })),
  waiting: [],
  delivered: [0, 0, 0],
});

export type Act = { t: 'move'; from: number; to: number } | { t: 'deliver'; from: number };

export function actsOf(b: Board, seat: number, noCap = false): Act[] {
  const out: Act[] = [];
  for (const s of b.soldiers) {
    if (s.seat !== seat) continue;
    if (s.gem >= 0 && HOME[seat].includes(s.pos)) out.push({ t: 'deliver', from: s.pos });
    for (const n of ADJ[s.pos]) {
      if (FLAGS.includes(n)) continue;
      if (b.soldiers.some((q) => q.pos === n && (noCap || q.seat === seat))) continue;
      out.push({ t: 'move', from: s.pos, to: n });
    }
  }
  return out;
}

/**
 * 次に取られうる兵（2026-11-28 本人の指示で、画面に示す）。隣の点に敵の兵がいる自分の兵の位置。
 * 盤面の事実だけで決める（相手が実際に取るかの予測はしない）。capOk が偽（まだ取れない巡）なら空。
 */
export function exposed(b: Board, seat: number, capOk: boolean): number[] {
  if (!capOk) return [];
  return b.soldiers.filter((s) => s.seat === seat && ADJ[s.pos].some((n) => b.soldiers.some((q) => q.pos === n && q.seat !== seat))).map((s) => s.pos);
}

export interface Effect { points: number; cap?: number; capGem?: boolean; pick?: boolean; deliver?: boolean }

function respawn(b: Board): void {
  b.waiting = b.waiting.filter((id) => {
    const node = GEM_NODES[id];
    if (b.soldiers.some((s) => s.pos === node) || b.ground.some((g) => g.node === node)) return true;
    b.ground.push({ node, id });
    return false;
  });
}

/** 手を反映した新しい盤面と、起きたこと */
export function applyAct(b0: Board, seat: number, a: Act): { board: Board; fx: Effect } {
  const b: Board = { soldiers: b0.soldiers.map((s) => ({ ...s })), ground: b0.ground.map((g) => ({ ...g })), waiting: [...b0.waiting], delivered: [...b0.delivered] };
  const s = b.soldiers.find((q) => q.pos === a.from && q.seat === seat)!;
  const fx: Effect = { points: 0 };
  if (a.t === 'deliver') {
    const id = s.gem;
    s.gem = -1;
    b.delivered[id] += 1;
    if (b.delivered[id] < GEM_USES) b.waiting.push(id);
    fx.points = DELIVER_PTS;
    fx.deliver = true;
  } else {
    const vi = b.soldiers.findIndex((q) => q.pos === a.to);
    if (vi >= 0) {
      const v = b.soldiers[vi];
      fx.cap = v.seat;
      fx.points = CAP_PTS;
      if (v.gem >= 0) { b.ground.push({ node: a.to, id: v.gem }); fx.capGem = true; }
      b.soldiers.splice(vi, 1);
    }
    s.pos = a.to;
    if (s.gem < 0) {
      const gi = b.ground.findIndex((g) => g.node === a.to);
      if (gi >= 0) { s.gem = b.ground[gi].id; b.ground.splice(gi, 1); fx.pick = true; }
    }
  }
  respawn(b);
  return { board: b, fx };
}

/** 終了時の加点（持ったままの宝石、旗の隣の兵） */
export const endBonus = (b: Board, seat: number) => b.soldiers.filter((s) => s.seat === seat).reduce((n, s) => n + (s.gem >= 0 ? HOLD_PTS : 0) + (HOME[seat].includes(s.pos) ? HOME_PTS : 0), 0);

export type M10Move = Act | { t: 'pass' } | { t: 'ready' };
export interface M10Log { round: number; seat: number; kind: 'move' | 'deliver' | 'pass'; from?: number; to?: number; fx?: Effect; board: Board; points: number[] }

export interface M10State {
  players: CharId[];
  seats: number[];
  round: number;
  /** この巡で、何人目の手番か */
  k: number;
  phase: 'play' | 'break' | 'done';
  board: Board;
  /** 参加者の並びの順の得点（終了時の加点を含まない） */
  points: number[];
  delivers: number[];
  caps: number[];
  ready: Record<string, boolean>;
  log: M10Log[];
  stage: string;
}

export interface M10View {
  self: CharId | 'spectator';
  /** 自分の番号（参加者の並びの中の位置。観戦は -1） */
  me: number;
  players: CharId[];
  seats: number[];
  round: number;
  rounds: number;
  phase: M10State['phase'];
  toMove: CharId | null;
  order: CharId[];
  board: Board;
  /** 得点（終了後は終了時の加点を含む） */
  points: number[];
  delivers: number[];
  caps: number[];
  ready: Record<string, boolean>;
  log: M10Log[];
}

/** 巡 round の k 番目に動く人の番号（先手は巡ごとに 1 人ずつ後ろへ移る） */
export const turnIdx = (round: number, k: number, n: number) => (round + k) % n;
const alive = (b: Board, seat: number) => b.soldiers.some((s) => s.seat === seat);
export const seatsFor = (n: number) => (n >= 3 ? [0, 1, 2] : [0, 1]);

/** 今の手番の人の番号（いなければ -1）。兵のいない人は飛ばす */
function moverIdx(s: Pick<M10State, 'players' | 'seats' | 'round' | 'k' | 'board'>): number {
  const n = s.players.length;
  for (let k = s.k; k < n; k++) { const i = turnIdx(s.round, k, n); if (alive(s.board, s.seats[i])) return i; }
  return -1;
}

// ---- CPU ----

const DIST: number[][] = Array.from({ length: NODES }, (_, a) => {
  const d = new Array<number>(NODES).fill(99);
  d[a] = 0;
  const q = [a];
  while (q.length) { const c = q.shift()!; for (const n of ADJ[c]) if (!FLAGS.includes(n) && d[n] > d[c] + 1) { d[n] = d[c] + 1; q.push(n); } }
  return d;
});

interface Sim { board: Board; pts: number[]; round: number; k: number }

/** 盤面の評価（席の並びの順）。得点、兵の数、宝石を持って旗に近いか、宝石に近いか */
function evalSim(s: Sim, seats: number[], end: boolean): number[] {
  return seats.map((seat, i) => {
    let v = s.pts[i];
    if (end) return v + endBonus(s.board, seat);
    const left = ROUNDS - s.round;
    for (const sol of s.board.soldiers) {
      if (sol.seat !== seat) continue;
      v += 1.6;
      const home = Math.min(...HOME[seat].map((hn) => DIST[sol.pos][hn]));
      if (sol.gem >= 0) v += home + 1 <= left ? 3.0 - 0.45 * home : HOLD_PTS;
      else if (s.board.ground.length) v -= 0.22 * Math.min(...s.board.ground.map((g) => DIST[sol.pos][g.node]));
      if (left <= 2 && home === 0) v += 0.6;
    }
    return v;
  });
}

function advance(s: Sim, seats: number[]): number {
  // 次の手番の人の番号を返す。巡が終わったら次の巡へ。全部終わったら -1
  const n = seats.length;
  for (;;) {
    if (s.round >= ROUNDS || !s.board.soldiers.length) return -1;
    for (; s.k < n; s.k++) { const i = turnIdx(s.round, s.k, n); if (alive(s.board, seats[i])) return i; }
    s.round += 1;
    s.k = 0;
  }
}

function search(s: Sim, seats: number[], depth: number): number[] {
  const i = advance(s, seats);
  if (i < 0) return evalSim(s, seats, true);
  if (depth <= 0) return evalSim(s, seats, false);
  const acts = actsOf(s.board, seats[i], s.round < PEACE);
  if (!acts.length) return search({ ...s, k: s.k + 1 }, seats, depth - 1);
  let best: number[] | null = null;
  let bestVal = -Infinity;
  for (const a of acts) {
    const { board, fx } = applyAct(s.board, seats[i], a);
    const pts = [...s.pts];
    pts[i] += fx.points;
    const e = search({ board, pts, round: s.round, k: s.k + 1 }, seats, depth - 1);
    const val = e[i] - (e.reduce((x, y) => x + y, 0) - e[i]) / Math.max(1, seats.length - 1) * 0.6;
    if (val > bestVal) { bestVal = val; best = e; }
  }
  return best!;
}

/** CPU：動かせる手をすべて試し、相手の応手まで数手先を読む。読む深さは能力で変わる */
function m10Ai(v: M10View, ctx: AiCtx): M10Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const seat = v.seats[v.me];
  const acts = actsOf(v.board, seat, v.round < PEACE);
  if (!acts.length) return { t: 'pass' };
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.logic);
  const depth = Math.max(1, Math.min(4, Math.round(1.4 + st * 1.8 + lg * 0.8 + ctx.rng.gauss(0, 0.4))));
  const sd = 0.25 + ctx.noise * 0.8 + (1 - st) * 0.8;
  // 巡の中での自分の位置を、盤面の並び（先手が巡ごとにずれる）に合わせる
  const n = v.players.length;
  let kk = 0;
  for (; kk < n; kk++) if (turnIdx(v.round, kk, n) === v.me) break;
  let best: Act = acts[0];
  let bestVal = -Infinity;
  for (const a of acts) {
    const { board, fx } = applyAct(v.board, seat, a);
    const pts = v.points.map((p, i) => p + (i === v.me ? fx.points : 0));
    const e = search({ board, pts, round: v.round, k: kk + 1 }, v.seats, depth - 1);
    const val = e[v.me] - (e.reduce((x, y) => x + y, 0) - e[v.me]) / Math.max(1, n - 1) * 0.6 + ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = a; }
  }
  return best;
}

export const M10: MatchEngine<M10State, M10Move, M10View> = {
  id: 'm10',
  name: 'トライアングル',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 3,
  summary: '三角形の盤面で、兵を 1 歩ずつ動かす。内側の宝石を持ち帰って旗の隣で納める。敵の兵は取れる。',
  rules: [
    '三角形に並んだ 15 個の点の盤面です。3 つの頂点に各自の旗があり、その隣の 2 点に兵が 2 個います。内側の 3 点に、宝石が 1 個ずつあります。',
    '手番に、兵 1 個を、隣の点へ 1 歩動かします。味方の兵がいる点と、旗の点には入れません。旗は動かせません。',
    `敵の兵がいる隣の点へ動くと、その兵を取ります（${CAP_PTS} 点）。取られた兵が宝石を持っていた時は、その点に落ちます。`,
    `最初の ${PEACE} 巡は、敵の兵を取れません（敵の兵がいる点には入れません）。${PEACE + 1} 巡目から取れます。`,
    '宝石のある点へ動くと、その宝石を持ちます。兵 1 個が持てる宝石は 1 個です。',
    `宝石を持った兵が自分の旗の隣にいる時、1 手を使って宝石を納められます（${DELIVER_PTS} 点）。`,
    `納めた宝石は、元の点が空いた時に置き直されます。宝石 1 個につき、納められるのは ${GEM_USES} 回までです。`,
    `全 ${ROUNDS} 巡。先手は巡ごとに交代します。3 巡ごとに 20 秒の交渉があります。`,
    `終了時に、持ったままの宝石 1 個につき ${HOLD_PTS} 点、自分の旗の隣にいる兵 1 個につき ${HOME_PTS} 点が入ります。`,
    '兵が全滅しても、旗と得点は残ります（手番は無くなります）。',
    '1 位だけが決勝に進みます。順位は、得点、納めた数、残った兵の数の順で決めます。それでも同じなら共通決定戦です。2 人で 1 人を攻めることも、途中でやめることも反則ではありません。',
    'ピースで買える補助はありません。',
    '時間切れの場合：納められる時は納めます。それ以外は、取られない点への手が自動で選ばれます。',
  ],
  init(players) {
    const seats = seatsFor(players.length);
    return {
      players: [...players], seats, round: 0, k: 0, phase: 'play', board: startBoard(seats),
      points: players.map(() => 0), delivers: players.map(() => 0), caps: players.map(() => 0),
      ready: Object.fromEntries(players.map((p) => [p, false])), log: [], stage: '0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    const i = moverIdx(s);
    return i < 0 ? [] : [s.players[i]];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `交渉（次は ${s.round + 1} 巡目）`, time: BREAK_MS, negotiation: true };
    return { label: `${s.round + 1} 巡目 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    const i = moverIdx(s);
    if (i < 0 || s.players[i] !== p) return false;
    const acts = actsOf(s.board, s.seats[i], s.round < PEACE);
    if (m.t === 'pass') return acts.length === 0;
    if (m.t === 'deliver') return acts.some((a) => a.t === 'deliver' && a.from === m.from);
    if (m.t === 'move') return acts.some((a) => a.t === 'move' && a.from === m.from && a.to === m.to);
    return false;
  },
  defaultMove(s, p) {
    if (s.phase === 'break') return { t: 'ready' };
    const seat = s.seats[s.players.indexOf(p)];
    const acts = actsOf(s.board, seat, s.round < PEACE);
    if (!acts.length) return { t: 'pass' };
    const del = acts.find((a) => a.t === 'deliver');
    if (del) return del;
    const safe = acts.find((a) => a.t === 'move' && !ADJ[a.to].some((n) => s.board.soldiers.some((q) => q.pos === n && q.seat !== seat)));
    return safe ?? acts[0];
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m10: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `${s.round}-0`; }
      return;
    }
    const i = s.players.indexOf(p);
    const seat = s.seats[i];
    if (m.t === 'pass') s.log.push({ round: s.round, seat, kind: 'pass', board: s.board, points: [...s.points] });
    else {
      const { board, fx } = applyAct(s.board, seat, m);
      s.board = board;
      s.points[i] += fx.points;
      if (fx.deliver) s.delivers[i] += 1;
      if (fx.cap !== undefined) s.caps[i] += 1;
      s.log.push({ round: s.round, seat, kind: m.t, from: m.from, to: m.t === 'move' ? m.to : undefined, fx, board, points: [...s.points] });
    }
    // 次の手番へ。この巡に残りがいなければ次の巡へ
    const n = s.players.length;
    let k0 = 0;
    while (turnIdx(s.round, k0, n) !== i) k0++;
    s.k = k0 + 1;
    s.stage = `${s.round}-${s.log.length}`;
    if (moverIdx(s) >= 0) return;
    s.round += 1;
    s.k = 0;
    if (s.round >= ROUNDS || !s.board.soldiers.length) { s.phase = 'done'; return; }
    if (s.round % 3 === 0) {
      s.phase = 'break';
      s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
      s.stage = `${s.round}-break`;
    }
  },
  view(s, p) {
    const n = s.players.length;
    const i = s.phase === 'play' ? moverIdx(s) : -1;
    const done = s.phase === 'done';
    return {
      self: p, me: p === 'spectator' ? -1 : s.players.indexOf(p), players: s.players, seats: s.seats, round: s.round, rounds: ROUNDS, phase: s.phase,
      toMove: i >= 0 ? s.players[i] : null,
      order: s.players.map((_, j) => turnIdx(Math.min(s.round, ROUNDS - 1), j, n)).filter((j) => alive(s.board, s.seats[j])).map((j) => s.players[j]),
      board: s.board, points: s.points.map((x, j) => x + (done ? endBonus(s.board, s.seats[j]) : 0)),
      delivers: [...s.delivers], caps: [...s.caps], ready: { ...s.ready }, log: s.log,
    };
  },
  ai: m10Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, s.points[i] + (s.phase === 'done' ? endBonus(s.board, s.seats[i]) : 0)]));
  },
  ranking(s) {
    const sc = (p: CharId) => { const i = s.players.indexOf(p); return s.points[i] + endBonus(s.board, s.seats[i]); };
    const left = (p: CharId) => s.board.soldiers.filter((q) => q.seat === s.seats[s.players.indexOf(p)]).length;
    return sortGroups(s.players, (p) => sc(p) * 100 + s.delivers[s.players.indexOf(p)], (p) => left(p));
  },
};

/** 説明と練習に使う盤面（本番とは別） */
export const M10_PRACTICE: Board = { soldiers: [{ seat: 0, pos: 1, gem: -1 }, { seat: 0, pos: 2, gem: -1 }], ground: [{ node: 4, id: 0 }], waiting: [], delivered: [0, 0, 0] };
