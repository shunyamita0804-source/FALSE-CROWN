/**
 * フィールド上の移動シミュレーション（描画 FPS と無関係に、シミュレーション時間で進む）。
 * 1 タイルずつの移動。NPC の経路は 4 方向。主人公はスティックとキーボードで斜めにも 1 マス進める
 * （斜めの 1 歩は √2 倍の距離を同じ速さで歩くので、斜めだけ速くはならない）。
 */
import { ALL_IDS, type CharId } from '../data/characters';
import { CONFIG } from '../data/config';
import type { Actor, Dir, GameState } from '../core/types';
import { canEnter, passFn } from './access';
import { ROOMS, buildCollision, doorApproach, doorAt, doorDir, findDoor, type DoorDef } from './maps';
import { findPath, nearestFree, roomRoute } from './path';
import { cellOf, cellSpots, gateOpen, seatAllowed, type CellRef } from './cells';
import { gateKey } from './furnitureGrid';
import type { Seat } from './furniture';
import { homeOf } from './rooms';
import { releaseSeat, seatTargetAt, seatTile } from './seats';
import { face4, octant, type Vec } from '../input/stick';

const gridCache = new Map<string, { key: string; grid: boolean[][] }>();

export function collisionOf(state: GameState, roomId: string): boolean[][] {
  const room = ROOMS[roomId];
  // 房の格子の扉（消灯の間、人が入っている房は閉まる）
  const open = (cellId: string) => gateOpen(state, roomId, cellId);
  const key = room.props.map((p) => (p.showIf ? (state.flags[p.showIf] ? 1 : 0) : p.hideIf ? (state.flags[p.hideIf] ? 1 : 0) : '')).join('') + '|' + gateKey(roomId, open);
  const c = gridCache.get(roomId);
  if (c && c.key === key) return c.grid;
  const grid = buildCollision(room, state.flags, open);
  gridCache.set(roomId, { key, grid });
  return grid;
}

export function actorsIn(state: GameState, roomId: string): Actor[] {
  return ALL_IDS.map((id) => state.actors[id]).filter((a) => a.alive && a.pos.room === roomId);
}

export function occupiedSet(state: GameState, roomId: string, except?: CharId): Set<string> {
  const set = new Set<string>();
  for (const a of actorsIn(state, roomId)) {
    if (a.id === except) continue;
    set.add(`${a.pos.x},${a.pos.y}`);
    if (a.step) set.add(`${a.step.x},${a.step.y}`);
  }
  return set;
}

