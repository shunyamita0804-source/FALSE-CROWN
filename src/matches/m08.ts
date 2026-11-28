/**
 * M08 バリケード（v11、5 人、共通の盤面）
 * 五角形に見える盤面：中心 1 点と、3 重の輪（各 10 点）の計 31 点。隣り合う点（同じ輪の隣、内外の輪の同じ向き、中心と一番内側の輪）が道でつながる。
 * 各自の開始点は外側の輪の角（5 か所）。ゴールは、盤面の反対側にある外側の輪の点。各自、壁を 3 本持つ。
 * 手番に、隣の空いた点へ 1 歩動くか、道 1 本を壁でふさぐ。他の人がいる点には入れないが、隣にいる人は飛び越えられる（道がふさがって動けなくなるのを防ぐ）。誰かのゴールへの道が完全に無くなる壁は置けない。
 * 最大 25 巡。ゴールに着いた人は盤面から外れ、以後は手番が無い。先手は巡ごとに交代する。
 * 順位：着いた巡が早い順（同じ巡なら動いた歩数が少ない順）。着けなかった人は、残りの最短距離が短い順、使った壁が少ない順。
 * 3 巡ごとに 15 秒の相談時間がある。ピースで買える補助はない。
 */
import type { CharId } from '../data/characters';
import { skill, sortGroups, type AiCtx, type MatchEngine } from './types';

export const RINGS = 3;
export const SPOKES = 10;
export const ROUNDS = 25;
export const WALLS = 3;
export const MOVE_MS = 30_000;
export const BREAK_MS = 15_000;

/** 点の番号：0 が中心。輪 k（1〜3）の j 番目（0〜9）は 1 + (k - 1) * 10 + j */
export const NODES = 1 + RINGS * SPOKES;
export const nodeOf = (ring: number, j: number) => (ring === 0 ? 0 : 1 + (ring - 1) * SPOKES + (((j % SPOKES) + SPOKES) % SPOKES));
export const ringOfNode = (n: number) => (n === 0 ? 0 : Math.floor((n - 1) / SPOKES) + 1);
export const spokeOfNode = (n: number) => (n === 0 ? 0 : (n - 1) % SPOKES);

/** 道の一覧（小さい番号、大きい番号） */
export const EDGES: [number, number][] = (() => {
  const out: [number, number][] = [];
  const add = (a: number, b: number) => out.push(a < b ? [a, b] : [b, a]);
  for (let j = 0; j < SPOKES; j++) add(0, nodeOf(1, j));
  for (let k = 1; k <= RINGS; k++) for (let j = 0; j < SPOKES; j++) {
    add(nodeOf(k, j), nodeOf(k, j + 1));
    if (k < RINGS) add(nodeOf(k, j), nodeOf(k + 1, j));
  }
  return out;
})();
/** 点 → [隣の点, 道の番号] */
export const ADJ: [number, number][][] = (() => {
  const adj: [number, number][][] = Array.from({ length: NODES }, () => []);
  EDGES.forEach(([a, b], e) => { adj[a].push([b, e]); adj[b].push([a, e]); });
  return adj;
})();
export const edgeBetween = (a: number, b: number) => ADJ[a].find(([n]) => n === b)?.[1] ?? -1;

/** 席（0〜4）の開始点とゴール。開始点は外側の輪の角、ゴールは反対側の辺の真ん中 */
export const startNode = (seat: number) => nodeOf(RINGS, seat * 2);
export const goalNode = (seat: number) => nodeOf(RINGS, seat * 2 + 5);
/** 人数ごとの席の割り当て（等間隔に近づける） */
export const seatsFor = (n: number) => (n >= 5 ? [0, 1, 2, 3, 4] : n === 4 ? [0, 1, 2, 3] : n === 3 ? [0, 2, 4] : [0, 2]).slice(0, n);

