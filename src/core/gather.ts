/**
 * 競技会場への集合移動（本人の依頼 2026-11-28）。
 *
 * - 集合案内の後から会場に着くまでを「集合移動中」とする。時計（12:00／18:00）は止まり、競技の制限時間も始まらない。
 * - NPC は食事・会話・休憩を切り上げ、今いる場所から会場へ各自で歩く。歩き出す早さと歩く速さは人ごとに少しずつ違うので、
 *   一列にはならず、廊下や中央ホールで自然に合流する。主人公と同行中の人は主人公について行く。
 * - 会場に入った人は、入口で止まらず参加者席へ進んで座る（席が足りない人は会場の待機地点）。
 * - 監獄マッチでは監獄棟の参加者だけが会場へ向かう。生活棟の人はリビング（dining）へ向かって過ごす。
 * - 遅刻による失格はない。集合期限になったら、まだ着いていない人を会場の席へ安全に移して進む。
 * - 道に詰まった人の救済：同じマスで動けないまま一定時間たつと、主人公から見えていなければ会場へ移す。見えている時は
 *   その場から歩き直し、それでも動けなければ近くの空いたマスへずらす。部屋の経路が無い人はすぐ会場へ移す。
 * - 主人公専用の勝敗補正はない（集合は全員同じ決まりで、着いた順番は競技の結果に使わない）。
 */
import type { CharId, NpcId } from '../data/characters';
import { NPC_BY_ID } from '../data/characters';
import type { Actor, GameState } from './types';
import { aliveIds } from './state';
import { hashString } from './rng';
import { ROOMS } from '../world/maps';
import { roomRoute, nearestFree } from '../world/path';
import { passFn } from '../world/access';
import { collisionOf, moveActor, occupiedSet, placeIn, setPathTo, setRouteTo, speedOf } from '../world/sim';
import { releaseSeat, reserveSeat, seatOf, seatTile, seatPlayers, sitDown } from '../world/seats';

export type GatherKind = 'main' | 'prison';

export interface GatherState {
  kind: GatherKind;
  day: number;
  /** 会場の部屋 */
  venue: string;
  /** 会場へ向かう人（主人公を含むことがある） */
  ids: CharId[];
  /** 会場へ行かず、生活棟のリビングで過ごす人（監獄マッチの日の生活棟の NPC） */
  stay: CharId[];
  /** リビングの部屋（監獄マッチの時だけ使う） */
  stayRoom: string;
  /** 主人公の集合案内を閉じて、歩き始めたか */
  started: boolean;
  /** 集合期限までの残り（シミュレーション時間、ms） */
  left: number;
  /** 歩き出すまでの残り（人ごと、ms）。食事や会話を切り上げる間 */
  depart: Partial<Record<CharId, number>>;
  /** 歩く速さの倍率（人ごと） */
  pace: Partial<Record<CharId, number>>;
  /** 会場（またはリビング）の所定の位置に着いた人 */
  arrived: CharId[];
  /** 主人公と一緒に向かう人（同行中の仲間） */
  companions: CharId[];
  /** 集合中に主人公が話した相手（2 度目は短い返事だけ。関係の値は動かさない） */
  talked: CharId[];
  /** 救済で会場へ移した回数（記録） */
  rescued: number;
  /** 終わった */
  done: boolean;
}

/** 集合の決まり（暫定。M01 の作戦時間と同じく実機で調整する） */
export const GATHER = {
  /** 集合期限（実時間の ms）。会場まで一番遠い個室から歩いても余る長さ */
  limitMs: 90_000,
  /** 歩き出すまでの間（ms）。食事中・会話中・座っている人は長め */
  departMin: 300,
  departMax: 3200,
  departBusy: 2600,
  /** 歩く速さの倍率の幅（一列にならないように） */
  paceMin: 0.88,
  paceMax: 1.1,
  /** 同じマスのまま動けない時間がこれを超えたら救済する */
  stuckMs: 5000,
  /** 主人公の見ている部屋で、ずらしても動けない時に会場へ移すまで */
  stuckHardMs: 14_000,
  /** 主人公が会場に着いて、全員がそろってから進むまでの間 */
  settleMs: 1200,
} as const;

/** 位置が変わらない時間（保存しない。読み込み直後は数え直す） */
const still = new Map<CharId, { key: string; ms: number }>();