export const DIRS: Record<Dir, { dx: number; dy: number }> = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function dirTo(fx: number, fy: number, tx: number, ty: number): Dir {
  const dx = tx - fx;
  const dy = ty - fy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** 扉の通過の記録（画面側が開閉の演出と音に使う。保存はしない） */
export interface DoorPass { room: string; door: string; who: CharId; arrive: boolean }
const passes: DoorPass[] = [];
export function drainDoorPasses(): DoorPass[] {
  return passes.splice(0);
}

/** 扉を通って隣の部屋へ移動する */
export function enterDoor(state: GameState, a: Actor, door: DoorDef): boolean {
  if (!canEnter(state, a.id, door.to, door.lock)) return false;
  const target = ROOMS[door.to];
  const td = findDoor(target, door.toDoor);
  if (!target || !td) return false;
  const tiles = doorApproach(target, td);
  const occ = occupiedSet(state, target.id, a.id);
  const grid = collisionOf(state, target.id);
  let spot = tiles.find((t) => !occ.has(`${t.x},${t.y}`) && !grid[t.y][t.x]);
  if (!spot) spot = nearestFree(grid, tiles[0], occ);
  const d = doorDir(td);
  const facing: Dir = d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left';
  if (passes.length > 64) passes.splice(0, 32);
  passes.push({ room: a.pos.room, door: door.id, who: a.id, arrive: false }, { room: target.id, door: td.id, who: a.id, arrive: true });
  releaseSeat(state, a.id);
  a.pos = { room: target.id, x: spot.x, y: spot.y, dir: facing };
  a.step = undefined;
  a.path = [];
  return true;
}

/** 1 歩踏み出す。成功したら true */
export function tryStep(state: GameState, a: Actor, dir: Dir): boolean {
  if (a.step) return false;
  // 座っている人は、歩き出す前に立つ（席を空ける）
  if (a.seat) releaseSeat(state, a.id);
  a.pos.dir = dir;
  const { dx, dy } = DIRS[dir];
  const nx = a.pos.x + dx;
  const ny = a.pos.y + dy;
  const grid = collisionOf(state, a.pos.room);
  if (ny < 0 || nx < 0 || ny >= grid.length || nx >= grid[0].length || grid[ny][nx]) return false;
  if (occupiedSet(state, a.pos.room, a.id).has(`${nx},${ny}`)) return false;
  a.step = { x: nx, y: ny, p: 0 };
  return true;
}

function dirOf(dx: number, dy: number): Dir {
  return dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
}

/** 壁（部屋の外を含む） */
function wallAt(grid: boolean[][], x: number, y: number): boolean {
  return y < 0 || x < 0 || y >= grid.length || x >= grid[0].length || grid[y][x];
}

/** 斜めに 1 歩。角は削らない（縦横どちらかの隣が壁なら通れない）。両隣が人でふさがっている時も通らない */
export function tryDiagonal(state: GameState, a: Actor, dx: number, dy: number, face: Dir): boolean {
  if (a.step) return false;
  const nx = a.pos.x + dx;
  const ny = a.pos.y + dy;
  const grid = collisionOf(state, a.pos.room);
  if (wallAt(grid, nx, ny) || wallAt(grid, nx, a.pos.y) || wallAt(grid, a.pos.x, ny)) return false;
  const occ = occupiedSet(state, a.pos.room, a.id);
  if (occ.has(`${nx},${ny}`)) return false;
  if (occ.has(`${nx},${a.pos.y}`) && occ.has(`${a.pos.x},${ny}`)) return false;
  if (a.seat) releaseSeat(state, a.id);
  a.pos.dir = face;
  a.step = { x: nx, y: ny, p: 0 };
  return true;
}

/** 前の 1 歩の向き（境目で 8 方向がちらつかないようにする。保存しない） */
const lastStep = new Map<string, { dx: number; dy: number }>();

/**
 * 入力の向き（スティックかキーボード）へ 1 歩。斜めに進めない時は、近い方の縦横へ壁沿いに進む。
 * 向きは近い 4 方向で表す。成功したら true
 */
export function stepToward(state: GameState, a: Actor, v: Vec): boolean {
  if (a.step) return false;
  const o = octant(v, lastStep.get(a.id));
  let face = face4(v, a.pos.dir);
  let ok = false;
  if (o.dx && o.dy) {
    // 向きは斜めの成分のどちらかにする
    if (face !== dirOf(o.dx, 0) && face !== dirOf(0, o.dy)) face = Math.abs(v.x) >= Math.abs(v.y) ? dirOf(o.dx, 0) : dirOf(0, o.dy);
    ok = tryDiagonal(state, a, o.dx, o.dy, face);
    if (!ok) {
      const axes: [number, number][] = Math.abs(v.x) >= Math.abs(v.y) ? [[o.dx, 0], [0, o.dy]] : [[0, o.dy], [o.dx, 0]];
      for (const [x, y] of axes) if ((ok = tryStep(state, a, dirOf(x, y)))) break;
      if (!ok) a.pos.dir = face;
    }
  } else ok = tryStep(state, a, dirOf(o.dx, o.dy));
  const st = (a as Actor).step as Actor['step'];
  if (ok && st) lastStep.set(a.id, { dx: st.x - a.pos.x, dy: st.y - a.pos.y });
  return ok;
}

/** 目的地（同じ部屋のタイル）までの経路を設定 */
export function setPathTo(state: GameState, a: Actor, x: number, y: number): boolean {
  const grid = collisionOf(state, a.pos.room);
  const from = a.step ? { x: a.step.x, y: a.step.y } : { x: a.pos.x, y: a.pos.y };
  let goal = { x, y };
  if (grid[y]?.[x] !== false) goal = nearestFree(grid, goal);
  const path = findPath(grid, from, goal, occupiedSet(state, a.pos.room, a.id));
  if (!path) return false;
  a.path = path;
  return true;
}

/** 別の部屋を含む目的地を設定（route は部屋列） */
export function setRouteTo(state: GameState, a: Actor, roomId: string, spot?: { x: number; y: number }): boolean {
  if (a.pos.room === roomId) {
    a.route = [];
    if (spot) return setPathTo(state, a, spot.x, spot.y);
    return true;
  }
  const route = roomRoute(a.pos.room, roomId, passFn(state, a.id));
  if (!route) return false;
  a.route = route;
  a.path = [];
  return true;
}

function nextDoor(a: Actor): DoorDef | undefined {
  const next = a.route[0];
  if (!next) return undefined;
  return ROOMS[a.pos.room].doors.find((d) => d.to === next);
}

/** アクターの移動を dt ミリ秒進める */
export function moveActor(state: GameState, a: Actor, dt: number, speed: number, halt = false): void {
  // 座っている人が動く時は、先に立つ（席を空ける）
  if (a.seat && (a.step || a.path.length || a.route.length)) releaseSeat(state, a.id);
  let budget = (dt / 1000) * speed;
  let guard = 0;
  while (budget > 0 && guard++ < 8) {
    // halt：いま踏み出している 1 マスだけ歩き切って、その場で立ち止まる（経路は残す）
    if (halt && !a.step) break;
    if (a.step) {
      // 斜めの 1 歩は √2 倍の距離。進み具合（p）を距離で割って、速さを縦横と同じにする
      const len = a.step.x !== a.pos.x && a.step.y !== a.pos.y ? Math.SQRT2 : 1;
      const need = (1 - a.step.p) * len;
      if (budget >= need) {
        budget -= need;
        a.pos.x = a.step.x;
        a.pos.y = a.step.y;
        a.step = undefined;
        // 方向キーを押し続けている間は、余った時間を捨てずにそのまま次の 1 マスへ進む（速度を一定に保つ）
        if (a.intentV && !a.path.length && !a.route.length && !stepToward(state, a, a.intentV)) break;
      } else {
        a.step.p += budget / len;
        budget = 0;
      }
      continue;
    }
    // 経路がなく、部屋間ルートがあれば扉へ向かう
    if (!a.path.length && a.route.length) {
      const door = nextDoor(a);
      if (!door) {
        a.route = [];
        break;
      }
      const room = ROOMS[a.pos.room];
      const tiles = doorApproach(room, door);
      const at = tiles.find((t) => t.x === a.pos.x && t.y === a.pos.y);
      // 扉の前のマスがすべて人で埋まっている時は、その隣からでも通れる（入口で列になって詰まらないようにする）
      const occNow = occupiedSet(state, a.pos.room, a.id);
      const squeeze = !at && tiles.every((t) => occNow.has(`${t.x},${t.y}`)) && tiles.some((t) => Math.abs(t.x - a.pos.x) + Math.abs(t.y - a.pos.y) === 1);
      if (at || squeeze) {
        a.pos.dir = doorDir(door);
        if (enterDoor(state, a, door)) a.route.shift();
        else a.route = [];
        break;
      }
      const grid = collisionOf(state, a.pos.room);
      const occ = occupiedSet(state, a.pos.room, a.id);
      let best: { x: number; y: number }[] | null = null;
      // 人が立っている扉の前のマスは避ける（空いているマスが無い時だけ、そこを目指して隣で待つ）
      const freeTiles = tiles.filter((t) => !occ.has(`${t.x},${t.y}`));
      for (const t of freeTiles.length ? freeTiles : tiles) {
        const p = findPath(grid, a.pos, t, occ);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (!best) {
        a.route = [];
        break;
      }
      a.path = best;
    }
    if (!a.path.length) break;
    const nxt = a.path[0];
    const dir = dirTo(a.pos.x, a.pos.y, nxt.x, nxt.y);
    if (Math.abs(nxt.x - a.pos.x) + Math.abs(nxt.y - a.pos.y) !== 1) {
      a.path = [];
      break;
    }
    if (tryStep(state, a, dir)) {
      a.path.shift();
    } else {
      // 塞がれている：少し待って再探索
      const goal = a.path[a.path.length - 1];
      a.path = [];
      if (a.id !== 'hero' && goal) {
        const grid = collisionOf(state, a.pos.room);
        const p = findPath(grid, a.pos, goal, occupiedSet(state, a.pos.room, a.id));
        if (p && p.length && !occupiedSet(state, a.pos.room, a.id).has(`${p[0].x},${p[0].y}`)) a.path = p;
      }
      break;
    }
  }
  a.moving = !!a.step || a.path.length > 0 || a.route.length > 0;
}

export function speedOf(id: CharId): number {
  return id === 'hero' ? CONFIG.npc.heroWalkSpeed : CONFIG.npc.walkSpeed;
}

export function distance(a: Actor, b: Actor): number {
  if (a.pos.room !== b.pos.room) return 999;
  return Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y);
}

/** a の正面のタイル */
export function facingTile(a: Actor): { x: number; y: number } {
  const d = DIRS[a.pos.dir];
  return { x: a.pos.x + d.dx, y: a.pos.y + d.dy };
}

/** プレイヤーが進もうとした先が扉なら、その扉 */
export function heroDoor(state: GameState, dir: Dir): DoorDef | undefined {
  const a = state.actors.hero;
  return doorAt(ROOMS[a.pos.room], a.pos.x, a.pos.y, dir);
}

/** アクターを部屋の空いている地点に配置 */
export function placeIn(state: GameState, id: CharId, roomId: string, near?: { x: number; y: number }): void {
  const a = state.actors[id];
  const room = ROOMS[roomId];
  const grid = collisionOf(state, roomId);
  const occ = occupiedSet(state, roomId, id);
  const base = near ?? room.spots[0] ?? { x: Math.floor(room.w / 2), y: Math.floor(room.h / 2) };
  const p = nearestFree(grid, base, occ);
  releaseSeat(state, id);
  a.pos = { room: roomId, x: p.x, y: p.y, dir: 'down' };
  a.step = undefined;
  a.path = [];
  a.route = [];
  a.moving = false;
}

/** その部屋で、その人が使える席かどうかの判定（立つ位置へ歩いて行ける席で、房の中の椅子は本人の房だけ） */
export function seatUsable(state: GameState, who: CharId, roomId: string): (seat: Seat) => boolean {
  const grid = collisionOf(state, roomId);
  return (seat) => {
    const t = seatTile(seat);
    return grid[t.y]?.[t.x] === false && seatAllowed(state, who, roomId, seat);
  };
}

/** 房の中で寝起きするマス（寝台の脇。そこへ歩いて行けない時は、房の中か、いちばん近い通れるマス） */
export function cellSleepTile(state: GameState, c: CellRef): { x: number; y: number } {
  const grid = collisionOf(state, c.room);
  const spots = cellSpots(c);
  return spots.find((t) => grid[t.y]?.[t.x] === false) ?? nearestFree(grid, spots[spots.length - 1]);
}

/** 寝起きする場所（部屋とマス）。生活棟は自分の個室、監獄棟は自分の房の寝台の脇 */
export function homeSpot(state: GameState, who: CharId): { room: string; spot?: { x: number; y: number } } {
  const room = homeOf(state, who);
  const c = cellOf(state, who);
  return { room, spot: c ? cellSleepTile(state, c) : ROOMS[room]?.spots[0] };
}

/** 寝起きする場所へ置く（消灯、起床、棟分けの直後） */
export function placeHome(state: GameState, who: CharId): void {
  const h = homeSpot(state, who);
  placeIn(state, who, h.room, cellOf(state, who) ? h.spot : undefined);
}

/**
 * 無くなった部屋、使わなくなった部屋（以前の房の部屋 cell_p01〜）にいる人を、寝起きする場所へ移す。
 * 古いセーブを読んだ時と、場面の切り替えで呼ぶ。動かした人がいれば true。
 */
export function relocateStranded(state: GameState): boolean {
  let moved = false;
  for (const id of ALL_IDS) {
    const a = state.actors[id];
    if (!a?.alive) continue;
    if (ROOMS[a.pos.room] && !/^cell_p\d+$/.test(a.pos.room)) continue;
    placeHome(state, id);
    moved = true;
  }
  return moved;
}

export type NearbyAction = { kind: 'stand' } | { kind: 'sit'; seat: Seat } | { kind: 'bed' };

/**
 * 話す相手も調べる物もない時に、その場でできること（主人公の行動ボタン）。
 * 座っていれば「立つ」、自分の房の寝台の脇なら「寝台」、空いている椅子のそばなら「座る」。
 */
export function nearbyAction(state: GameState, who: CharId = 'hero'): NearbyAction | null {
  const a = state.actors[who];
  if (!a?.alive || a.step) return null;
  if (a.seat) return { kind: 'stand' };
  const c = cellOf(state, who);
  if (c && c.room === a.pos.room) {
    const t = cellSleepTile(state, c);
    if (Math.abs(t.x - a.pos.x) + Math.abs(t.y - a.pos.y) <= 1) return { kind: 'bed' };
  }
  const occ = occupiedSet(state, a.pos.room, who);
  const usable = seatUsable(state, who, a.pos.room);
  // 立つ位置に他の人がいる椅子には座れない
  const seat = seatTargetAt(state, a.pos.room, { x: a.pos.x, y: a.pos.y }, a.pos.dir, (s) => { const t = seatTile(s); return usable(s) && !occ.has(`${t.x},${t.y}`); });
  return seat ? { kind: 'sit', seat } : null;
}