/** ゴールまでの最短の歩数（壁だけを考える。他の人は無視）。届かないなら 99 */
export function distTo(walls: boolean[], from: number, goal: number): number {
  if (from === goal) return 0;
  const dist = new Array<number>(NODES).fill(99);
  dist[goal] = 0;
  const q = [goal];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const [n, e] of ADJ[c]) if (!walls[e] && dist[n] === 99) { dist[n] = dist[c] + 1; if (n === from) return dist[n]; q.push(n); }
  }
  return dist[from];
}

/** ゴールからの距離の表（壁だけを考える） */
export function distMap(walls: boolean[], goal: number): number[] {
  const dist = new Array<number>(NODES).fill(99);
  dist[goal] = 0;
  const q = [goal];
  for (let i = 0; i < q.length; i++) { const c = q[i]; for (const [n, e] of ADJ[c]) if (!walls[e] && dist[n] === 99) { dist[n] = dist[c] + 1; q.push(n); } }
  return dist;
}

export interface M08Log { round: number; seat: number; kind: 'move' | 'wall' | 'pass'; from?: number; to?: number; edge?: number }

export interface M08State {
  players: CharId[];
  seats: number[];
  /** 参加者ごとの今いる点（着いた人は -1） */
  pos: number[];
  walls: boolean[];
  /** 壁を置いた人（道の番号 → 席。無ければ -1） */
  wallBy: number[];
  wallsLeft: number[];
  moves: number[];
  /** 着いた巡（0 始まり。まだなら -1） */
  arrived: number[];
  round: number;
  turn: number;
  phase: 'play' | 'break' | 'done';
  ready: Record<string, boolean>;
  log: M08Log[];
  stage: string;
}

export interface M08View {
  self: CharId | 'spectator';
  players: CharId[];
  seats: number[];
  /** 自分の番号（players の中の位置。観戦は -1） */
  me: number;
  pos: number[];
  walls: boolean[];
  wallBy: number[];
  wallsLeft: number[];
  moves: number[];
  arrived: number[];
  dist: number[];
  round: number;
  rounds: number;
  phase: M08State['phase'];
  order: CharId[];
  toMove: CharId | null;
  /** 手番の人が動ける点と、置ける壁 */
  canMove: number[];
  canWall: number[];
  ready: Record<string, boolean>;
  log: M08Log[];
}

type Core = Pick<M08State, 'players' | 'seats' | 'pos' | 'walls' | 'wallsLeft' | 'arrived'>;

/** 動ける点：隣で、壁が無く、他の人がいない点。隣に人がいる時は、その人を飛び越えた先の空いた点（壁が無い道でつながる点）へも進める */
export function movesFor(s: Core, i: number): number[] {
  const from = s.pos[i];
  if (from < 0) return [];
  const out = new Set<number>();
  for (const [n, e] of ADJ[from]) {
    if (s.walls[e]) continue;
    if (!s.pos.includes(n)) { out.add(n); continue; }
    for (const [m, e2] of ADJ[n]) if (!s.walls[e2] && m !== from && !s.pos.includes(m)) out.add(m);
  }
  return [...out];
}

/** その道に壁を置けるか：まだ壁が無く、置いた後も全員にゴールまでの道が残る */
export function wallOk(s: Core, edge: number): boolean {
  if (edge < 0 || edge >= EDGES.length || s.walls[edge]) return false;
  const w = [...s.walls];
  w[edge] = true;
  return s.players.every((_, i) => s.pos[i] < 0 || distTo(w, s.pos[i], goalNode(s.seats[i])) < 99);
}

export function wallsFor(s: Core, i: number): number[] {
  if (s.pos[i] < 0 || s.wallsLeft[i] <= 0) return [];
  return EDGES.map((_, e) => e).filter((e) => wallOk(s, e));
}

/** この巡の手番順（先手は巡ごとに 1 人ずつずれる。着いた人は除く） */
export function orderAt(s: Pick<M08State, 'players' | 'arrived'>, round: number): CharId[] {
  const n = s.players.length;
  return s.players.map((_, i) => (i + round) % n).filter((i) => s.arrived[i] < 0 || s.arrived[i] === round).map((i) => s.players[i]);
}

