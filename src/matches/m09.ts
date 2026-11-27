/**
 * M09 四王の戦場・改（v11、4 人、7×7 の盤面）
 * 四隅に、王 1 個と兵 3 個を同じ形で置く。王は縦横斜めに 1 マス、兵は縦横に 1 マス動く。味方のいるマスには動けない。敵のいるマスへ動くと、その駒を取る。
 * 王を取られても、残った兵で続ける。全 16 巡。先手は巡ごとに交代する。
 * 得点：王を取ると 5、兵を取ると 1。巡の終わりに中央のマスにいる駒の持ち主に 2。終了時に自分の王が残っていれば 5。
 * 駒が無い人は手番が無い。駒を持つ人が 1 人だけになったら終わる。
 * 順位は得点、王が残っている、残った兵の数、取った駒の数の順。4 巡ごとに 20 秒の交渉がある。ピースで買える補助はない。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const N = 7;
export const ROUNDS = 16;
export const KING_PTS = 5;
export const SOLDIER_PTS = 1;
export const CENTER_PTS = 2;
export const ALIVE_PTS = 5;
export const MOVE_MS = 30_000;
export const BREAK_MS = 20_000;
export const CENTER = 3 * N + 3;

export interface Piece { seat: number; king: boolean; pos: number }

const xy = (c: number): [number, number] => [c % N, Math.floor(c / N)];
const at = (x: number, y: number) => y * N + x;
/** 席 0（左上）の配置を 90 度ずつ回して 4 席ぶん作る */
const rot = (x: number, y: number, k: number): [number, number] => { let a = x; let b = y; for (let i = 0; i < k; i++) [a, b] = [N - 1 - b, a]; return [a, b]; };
export function startPieces(seats: number[]): Piece[] {
  const base: [number, number, boolean][] = [[0, 0, true], [1, 0, false], [0, 1, false], [1, 1, false]];
  return seats.flatMap((s) => base.map(([x, y, king]) => { const [a, b] = rot(x, y, s); return { seat: s, king, pos: at(a, b) }; }));
}
export const seatsFor = (n: number) => (n >= 4 ? [0, 1, 2, 3] : n === 3 ? [0, 1, 2] : [0, 2]);

const KING_D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SOLDIER_D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** その駒が動けるマス（味方のいるマスを除く） */
export function movesOf(pieces: Piece[], p: Piece): number[] {
  const [x, y] = xy(p.pos);
  const out: number[] = [];
  for (const [dx, dy] of p.king ? KING_D : SOLDIER_D) {
    const a = x + dx;
    const b = y + dy;
    if (a < 0 || b < 0 || a >= N || b >= N) continue;
    const c = at(a, b);
    if (pieces.some((q) => q.pos === c && q.seat === p.seat)) continue;
    out.push(c);
  }
  return out;
}

/** そのマスを次の 1 手で取れる敵の駒（seat 以外）があるか */
export function attackedBy(pieces: Piece[], cell: number, seat: number): Piece[] {
  const [x, y] = xy(cell);
  return pieces.filter((q) => {
    if (q.seat === seat) return false;
    const [a, b] = xy(q.pos);
    const dx = Math.abs(a - x);
    const dy = Math.abs(b - y);
    return q.king ? Math.max(dx, dy) === 1 : dx + dy === 1;
  });
}

export type M09Move = { t: 'move'; from: number; to: number } | { t: 'pass' } | { t: 'ready' };
export interface M09Log { round: number; seat: number; kind: 'move' | 'pass' | 'center'; from?: number; to?: number; king?: boolean; cap?: { seat: number; king: boolean } }

export interface M09State {
  players: CharId[];
  seats: number[];
  pieces: Piece[];
  /** 取った駒と中央の得点（王が残った加点は終了時に足す） */
  points: number[];
  captures: number[];
  round: number;
  turn: number;
  /** この巡の手番順（巡の初めに決める。途中で駒を失った人は飛ばす） */
  order: CharId[];
  phase: 'play' | 'break' | 'done';
  ready: Record<string, boolean>;
  log: M09Log[];
  stage: string;
}