const rand01 = (s: GameState, id: string, salt: string) => (hashString(`${s.seed}:${s.day}:${id}:${salt}`) % 10_000) / 10_000;

/** 監獄マッチの日に、生活棟の人が過ごす部屋（新しい館ではリビング＝dining） */
export const LIVING_ROOM = 'dining';

/**
 * 集合を始める。主人公が会場へ向かわない時（監獄マッチの日の生活棟）も、NPC の動きのために作る。
 * companions は自由時間の締切の直前に主人公と同行していた人。
 */
export function newGather(state: GameState, kind: GatherKind, venue: string, ids: CharId[], companions: CharId[] = []): GatherState {
  const stay = kind === 'prison' ? aliveIds(state).filter((id) => id !== 'hero' && !ids.includes(id)) : [];
  const g: GatherState = {
    kind, day: state.day, venue, ids: ids.slice(), stay, stayRoom: LIVING_ROOM, started: false, left: GATHER.limitMs,
    depart: {}, pace: {}, arrived: [], companions: companions.filter((c) => c !== 'hero' && ids.includes(c) && ids.includes('hero')), talked: [], rescued: 0, done: false,
  };
  for (const id of [...g.ids, ...g.stay]) {
    if (id === 'hero') continue;
    const a = state.actors[id];
    a.goal = undefined;
    a.bubble = undefined;
    const busy = !!a.seat || (a.busyUntil ?? 0) > state.simTime;
    // 性格：大会に前のめりな人ほど早く、のんびりした人ほど遅く切り上げる（結果には影響しない演出の差）
    const per = NPC_BY_ID[id as NpcId]?.personality;
    const eager = per ? (per.ambition - 50) / 100 : 0;
    const base = GATHER.departMin + rand01(state, id, 'dep') * (GATHER.departMax - GATHER.departMin);
    g.depart[id] = Math.max(0, Math.round(base * (1 - eager * 0.6) + (busy ? GATHER.departBusy : 0)));
    g.pace[id] = GATHER.paceMin + rand01(state, id, 'pace') * (GATHER.paceMax - GATHER.paceMin);
    a.busyUntil = 0;
    a.waitUntil = 0;
  }
  return g;
}

/** その人の目的地の部屋 */
export const destOf = (g: GatherState, id: CharId): string => (g.stay.includes(id) ? g.stayRoom : g.venue);

/** 主人公が会場へ向かう集合か */
export const heroGoes = (g: GatherState): boolean => g.ids.includes('hero');

/** from から会場までの部屋の列（from を含まない）。行けない時は null */
export function routeFor(state: GameState, who: CharId, from: string, to: string): string[] | null {
  return roomRoute(from, to, passFn(state, who));
}

/**
 * 集合移動中に主人公が入ってよい部屋か。今いる部屋から会場までの最短の道にある部屋だけ（寄り道はできない）。
 * 会場に着いた後は、会場から出られない。
 */
export function heroMayEnter(state: GameState, g: GatherState, room: string): boolean {
  const here = state.actors.hero.pos.room;
  if (here === g.venue) return false;
  const r = routeFor(state, 'hero', here, g.venue);
  return !!r && r[0] === room;
}

/** 主人公の次の行き先（扉）。会場にいる時や道が無い時は null */
export function heroNextDoor(state: GameState, g: GatherState) {
  const here = state.actors.hero.pos.room;
  if (here === g.venue) return null;
  const r = routeFor(state, 'hero', here, g.venue);
  if (!r || !r.length) return null;
  return ROOMS[here].doors.find((d) => d.to === r[0]) ?? null;
}

function markArrived(g: GatherState, id: CharId): void {
  if (!g.arrived.includes(id)) g.arrived.push(id);
}

