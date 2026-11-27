/**
 * フィールド上の移動シミュレーション（描画 FPS と無関係に、シミュレーション時間で進む）。
 * 1 タイルずつの 4 方向移動。プレイヤーも NPC も同じ規則で動く。
 */
import { ALL_IDS, type CharId } from '../data/characters';
import { CONFIG } from '../data/config';
import type { Actor, Dir, GameState } from '../core/types';
import { canEnter, passFn } from './access';
import { ROOMS, buildCollision, doorApproach, doorAt, doorDir, findDoor, type DoorDef } from './maps';
import { findPath, nearestFree, roomRoute } from './path';

const gridCache = new Map<string, { key: string; grid: boolean[][] }>();

export function collisionOf(state: GameState, roomId: string): boolean[][] {
  const room = ROOMS[roomId];
  const key = room.props.map((p) => (p.showIf ? (state.flags[p.showIf] ? 1 : 0) : p.hideIf ? (state.flags[p.hideIf] ? 1 : 0) : '')).join('');
  const c = gridCache.get(roomId);
  if (c && c.key === key) return c.grid;
  const grid = buildCollision(room, state.flags);
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
  a.pos = { room: target.id, x: spot.x, y: spot.y, dir: facing };
  a.step = undefined;
  a.path = [];
  return true;
}

/** 1 歩踏み出す。成功したら true */
export function tryStep(state: GameState, a: Actor, dir: Dir): boolean {
  if (a.step) return false;
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
export function moveActor(state: GameState, a: Actor, dt: number, speed: number): void {
  let budget = (dt / 1000) * speed;
  let guard = 0;
  while (budget > 0 && guard++ < 8) {
    if (a.step) {
      const need = 1 - a.step.p;
      if (budget >= need) {
        budget -= need;
        a.pos.x = a.step.x;
        a.pos.y = a.step.y;
        a.step = undefined;
      } else {
        a.step.p += budget;
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
      if (at) {
        a.pos.dir = doorDir(door);
        if (enterDoor(state, a, door)) a.route.shift();
        else a.route = [];
        break;
      }
      const grid = collisionOf(state, a.pos.room);
      const occ = occupiedSet(state, a.pos.room, a.id);
      let best: { x: number; y: number }[] | null = null;
      for (const t of tiles) {
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
  a.pos = { room: roomId, x: p.x, y: p.y, dir: 'down' };
  a.step = undefined;
  a.path = [];
  a.route = [];
  a.moving = false;
}