export interface M09View {
  self: CharId | 'spectator';
  players: CharId[];
  seats: number[];
  me: number;
  pieces: Piece[];
  points: number[];
  captures: number[];
  round: number;
  rounds: number;
  phase: M09State['phase'];
  order: CharId[];
  toMove: CharId | null;
  ready: Record<string, boolean>;
  log: M09Log[];
  final: boolean;
}

const hasPieces = (s: Pick<M09State, 'pieces'>, seat: number) => s.pieces.some((p) => p.seat === seat);
const kingAlive = (s: Pick<M09State, 'pieces'>, seat: number) => s.pieces.some((p) => p.seat === seat && p.king);
const soldiers = (s: Pick<M09State, 'pieces'>, seat: number) => s.pieces.filter((p) => p.seat === seat && !p.king).length;
/** 得点（終了後は、王が残った加点を含む） */
export const scoreOf = (s: Pick<M09State, 'pieces' | 'points' | 'seats' | 'phase'>, i: number) => s.points[i] + (s.phase === 'done' && kingAlive(s, s.seats[i]) ? ALIVE_PTS : 0);

function makeOrder(s: M09State): CharId[] {
  const n = s.players.length;
  return s.players.map((_, i) => (i + s.round) % n).filter((i) => hasPieces(s, s.seats[i])).map((i) => s.players[i]);
}

export function legalMoves(pieces: Piece[], seat: number): { from: number; to: number }[] {
  return pieces.filter((p) => p.seat === seat).flatMap((p) => movesOf(pieces, p).map((to) => ({ from: p.pos, to })));
}

const dist = (a: number, b: number) => { const [x1, y1] = xy(a); const [x2, y2] = xy(b); return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); };
const mdist = (a: number, b: number) => { const [x1, y1] = xy(a); const [x2, y2] = xy(b); return Math.abs(x1 - x2) + Math.abs(y1 - y2); };

/**
 * CPU：動かせる手をすべて試す。取れる駒の点、動いた後に取られる危険（王は特に重い）、中央のマス、
 * 王の周りに敵が近づいていないかで選ぶ。読みの重さは能力で変わる。
 */
function m09Ai(v: M09View, ctx: AiCtx): M09Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const seat = v.seats[v.me];
  const all = legalMoves(v.pieces, seat);
  if (!all.length) return { t: 'pass' };
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.logic);
  const sd = 0.3 + ctx.noise * 1.0 + (1 - st) * 1.1;
  const turnIdx = v.order.indexOf(v.self as CharId);
  const lastInRound = turnIdx === v.order.length - 1;
  const roundsLeft = v.rounds - v.round;
  const worth = (p: Piece) => (p.king ? KING_PTS + ALIVE_PTS + 2 : SOLDIER_PTS + 0.8);
  const reach = (q: Piece, c: number) => { const [x1, y1] = [q.pos % N, Math.floor(q.pos / N)]; const [x2, y2] = [c % N, Math.floor(c / N)]; const dx = Math.abs(x1 - x2); const dy = Math.abs(y1 - y2); return q.king ? Math.max(dx, dy) === 1 : dx + dy === 1; };
  // 動いた後に取られる危険。取り返せる位置（味方が利いている）や、中央の駒にしか狙われていない時は軽く見る
  const exposure = (pieces: Piece[]) => {
    let worst = 0;
    let sum = 0;
    for (const p of pieces) {
      if (p.seat !== seat) continue;
      const atk = attackedBy(pieces, p.pos, seat);
      if (!atk.length) continue;
      let w = worth(p);
      if (!p.king) {
        if (pieces.some((q) => q.seat === seat && q !== p && reach(q, p.pos))) w *= 0.5;
        if (atk.every((q) => q.pos === CENTER)) w *= 0.5;
      }
      sum += w;
      if (w > worst) worst = w;
    }
    return worst + (sum - worst) * 0.5;
  };
  let best = all[0];
  let bestVal = -Infinity;
  for (const m of all) {
    const mover = v.pieces.find((p) => p.pos === m.from && p.seat === seat)!;
    const victim = v.pieces.find((p) => p.pos === m.to && p.seat !== seat);
    const next = v.pieces.filter((p) => p !== victim).map((p) => (p === mover ? { ...p, pos: m.to } : p));
    let val = victim ? (victim.king ? KING_PTS : SOLDIER_PTS) + 0.6 + (m.to === CENTER ? 1.2 : 0) : 0;
    val -= exposure(next) * (0.35 + lg * 0.45);
    // 次に取れる敵の駒（狙いを作る）。中央の駒や王を狙う手は価値が高い
    const me2 = next.find((p) => p.pos === m.to && p.seat === seat)!;
    for (const e of next) if (e.seat !== seat && reach(me2, e.pos)) val += (e.king ? 1.6 : 0.3) + (e.pos === CENTER ? 1.1 : 0);
    // 中央：巡の最後の手番なら確実に入る。そうでなければ、取られなければ入る
    if (m.to === CENTER) val += lastInRound ? CENTER_PTS : CENTER_PTS * (attackedBy(next, CENTER, seat).length ? 0.25 : 0.8);
    else if (m.from === CENTER && !victim) val -= CENTER_PTS * 0.6;
    // 兵は中央へ寄せる。王は敵から離す
    if (!mover.king) val += (mdist(m.from, CENTER) - mdist(m.to, CENTER)) * (0.22 + st * 0.2) * (roundsLeft > 2 ? 1 : 0.4);
    else {
      const enemies = next.filter((p) => p.seat !== seat);
      const near = (c: number) => enemies.reduce((n, e) => n + (dist(e.pos, c) <= 2 ? 1 : 0), 0);
      val -= (near(m.to) - near(m.from)) * 0.5;
      if (!victim) val -= 0.25;
    }
    val += ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = m; }
  }
  return { t: 'move', from: best.from, to: best.to };
}