/** 所定の位置：会場では参加者席（無ければ待機地点）、リビングでは待機地点 */
function settle(state: GameState, g: GatherState, a: Actor): void {
  const room = destOf(g, a.id);
  if (a.seat) { markArrived(g, a.id); return; }
  if (room === g.venue) {
    const mine = seatOf(state, a.id);
    const seat = mine && mine.room === room ? mine.seat : reserveSeat(state, a.id, room, { role: 'player', near: { x: a.pos.x, y: a.pos.y } });
    if (seat) {
      const t = seatTile(seat);
      if (a.pos.x === t.x && a.pos.y === t.y) {
        if (sitDown(state, a.id)) markArrived(g, a.id);
        return;
      }
      if (!a.path.length && !a.step) setPathTo(state, a, t.x, t.y);
      return;
    }
  }
  // 席が無い：待機地点へ（人ごとに別の地点）
  const spots = ROOMS[room].spots;
  const i = Math.max(0, [...g.ids, ...g.stay].indexOf(a.id));
  const spot = spots[i % Math.max(1, spots.length)] ?? { x: a.pos.x, y: a.pos.y };
  const occ = occupiedSet(state, room, a.id);
  const tgt = nearestFree(collisionOf(state, room), spot, occ);
  if ((a.pos.x === tgt.x && a.pos.y === tgt.y) || Math.abs(a.pos.x - spot.x) + Math.abs(a.pos.y - spot.y) <= 1) {
    markArrived(g, a.id);
    return;
  }
  if (!a.path.length && !a.step) setPathTo(state, a, tgt.x, tgt.y);
}

/** 会場（またはリビング）へ、歩かせずに移す（救済と集合期限） */
export function moveSafely(state: GameState, g: GatherState, id: CharId): void {
  const room = destOf(g, id);
  const a = state.actors[id];
  if (a.pos.room !== room) placeIn(state, id, room);
  a.route = [];
  a.path = [];
  a.step = undefined;
  a.busyUntil = 0;
  if (room === g.venue) {
    // 空いている参加者席へ（席の表の順）。座れなければ待機地点に立つ
    if (!a.seat) {
      releaseSeat(state, id);
      const left = seatPlayers(state, room, [id]);
      if (left.length) placeIn(state, id, room, ROOMS[room].spots[g.ids.indexOf(id) % Math.max(1, ROOMS[room].spots.length)]);
    }
  }
  markArrived(g, id);
}

/** NPC と主人公の動きを dt ミリ秒進める。heroWatching は主人公の見ている部屋（救済の見え方に使う） */
export function tickGather(state: GameState, g: GatherState, dt: number): void {
  if (g.done) return;
  const hero = state.actors.hero;
  if (g.started || !heroGoes(g)) g.left = Math.max(0, g.left - dt);
  for (const id of [...g.ids, ...g.stay]) {
    if (id === 'hero') continue;
    const a = state.actors[id];
    if (!a.alive) continue;
    if (g.arrived.includes(id)) {
      // 着いた人は席で待つ。席を立たされていたら座り直す
      if (!a.seat && destOf(g, id) === g.venue && seatOf(state, id)) settle(state, g, a);
      if (a.path.length || a.step) moveActor(state, a, dt, speedOf(id) * (g.pace[id] ?? 1));
      continue;
    }
    // 主人公と話している間は立ち止まる
    if ((a.busyUntil ?? 0) > state.simTime) { still.delete(id); continue; }
    // 食事や会話を切り上げるまでの間（座っている人はここで席を立つ）
    const dep = g.depart[id] ?? 0;
    if (dep > 0) {
      if (g.started || !heroGoes(g)) g.depart[id] = Math.max(0, dep - dt);
      continue;
    }
    if (a.seat && a.pos.room !== destOf(g, id)) releaseSeat(state, id);
    const dest = destOf(g, id);
    const companion = g.companions.includes(id) && hero.pos.room !== g.venue;
    if (companion) {
      // 同行中の仲間：主人公の後ろについて行く（主人公が先に会場へ入れば、そのまま席へ）
      if (a.pos.room !== hero.pos.room) {
        if (!a.route.length && !a.step && !setRouteTo(state, a, hero.pos.room)) moveSafely(state, g, id);
      } else if (!a.step && !a.path.length) {
        const d = Math.abs(a.pos.x - hero.pos.x) + Math.abs(a.pos.y - hero.pos.y);
        if (d > 2) setPathTo(state, a, hero.pos.x, hero.pos.y + 1);
      }
      moveActor(state, a, dt, Math.max(speedOf(id), speedOf('hero')));
      checkStuck(state, g, a, dt, true);
      continue;
    }
    if (a.pos.room !== dest) {
      if (!a.route.length && !a.path.length && !a.step) {
        // 部屋の経路が無い（閉じ込め・つなぎ替え）：すぐ安全に移す
        if (!setRouteTo(state, a, dest) || !a.route.length) { moveSafely(state, g, id); g.rescued++; continue; }
      }
    } else if (!a.route.length) settle(state, g, a);
    moveActor(state, a, dt, speedOf(id) * (g.pace[id] ?? 1));
    if (a.pos.room === dest && !a.route.length && !a.step) settle(state, g, a);
    checkStuck(state, g, a, dt, false);
  }
}