const distOf = (s: Pick<M08State, 'pos' | 'walls' | 'seats'>, i: number) => (s.pos[i] < 0 ? 0 : distTo(s.walls, s.pos[i], goalNode(s.seats[i])));

/** 表示用の得点：着いた人は 10 +（残りの巡の数）、着けなかった人は 10 −（残りの距離）。順位の目安 */
export const pointsOf = (s: Pick<M08State, 'pos' | 'walls' | 'seats' | 'arrived'>, i: number) => (s.arrived[i] >= 0 ? 10 + ROUNDS - s.arrived[i] : Math.max(0, 10 - distOf(s, i)));

/**
 * CPU：壁を考えた最短の道を進む。自分より先に着きそうな人がいて、壁 1 本で大きく遠回りさせられる時は壁を置く。
 * 道が他の人でふさがっている時は、遠回りが小さい方へ動く。
 */
function m08Ai(v: M08View, ctx: AiCtx): M08Move {
  if (v.phase !== 'play') return { t: 'ready' };
  const i = v.me;
  const st = skill(ctx.stats.strategy);
  const lg = skill(ctx.stats.observation); // 副：他者の進路と壁に気づく（観察）
  const goal = goalNode(v.seats[i]);
  // 他の人がいる点は、通れるが遠回りと同じくらい損だと見て道を選ぶ
  const occupied = new Set(v.pos.filter((p, k) => p >= 0 && k !== i));
  const dm = new Array<number>(NODES).fill(99);
  dm[goal] = 0;
  const open = [goal];
  while (open.length) {
    open.sort((a, b) => dm[a] - dm[b]);
    const c = open.shift()!;
    for (const [n, e] of ADJ[c]) {
      if (v.walls[e]) continue;
      const w = dm[c] + 1 + (occupied.has(c) ? 1.5 : 0);
      if (w < dm[n]) { dm[n] = w; if (!open.includes(n)) open.push(n); }
    }
  }
  const sd = 0.2 + ctx.noise * 0.8 + (1 - st) * 0.8;
  let best: M08Move = { t: 'pass' };
  let bestVal = -Infinity;
  const myDist = v.dist[i];
  // 直前にいた点へ戻るのは損（行ったり来たりを避ける）
  const mine = v.log.filter((l) => l.seat === v.seats[i] && l.kind === 'move');
  const cameFrom = mine.length ? mine[mine.length - 1].from : -1;
  for (const n of v.canMove) {
    const val = -dm[n] + (n === goal ? 3 : 0) - (n === cameFrom ? 0.6 : 0) + ctx.rng.gauss(0, sd);
    if (val > bestVal) { bestVal = val; best = { t: 'move', to: n }; }
  }
  const moveVal = bestVal;
  if (v.wallsLeft[i] > 0 && myDist > 1) {
    const rivals = v.players.map((_, k) => k).filter((k) => k !== i && v.pos[k] >= 0);
    // 着いた人の数で、止める必要の強さが変わる（残りの席が少ないほど、先行する人を止めたい）
    for (const e of v.canWall) {
      const w = [...v.walls];
      w[e] = true;
      if (distTo(w, v.pos[i], goal) > myDist) continue;
      let gain = 0;
      for (const k of rivals) {
        const d = distTo(w, v.pos[k], goalNode(v.seats[k])) - v.dist[k];
        if (d <= 0) continue;
        // 自分より先に着きそうな人で、ゴールが近い人ほど重く見る
        const ahead = v.dist[k] < myDist ? 1 : v.dist[k] === myDist ? 0.6 : 0.15;
        const near = v.dist[k] <= 2 ? 1 : v.dist[k] <= 3 ? 0.6 : 0.3;
        gain += Math.min(d, 4) * ahead * near;
      }
      if (gain < 1) continue;
      // 壁を置くと自分は 1 手遅れる
      const val = moveVal - 1.6 + gain * (0.6 + lg * 0.6) + ctx.rng.gauss(0, sd);
      if (val > bestVal) { bestVal = val; best = { t: 'wall', edge: e }; }
    }
  }
  return best;
}