function mover(s: M09State): CharId | null {
  return s.order[s.turn] ?? null;
}

function endRound(s: M09State): void {
  const c = s.pieces.find((p) => p.pos === CENTER);
  if (c) { const i = s.seats.indexOf(c.seat); s.points[i] += CENTER_PTS; s.log.push({ round: s.round, seat: c.seat, kind: 'center' }); }
  s.turn = 0;
  s.round += 1;
  s.stage = `${s.round}-0`;
  if (s.round >= ROUNDS) { s.phase = 'done'; return; }
  s.order = makeOrder(s);
  if (s.round % 4 === 0) {
    s.phase = 'break';
    s.ready = Object.fromEntries(s.players.map((x) => [x, false]));
    s.stage = `${s.round}-break`;
  }
}

export const M09: MatchEngine<M09State, M09Move, M09View> = {
  id: 'm09',
  name: '四王の戦場・改',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 4,
  summary: '7×7 の盤面の四隅から、王 1 個と兵 3 個を動かす。敵の駒を取り、中央のマスを押さえ、自分の王を守る。',
  rules: [
    '盤面は 7×7。四隅に、各自の王 1 個と兵 3 個が置かれています。',
    '手番に、自分の駒を 1 個動かします。王は縦横斜めに 1 マス、兵は縦横に 1 マスです。味方のいるマスには動けません。',
    '敵の駒がいるマスへ動くと、その駒を取ります。王を取られても、残った兵で続けます。',
    `得点：王を取ると ${KING_PTS} 点、兵を取ると ${SOLDIER_PTS} 点。各巡の終わりに、中央のマスにいる駒の持ち主に ${CENTER_PTS} 点。終了時に自分の王が残っていれば ${ALIVE_PTS} 点。`,
    `全 ${ROUNDS} 巡。先手は巡ごとに交代します。駒が無くなった人には手番がありません。駒を持つ人が 1 人だけになった時は、その時点で終わります。`,
    '4 巡ごとに 20 秒の交渉があります。共同で攻める約束や不可侵の約束ができますが、守るかどうかは本人次第です。ピースで買える補助はありません。',
    '同点は、王が残っている、残った兵の数、取った駒の数の順で決めます。それでも同じなら共通決定戦です。',
    '時間切れの場合：取られない位置への手のうち、最初に見つかった手が自動で選ばれます（動かせる駒が無い時はパス）。',
  ],
  init(players) {
    const seats = seatsFor(players.length);
    const s: M09State = {
      players: [...players], seats, pieces: startPieces(seats), points: players.map(() => 0), captures: players.map(() => 0),
      round: 0, turn: 0, order: [], phase: 'play', ready: Object.fromEntries(players.map((p) => [p, false])), log: [], stage: '0-0',
    };
    s.order = makeOrder(s);
    return s;
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    const m = mover(s);
    return m ? [m] : [];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `交渉（次は第 ${s.round + 1} 巡）`, time: BREAK_MS, negotiation: true };
    return { label: `第 ${s.round + 1} 巡 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (mover(s) !== p) return false;
    const seat = s.seats[s.players.indexOf(p)];
    if (m.t === 'pass') return legalMoves(s.pieces, seat).length === 0;
    if (m.t !== 'move' || !Number.isInteger(m.from) || !Number.isInteger(m.to)) return false;
    const pc = s.pieces.find((q) => q.pos === m.from && q.seat === seat);
    return !!pc && movesOf(s.pieces, pc).includes(m.to);
  },
  defaultMove(s, p) {
    if (s.phase === 'break') return { t: 'ready' };
    const seat = s.seats[s.players.indexOf(p)];
    const all = legalMoves(s.pieces, seat);
    if (!all.length) return { t: 'pass' };
    const safe = all.find((m) => {
      const mv = s.pieces.find((q) => q.pos === m.from && q.seat === seat)!;
      const next = s.pieces.filter((q) => q.pos !== m.to || q.seat === seat).map((q) => (q === mv ? { ...q, pos: m.to } : q));
      return !attackedBy(next, m.to, seat).length;
    });
    const m = safe ?? all[0];
    return { t: 'move', from: m.from, to: m.to };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m09: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `${s.round}-0`; }
      return;
    }
    const i = s.players.indexOf(p);
    const seat = s.seats[i];
    if (m.t === 'move') {
      const pc = s.pieces.find((q) => q.pos === m.from && q.seat === seat)!;
      const victim = s.pieces.find((q) => q.pos === m.to);
      if (victim) {
        s.pieces = s.pieces.filter((q) => q !== victim);
        s.points[i] += victim.king ? KING_PTS : SOLDIER_PTS;
        s.captures[i] += 1;
      }
      pc.pos = m.to;
      s.log.push({ round: s.round, seat, kind: 'move', from: m.from, to: m.to, king: pc.king, cap: victim ? { seat: victim.seat, king: victim.king } : undefined });
    } else s.log.push({ round: s.round, seat, kind: 'pass' });
    // 駒を持つ人が 1 人だけになったら終わり
    if (s.seats.filter((x) => hasPieces(s, x)).length <= 1) { s.phase = 'done'; s.stage = 'end'; return; }
    // 次の手番（この巡の途中で駒を失った人は飛ばす）
    s.turn += 1;
    while (s.turn < s.order.length && !hasPieces(s, s.seats[s.players.indexOf(s.order[s.turn])])) s.turn += 1;
    s.stage = `${s.round}-${s.turn}`;
    if (s.turn >= s.order.length) endRound(s);
  },
  view(s, p) {
    return {
      self: p, players: s.players, seats: s.seats, me: p === 'spectator' ? -1 : s.players.indexOf(p),
      pieces: s.pieces.map((q) => ({ ...q })), points: s.players.map((_, i) => scoreOf(s, i)), captures: [...s.captures],
      round: s.round, rounds: ROUNDS, phase: s.phase, order: [...s.order], toMove: s.phase === 'play' ? mover(s) : null,
      ready: { ...s.ready }, log: s.log, final: s.phase === 'done',
    };
  },
  ai: m09Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, scoreOf(s, i)]));
  },
  ranking(s) {
    const idx = (p: CharId) => s.players.indexOf(p);
    return sortGroups(s.players,
      (p) => scoreOf(s, idx(p)) * 100 + (kingAlive(s, s.seats[idx(p)]) ? 10 : 0) + soldiers(s, s.seats[idx(p)]),
      (p) => s.captures[idx(p)]);
  },
};