/** 同じマスで動けないままの人を救済する */
function checkStuck(state: GameState, g: GatherState, a: Actor, dt: number, companion: boolean): void {
  if (g.arrived.includes(a.id)) { still.delete(a.id); return; }
  const key = `${a.pos.room}:${a.pos.x},${a.pos.y}`;
  const st = still.get(a.id);
  if (!st || st.key !== key) { still.set(a.id, { key, ms: 0 }); return; }
  st.ms += dt;
  // 同行中で主人公の隣に立っているだけの時は詰まりではない
  if (companion && a.pos.room === state.actors.hero.pos.room) { st.ms = 0; return; }
  if (st.ms < GATHER.stuckMs) return;
  const seen = a.pos.room === state.actors.hero.pos.room;
  if (!seen || st.ms >= GATHER.stuckHardMs) {
    moveSafely(state, g, a.id);
    g.rescued++;
    still.delete(a.id);
    return;
  }
  // 見えている所では、近くの空いたマスへずらしてから歩き直す
  if (!a.step) {
    const grid = collisionOf(state, a.pos.room);
    const occ = occupiedSet(state, a.pos.room, a.id);
    occ.add(key.split(':')[1]);
    const p = nearestFree(grid, { x: a.pos.x, y: a.pos.y }, occ);
    if (Math.abs(p.x - a.pos.x) + Math.abs(p.y - a.pos.y) === 1) a.step = { x: p.x, y: p.y, p: 0 };
    a.path = [];
  }
  st.ms = GATHER.stuckMs * 0.5;
}

/** NPC が全員、所定の位置に着いたか */
export function npcsArrived(g: GatherState, state: GameState): boolean {
  return [...g.ids, ...g.stay].every((id) => id === 'hero' || !state.actors[id].alive || g.arrived.includes(id));
}

/** 会場に着いた人数（主人公を含む）と、向かう人数 */
export function arrivedCount(g: GatherState, state: GameState): { n: number; of: number } {
  const ids = g.ids.filter((id) => state.actors[id].alive);
  const n = ids.filter((id) => (id === 'hero' ? state.actors.hero.pos.room === g.venue : g.arrived.includes(id))).length;
  return { n, of: ids.length };
}

/**
 * 集合を終える（全員到着・集合期限・移動の省略）。まだ着いていない人を安全に所定の位置へ移す。
 * 主人公も会場の参加者席へ着く。
 */
export function finishGather(state: GameState, g: GatherState): void {
  for (const id of [...g.ids, ...g.stay]) {
    if (!state.actors[id].alive) continue;
    if (id === 'hero') continue;
    if (!g.arrived.includes(id) || !(state.actors[id].seat || destOf(g, id) !== g.venue)) moveSafely(state, g, id);
    const a = state.actors[id];
    a.goal = undefined;
    a.route = [];
    a.path = [];
  }
  if (heroGoes(g)) {
    const hero = state.actors.hero;
    hero.route = [];
    hero.path = [];
    hero.step = undefined;
    if (hero.pos.room !== g.venue || !hero.seat) {
      if (hero.pos.room !== g.venue) placeIn(state, 'hero', g.venue);
      releaseSeat(state, 'hero');
      if (seatPlayers(state, g.venue, ['hero']).length) placeIn(state, 'hero', g.venue);
    }
  }
  still.clear();
  g.done = true;
}

/** 開発・試験用：集合を最初から最後まで早送りする（主人公も歩かずに会場へ） */
export function runGatherOffscreen(state: GameState, g: GatherState, stepMs = 100): void {
  g.started = true;
  let t = 0;
  while (!g.done && t < GATHER.limitMs + 1000) {
    state.simTime += stepMs;
    tickGather(state, g, stepMs);
    t += stepMs;
    if (npcsArrived(g, state)) break;
    if (g.left <= 0) break;
  }
  finishGather(state, g);
}