export type M08Move = { t: 'move'; to: number } | { t: 'wall'; edge: number } | { t: 'pass' } | { t: 'ready' };

function mover(s: M08State): CharId | null {
  const o = orderAt(s, s.round);
  return o[s.turn] ?? null;
}

/** 手番を次へ進める。着いた人は飛ばす */
function advance(s: M08State): void {
  s.turn += 1;
  s.stage = `${s.round}-${s.turn}`;
  if (s.pos.every((p) => p < 0)) { s.phase = 'done'; return; }
  // 残りが 1 人になったら終わり（順位が決まる）
  if (s.pos.filter((p) => p >= 0).length <= 1 && s.players.length > 1) { s.phase = 'done'; return; }
  if (s.turn < orderAt(s, s.round).length) return;
  s.turn = 0;
  s.round += 1;
  s.stage = `${s.round}-0`;
  if (s.round >= ROUNDS) { s.phase = 'done'; return; }
  if (s.round % 3 === 0) {
    s.phase = 'break';
    s.ready = Object.fromEntries(s.players.map((x) => [x, s.pos[s.players.indexOf(x)] < 0]));
    s.stage = `${s.round}-break`;
    if (s.players.every((x) => s.ready[x])) s.phase = 'play';
  }
}

export const M08: MatchEngine<M08State, M08Move, M08View> = {
  id: 'm08',
  name: 'バリケード',
  kind: 'main',
  minPlayers: 2,
  maxPlayers: 5,
  summary: '五角形の盤面を、反対側のゴールまで 1 歩ずつ進む。壁 3 本で相手の道をふさげる。早く着いた順に上位。',
  rules: [
    '盤面は、中心の 1 点と 3 重の輪（各 10 点）です。線でつながった隣の点へ動けます。',
    '各自の開始点は外側の角です。ゴールは、盤面の反対側にある外側の点（自分の色の旗）です。',
    '手番にできることは 1 つ：隣の空いた点へ 1 歩動くか、道 1 本を壁でふさぐかです。壁は 1 人 3 本まで。',
    '他の人がいる点には入れません。隣の点に人がいる時は、その人を飛び越えて、その先の空いた点へ進めます（1 歩と数えます）。',
    '壁のある道は誰も通れません。飛び越える時も、壁は越えられません。',
    '誰かのゴールへの道が完全に無くなる壁は置けません。',
    `最大 ${ROUNDS} 巡。ゴールに着いた人は盤面から外れ、以後は手番がありません。先手は巡ごとに交代します。`,
    '順位：ゴールに着いた巡が早い順。同じ巡なら、動いた歩数が少ない順。着けなかった人は、残りの最短距離が短い順、使った壁が少ない順。',
    '3 巡ごとに 15 秒の相談時間があります。壁の置き方の協力ができますが、守るかどうかは本人次第です。ピースで買える補助はありません。',
    '動ける点も置ける壁も無い時はパスになります。それでも同じ順位なら共通決定戦です。',
    '時間切れの場合：ゴールに一番近づく点へ自動で 1 歩動きます（動けない時はパス）。',
  ],
  init(players) {
    const seats = seatsFor(players.length);
    return {
      players: [...players], seats, pos: seats.map(startNode), walls: new Array<boolean>(EDGES.length).fill(false), wallBy: new Array<number>(EDGES.length).fill(-1),
      wallsLeft: players.map(() => WALLS), moves: players.map(() => 0), arrived: players.map(() => -1),
      round: 0, turn: 0, phase: 'play', ready: Object.fromEntries(players.map((p) => [p, false])), log: [], stage: '0-0',
    };
  },
  pending(s) {
    if (s.phase === 'done') return [];
    if (s.phase === 'break') return s.players.filter((p) => !s.ready[p]);
    const m = mover(s);
    return m ? [m] : [];
  },
  stage(s) {
    if (s.phase === 'done') return { label: '終了' };
    if (s.phase === 'break') return { label: `相談（次は第 ${s.round + 1} 巡）`, time: BREAK_MS, negotiation: true };
    return { label: `第 ${s.round + 1} 巡 / ${ROUNDS}`, time: MOVE_MS };
  },
  validate(s, p, m) {
    if (!m || s.phase === 'done' || !s.players.includes(p)) return false;
    if (s.phase === 'break') return m.t === 'ready' && !s.ready[p];
    if (mover(s) !== p) return false;
    const i = s.players.indexOf(p);
    if (m.t === 'move') return Number.isInteger(m.to) && movesFor(s, i).includes(m.to);
    if (m.t === 'wall') return s.wallsLeft[i] > 0 && Number.isInteger(m.edge) && wallOk(s, m.edge);
    return m.t === 'pass' && movesFor(s, i).length === 0;
  },
  defaultMove(s, p) {
    if (s.phase === 'break') return { t: 'ready' };
    const i = s.players.indexOf(p);
    const ms = movesFor(s, i);
    if (!ms.length) return { t: 'pass' };
    const dm = distMap(s.walls, goalNode(s.seats[i]));
    return { t: 'move', to: ms.reduce((a, b) => (dm[b] < dm[a] ? b : a)) };
  },
  submit(s, p, m) {
    if (!this.validate(s, p, m)) throw new Error(`m08: illegal move ${JSON.stringify(m)}`);
    if (m.t === 'ready') {
      s.ready[p] = true;
      if (s.players.every((x) => s.ready[x])) { s.phase = 'play'; s.stage = `${s.round}-0`; }
      return;
    }
    const i = s.players.indexOf(p);
    const seat = s.seats[i];
    if (m.t === 'move') {
      s.log.push({ round: s.round, seat, kind: 'move', from: s.pos[i], to: m.to });
      s.pos[i] = m.to;
      s.moves[i] += 1;
      if (m.to === goalNode(seat)) { s.arrived[i] = s.round; s.pos[i] = -1; }
    } else if (m.t === 'wall') {
      s.walls[m.edge] = true;
      s.wallBy[m.edge] = seat;
      s.wallsLeft[i] -= 1;
      s.log.push({ round: s.round, seat, kind: 'wall', edge: m.edge });
    } else s.log.push({ round: s.round, seat, kind: 'pass' });
    // 着いた人はこの巡の順に残るので、番号はそのまま進める
    advance(s);
  },
  view(s, p) {
    const me = p === 'spectator' ? -1 : s.players.indexOf(p);
    const m = s.phase === 'play' ? mover(s) : null;
    const mi = m ? s.players.indexOf(m) : -1;
    return {
      self: p, players: s.players, seats: s.seats, me, pos: [...s.pos], walls: [...s.walls], wallBy: [...s.wallBy], wallsLeft: [...s.wallsLeft], moves: [...s.moves], arrived: [...s.arrived],
      dist: s.players.map((_, i) => distOf(s, i)), round: s.round, rounds: ROUNDS, phase: s.phase,
      order: orderAt(s, Math.min(s.round, ROUNDS - 1)), toMove: m,
      canMove: mi >= 0 ? movesFor(s, mi) : [], canWall: mi >= 0 ? wallsFor(s, mi) : [],
      ready: { ...s.ready }, log: s.log,
    };
  },
  ai: m08Ai,
  done(s) {
    return s.phase === 'done';
  },
  scores(s) {
    return Object.fromEntries(s.players.map((p, i) => [p, pointsOf(s, i)]));
  },
  ranking(s) {
    const idx = (p: CharId) => s.players.indexOf(p);
    return sortGroups(s.players,
      (p) => { const i = idx(p); return s.arrived[i] >= 0 ? 100000 - s.arrived[i] * 1000 - s.moves[i] : -distOf(s, i) * 10; },
      (p) => { const i = idx(p); return s.arrived[i] >= 0 ? 0 : -(WALLS - s.wallsLeft[i]); });
  },
};
